/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  collectDeployFiles,
  parseCliArgs,
  parseDeployConfig,
  type DeployConfig,
  type DeployTargetConfig,
  type ResolvedFileEntry,
} from './deploy/config.ts';
import {
  checkTargetPreflight,
  createRemoteBackup,
  inspectTargetStatus,
  patchRemoteNestBodyParser,
  pruneOldBackups,
  readRemoteChecksums,
  restartAndVerifyHealth,
  rollbackRemoteTarget,
  transferAndVerifyFiles,
} from './deploy/remote.ts';

function printHelp(): void {
  console.log(`Usage: pnpm deploy:hubs [-- [options]]

Safe rolling deploy & self-update tool for remote Haus Hub containers.
Reads target configuration from .local/deploy-hubs.json (gitignored).

Options:
  --config <path>       Config file path (default: .local/deploy-hubs.json)
  --target <a,b>        Deploy or inspect only named targets
  --paths <a,b>         Restrict deploy to matching container-relative prefixes
  --dry-run             Show preflight & exact changed files without modifying Hubs
  --skip-build          Skip workspace build commands before deploying
  --rollback [target]   Roll back target(s) to latest (or --backup <id>) snapshot
  --backup <id>         Specific backup timestamp ID for --rollback
  --status              Inspect running state, health & latest backup of all Hubs
  -h, --help            Show this help message
`);
}

function getGitSha(): string {
  const res = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : 'unknown';
}

function makeBackupId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    '-',
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join('');
}

function runBuildCommands(commands: readonly string[], cwd: string): void {
  for (const cmd of commands) {
    console.log(`[build] ${cmd}`);
    const res = spawnSync(cmd, { cwd, shell: true, stdio: 'inherit' });
    if (res.status !== 0) {
      throw new Error(`Build command failed (${res.status}): ${cmd}`);
    }
  }
}

function selectTargets(config: DeployConfig, targetNames: readonly string[]): DeployTargetConfig[] {
  if (targetNames.length === 0) {
    return config.targets.filter((t) => t.enabled);
  }
  const byName = new Map(config.targets.map((t) => [t.name, t]));
  const selected: DeployTargetConfig[] = [];
  for (const name of targetNames) {
    const found = byName.get(name);
    if (!found) {
      throw new Error(
        `Unknown target "${name}". Configured targets: ${config.targets.map((t) => t.name).join(', ')}`,
      );
    }
    selected.push(found);
  }
  return selected;
}

async function deployTarget(
  repoRoot: string,
  config: DeployConfig,
  target: DeployTargetConfig,
  options: {
    readonly dryRun: boolean;
    readonly pathFilters: readonly string[];
    readonly gitSha: string;
    readonly backupId: string;
  },
): Promise<{ status: 'updated' | 'up-to-date' | 'dry-run'; files: number; elapsedSec?: number }> {
  console.log(`\n==> [${target.name}] (${target.role}) ${target.ssh} :: ${target.container}`);

  const preflight = checkTargetPreflight(target);
  console.log(
    `    preflight ok | image=${preflight.image} | restarts=${preflight.restartCount} | python=${preflight.pythonBin ?? 'none'}`,
  );

  const candidates = await collectDeployFiles(
    repoRoot,
    config.mappings,
    target,
    options.pathFilters,
  );
  let toDeploy: ResolvedFileEntry[] = candidates;

  if (target.syncMode === 'changed-only') {
    const remoteHashes = readRemoteChecksums(
      target,
      candidates.map((f) => f.relPath),
    );
    toDeploy = candidates.filter((file) => remoteHashes[file.relPath] !== file.sha256);
    console.log(
      `    scanned ${candidates.length} files (${toDeploy.length} changed/new, ${candidates.length - toDeploy.length} identical)`,
    );
  } else {
    console.log(`    syncMode=all (${toDeploy.length} files)`);
  }

  if (options.dryRun) {
    for (const file of toDeploy) {
      console.log(`    [dry-run] + ${file.relPath} (${file.size} B, ${file.sha256.slice(0, 10)})`);
    }
    if (target.patchNestBodyParser) {
      console.log('    [dry-run] ~ verify/patch dist/nest.js 16mb bodyParser');
    }
    return { status: 'dry-run', files: toDeploy.length };
  }

  if (toDeploy.length === 0 && !target.patchNestBodyParser) {
    console.log('    already up to date; skipping restart.');
    return { status: 'up-to-date', files: 0 };
  }

  const manifest = createRemoteBackup(target, options.backupId, toDeploy, options.gitSha);
  console.log(
    `    backup saved: deploy-${manifest.backupId}-${target.name} (${manifest.existingFiles.length} existing, ${manifest.addedFiles.length} new)`,
  );

  let applied = false;
  try {
    await transferAndVerifyFiles(target, toDeploy, options.backupId, preflight.pythonBin);
    applied = true;
    const nestPatched = patchRemoteNestBodyParser(target);
    if (nestPatched) console.log('    patched dist/nest.js bodyParser (16mb)');
    if (toDeploy.length === 0 && !nestPatched) {
      console.log('    already up to date (nest bodyParser intact); skipping restart.');
      return { status: 'up-to-date', files: 0 };
    }
    console.log('    checksums, node --check, and py_compile passed. Restarting container...');
    const { elapsedSec } = restartAndVerifyHealth(target, preflight.restartCount);
    console.log(`    HEALTHY in ${elapsedSec}s (${target.healthUrl})`);
    pruneOldBackups(target);
    return { status: 'updated', files: toDeploy.length, elapsedSec };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`\n[ERROR] Deploy failed on "${target.name}": ${reason}`);
    if (applied || manifest.existingFiles.length > 0 || manifest.addedFiles.length > 0) {
      console.error(
        `[ROLLBACK] Automatically rolling back "${target.name}" to ${manifest.backupId}...`,
      );
      try {
        rollbackRemoteTarget(target, manifest.backupId);
        const { elapsedSec } = restartAndVerifyHealth(target, preflight.restartCount + 1);
        console.error(`[ROLLBACK] "${target.name}" recovered and HEALTHY in ${elapsedSec}s.`);
      } catch (rbErr: unknown) {
        console.error(
          `[ROLLBACK CRITICAL] Rollback failed on "${target.name}": ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`,
        );
      }
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const repoRoot = resolve('.');
  const absConfigPath = resolve(repoRoot, options.configPath);
  if (!existsSync(absConfigPath)) {
    throw new Error(
      `Deploy config not found at ${options.configPath}. Copy scripts/deploy-hubs.example.json to .local/deploy-hubs.json and fill in your Hub targets.`,
    );
  }

  const config = parseDeployConfig(JSON.parse(await readFile(absConfigPath, 'utf8')));
  const targets = selectTargets(config, options.targetNames);
  if (targets.length === 0) {
    throw new Error('No enabled deploy targets matched.');
  }

  if (options.status) {
    for (const target of targets) {
      const st = inspectTargetStatus(target);
      console.log(
        `[${st.name}] (${st.role}) running=${st.running} restarts=${st.restartCount} health=${st.healthOk ? 'OK' : 'FAIL'} backup=${st.latestBackup ?? 'none'} | ${st.healthDetail}`,
      );
    }
    return;
  }

  if (options.rollback) {
    for (const target of targets) {
      console.log(`\n==> Rolling back [${target.name}] (${target.ssh} :: ${target.container})`);
      const preflight = checkTargetPreflight(target);
      const restoredId = rollbackRemoteTarget(target, options.backupId);
      const { elapsedSec } = restartAndVerifyHealth(target, preflight.restartCount);
      console.log(`    Rolled back to ${restoredId} and HEALTHY in ${elapsedSec}s.`);
    }
    return;
  }

  if (!options.skipBuild && !options.dryRun && config.buildCommands.length > 0) {
    runBuildCommands(config.buildCommands, repoRoot);
  }

  const gitSha = getGitSha();
  const backupId = makeBackupId();
  const summary: string[] = [];

  for (const target of targets) {
    const result = await deployTarget(repoRoot, config, target, {
      dryRun: options.dryRun,
      pathFilters: options.pathFilters,
      gitSha,
      backupId,
    });
    summary.push(
      `${target.name}(${target.role}): ${result.status} (${result.files} files${result.elapsedSec !== undefined ? `, ${result.elapsedSec}s` : ''})`,
    );
  }

  console.log(`\nDeploy summary (git ${gitSha}):`);
  for (const line of summary) console.log(`  - ${line}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
