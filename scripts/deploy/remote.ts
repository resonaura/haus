/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DeployTargetConfig, ResolvedFileEntry } from './config.ts';
import {
  APPLY_AND_VERIFY_SCRIPT,
  BACKUP_STAGE_SCRIPT,
  CHECKSUM_SCAN_SCRIPT,
  PATCH_NEST_BODY_PARSER_SCRIPT,
  RESTORE_BACKUP_SCRIPT,
} from './container-scripts.ts';

export interface PreflightResult {
  readonly containerRunning: boolean;
  readonly restartCount: number;
  readonly image: string;
  readonly pythonBin: string | null;
}

export interface BackupManifest {
  readonly backupId: string;
  readonly target: string;
  readonly gitSha: string;
  readonly createdAt: string;
  readonly existingFiles: readonly string[];
  readonly addedFiles: readonly string[];
  readonly deployedChecksums: Readonly<Record<string, string>>;
}

export interface TargetStatusReport {
  readonly name: string;
  readonly role: string;
  readonly running: boolean;
  readonly restartCount: number;
  readonly healthOk: boolean;
  readonly healthDetail: string;
  readonly latestBackup: string | null;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildSshArgs(target: DeployTargetConfig): string[] {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=3',
  ];
  if (target.sshPort) args.push('-p', String(target.sshPort));
  args.push(target.ssh);
  return args;
}

function runSsh(
  target: DeployTargetConfig,
  remoteCmd: string,
  stdin?: Buffer | string,
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('ssh', [...buildSshArgs(target), remoteCmd], {
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

function requireSsh(
  target: DeployTargetConfig,
  remoteCmd: string,
  label: string,
  stdin?: Buffer | string,
): string {
  const res = runSsh(target, remoteCmd, stdin);
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || `exit code ${res.status}`).trim();
    throw new Error(`[${target.name}] ${label} failed: ${detail}`);
  }
  return res.stdout;
}

function dockerNodeCmd(target: DeployTargetConfig, script: string, asRoot = false): string {
  const userFlag = asRoot ? '-u 0 ' : '';
  return `docker exec ${userFlag}-i ${shellQuote(target.container)} node -e ${shellQuote(script)}`;
}

export function checkTargetPreflight(target: DeployTargetConfig): PreflightResult {
  const inspectCmd = [
    `docker inspect --format '{{.State.Running}}|{{.RestartCount}}|{{.Config.Image}}' ${shellQuote(target.container)}`,
    `docker exec ${shellQuote(target.container)} sh -c 'test -d ${shellQuote(target.containerAppDir)} && (test -x /opt/ha-venv/bin/python && echo /opt/ha-venv/bin/python || command -v python3 || echo NONE)'`,
  ].join(' && ');
  const out = requireSsh(target, inspectCmd, 'preflight').trim().split('\n');
  const [runningRaw, restartRaw, image = 'unknown'] = (out[0] ?? '').split('|');
  const pyLine = (out[1] ?? '').trim();
  const containerRunning = runningRaw === 'true';
  if (!containerRunning) {
    throw new Error(`[${target.name}] Container "${target.container}" is not running.`);
  }
  return {
    containerRunning,
    restartCount: Number.parseInt(restartRaw ?? '0', 10) || 0,
    image,
    pythonBin: pyLine && pyLine !== 'NONE' ? pyLine : null,
  };
}

export function readRemoteChecksums(
  target: DeployTargetConfig,
  relPaths: readonly string[],
): Record<string, string | null> {
  const stdout = requireSsh(
    target,
    dockerNodeCmd(target, CHECKSUM_SCAN_SCRIPT),
    'checksum scan',
    JSON.stringify({ appDir: target.containerAppDir, paths: relPaths }),
  );
  return JSON.parse(stdout) as Record<string, string | null>;
}

export function createRemoteBackup(
  target: DeployTargetConfig,
  backupId: string,
  files: readonly ResolvedFileEntry[],
  gitSha: string,
): BackupManifest {
  const remoteBackupDir = `${target.backupDir}/deploy-${backupId}-${target.name}`;
  const relPaths = files.map((f) => f.relPath);
  if (target.patchNestBodyParser && !relPaths.includes('dist/nest.js')) {
    relPaths.push('dist/nest.js');
  }

  const scanJson = requireSsh(
    target,
    dockerNodeCmd(target, BACKUP_STAGE_SCRIPT),
    'backup staging',
    JSON.stringify({ appDir: target.containerAppDir, backupId, paths: relPaths }),
  );
  const { existingFiles, addedFiles } = JSON.parse(scanJson) as {
    existingFiles: string[];
    addedFiles: string[];
  };

  const manifest: BackupManifest = {
    backupId,
    target: target.name,
    gitSha,
    createdAt: new Date().toISOString(),
    existingFiles,
    addedFiles,
    deployedChecksums: Object.fromEntries(files.map((f) => [f.relPath, f.sha256])),
  };

  const persistCmd = [
    `mkdir -p ${shellQuote(remoteBackupDir)}`,
    `docker exec ${shellQuote(target.container)} tar -czf - -C ${shellQuote(`/tmp/haus-deploy-backup-${backupId}`)} . > ${shellQuote(`${remoteBackupDir}/backup.tar.gz`)}`,
    `docker exec ${shellQuote(target.container)} rm -rf ${shellQuote(`/tmp/haus-deploy-backup-${backupId}`)}`,
    `ln -sfn ${shellQuote(remoteBackupDir)} ${shellQuote(`${target.backupDir}/latest-${target.name}`)}`,
  ].join(' && ');
  requireSsh(target, persistCmd, 'backup archive');

  requireSsh(
    target,
    `cat > ${shellQuote(`${remoteBackupDir}/manifest.json`)}`,
    'backup manifest write',
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return manifest;
}

export async function transferAndVerifyFiles(
  target: DeployTargetConfig,
  files: readonly ResolvedFileEntry[],
  backupId: string,
  pythonBin: string | null,
): Promise<void> {
  if (files.length === 0) return;

  const localStage = await mkdtemp(join(tmpdir(), `haus-deploy-${target.name}-`));
  try {
    for (const file of files) {
      const dst = join(localStage, file.relPath);
      await mkdir(dirname(dst), { recursive: true });
      await cp(file.absLocalPath, dst, { force: true });
    }
    await writeFile(
      join(localStage, '.haus-deploy-manifest.json'),
      JSON.stringify({
        appDir: target.containerAppDir,
        files: files.map((f) => ({ relPath: f.relPath, sha256: f.sha256 })),
      }),
    );

    const tarRes = spawnSync('tar', ['-czf', '-', '-C', localStage, '.'], {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      maxBuffer: 64 * 1024 * 1024,
    });
    if (tarRes.status !== 0) {
      throw new Error(`Local tar creation failed: ${tarRes.stderr.toString('utf8')}`);
    }

    const stageDir = `/tmp/haus-deploy-stage-${backupId}`;
    const extractCmd = `docker exec -i ${shellQuote(target.container)} sh -c ${shellQuote(
      `rm -rf ${stageDir} && mkdir -p ${stageDir} && tar -xzf - --no-same-owner -C ${stageDir}`,
    )}`;
    requireSsh(target, extractCmd, 'stage upload', tarRes.stdout);

    requireSsh(
      target,
      dockerNodeCmd(target, APPLY_AND_VERIFY_SCRIPT, Boolean(target.chown)),
      'apply & syntax verify',
      JSON.stringify({
        stageDir,
        appDir: target.containerAppDir,
        chown: target.chown ?? null,
        pythonBin,
      }),
    );
  } finally {
    await rm(localStage, { recursive: true, force: true });
  }
}

export function patchRemoteNestBodyParser(target: DeployTargetConfig): boolean {
  if (!target.patchNestBodyParser) return false;
  const res = requireSsh(
    target,
    `docker exec ${shellQuote(target.container)} node -e ${shellQuote(PATCH_NEST_BODY_PARSER_SCRIPT)} ${shellQuote(target.containerAppDir)}`,
    'nest bodyParser patch',
  ).trim();
  return res === 'patched';
}

export function restartAndVerifyHealth(
  target: DeployTargetConfig,
  preRestartCount: number,
): { elapsedSec: number } {
  requireSsh(target, `docker restart ${shellQuote(target.container)}`, 'container restart');
  const startedAtIso = requireSsh(
    target,
    `docker inspect --format '{{.State.StartedAt}}' ${shellQuote(target.container)}`,
    'read container start time',
  ).trim();

  const deadline = Date.now() + target.healthTimeoutSec * 1000;
  const startedAt = Date.now();

  while (Date.now() < deadline) {
    const probeCmd = [
      `state=$(docker inspect --format '{{.State.Running}}|{{.RestartCount}}' ${shellQuote(target.container)} 2>/dev/null || echo 'false|0')`,
      `body=$(curl -fsS --max-time 4 ${shellQuote(target.healthUrl)} 2>/dev/null || true)`,
      `printf '%s\\n%s\\n' "$state" "$body"`,
    ].join('; ');
    const probe = runSsh(target, probeCmd);
    if (probe.status === 0) {
      const [stateLine = '', bodyLine = ''] = probe.stdout.split('\n');
      const [running, countStr] = stateLine.split('|');
      const restartCount = Number.parseInt(countStr ?? '0', 10) || 0;
      if (restartCount > preRestartCount + 1) {
        throw new Error(
          `[${target.name}] Container crash-loop detected (restarts=${restartCount}).`,
        );
      }
      if (running === 'true' && bodyLine.includes('"ok"')) {
        const fatalCheck = runSsh(
          target,
          `docker logs --since ${shellQuote(startedAtIso)} ${shellQuote(target.container)} 2>&1 | grep -E "SyntaxError:|ERR_MODULE_NOT_FOUND|Cannot find module" | head -n 5 || true`,
        );
        if (fatalCheck.stdout.trim().length > 0) {
          throw new Error(
            `[${target.name}] Fatal startup error detected:\n${fatalCheck.stdout.trim()}`,
          );
        }
        return { elapsedSec: Math.round((Date.now() - startedAt) / 100) / 10 };
      }
    }
    spawnSync(process.execPath, [
      '-e',
      'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000)',
    ]);
  }

  const tail = runSsh(target, `docker logs --tail 25 ${shellQuote(target.container)} 2>&1 || true`);
  throw new Error(
    `[${target.name}] Health check timed out after ${target.healthTimeoutSec}s (${target.healthUrl}). Recent logs:\n${tail.stdout.trim()}`,
  );
}

export function rollbackRemoteTarget(target: DeployTargetConfig, backupId?: string): string {
  const backupPath = backupId
    ? `${target.backupDir}/deploy-${backupId}-${target.name}`
    : `${target.backupDir}/latest-${target.name}`;

  const manifestRaw = requireSsh(
    target,
    `cat ${shellQuote(`${backupPath}/manifest.json`)}`,
    'read rollback manifest',
  );
  const manifest = JSON.parse(manifestRaw) as BackupManifest;
  const restoreDir = `/tmp/haus-deploy-restore-${Date.now()}`;

  const running =
    runSsh(
      target,
      `docker inspect --format '{{.State.Running}}' ${shellQuote(target.container)}`,
    ).stdout.trim() === 'true';

  if (running) {
    const extractCmd = [
      `docker exec ${shellQuote(target.container)} sh -c ${shellQuote(`rm -rf ${restoreDir} && mkdir -p ${restoreDir}`)}`,
      `docker exec -i ${shellQuote(target.container)} tar -xzf - --no-same-owner -C ${shellQuote(restoreDir)} < ${shellQuote(`${backupPath}/backup.tar.gz`)}`,
    ].join(' && ');
    requireSsh(target, extractCmd, 'rollback archive extract');

    requireSsh(
      target,
      dockerNodeCmd(target, RESTORE_BACKUP_SCRIPT, Boolean(target.chown)),
      'rollback file restore',
      JSON.stringify({
        restoreDir,
        appDir: target.containerAppDir,
        existingFiles: manifest.existingFiles,
        addedFiles: manifest.addedFiles,
        chown: target.chown ?? null,
      }),
    );
  } else {
    // Container crashed on boot; restore files via host staging + docker cp (works while stopped).
    const hostRestore = [
      `rm -rf ${shellQuote(restoreDir)} && mkdir -p ${shellQuote(restoreDir)}`,
      `tar -xzf ${shellQuote(`${backupPath}/backup.tar.gz`)} -C ${shellQuote(restoreDir)}`,
      `docker cp ${shellQuote(`${restoreDir}/.`)} ${shellQuote(`${target.container}:${target.containerAppDir}/`)}`,
      `rm -rf ${shellQuote(restoreDir)}`,
    ].join(' && ');
    requireSsh(target, hostRestore, 'stopped-container rollback restore');
  }

  return manifest.backupId;
}

export function pruneOldBackups(target: DeployTargetConfig): void {
  const pattern = `deploy-*-${target.name}`;
  const cmd = `cd ${shellQuote(target.backupDir)} && ls -1dt ${pattern} 2>/dev/null | tail -n +${target.keepBackups + 1} | xargs -r rm -rf`;
  runSsh(target, cmd);
}

export function inspectTargetStatus(target: DeployTargetConfig): TargetStatusReport {
  const cmd = [
    `state=$(docker inspect --format '{{.State.Running}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ${shellQuote(target.container)} 2>/dev/null || echo 'false|0|none')`,
    `body=$(curl -fsS --max-time 8 --retry 1 --retry-delay 1 ${shellQuote(target.healthUrl)} 2>/dev/null || echo 'UNREACHABLE')`,
    `latest=$(readlink ${shellQuote(`${target.backupDir}/latest-${target.name}`)} 2>/dev/null || echo 'NONE')`,
    `printf '%s\\n%s\\n%s\\n' "$state" "$body" "$latest"`,
  ].join('; ');
  const res = runSsh(target, cmd);
  if (res.status !== 0) {
    return {
      name: target.name,
      role: target.role,
      running: false,
      restartCount: 0,
      healthOk: false,
      healthDetail: `ssh_error: ${(res.stderr || res.stdout).trim()}`,
      latestBackup: null,
    };
  }
  const [stateLine = '', bodyLine = '', latestLine = ''] = res.stdout.split('\n');
  const [running, countStr, dockerHealth = 'none'] = stateLine.split('|');
  const healthOk = bodyLine.includes('"ok"');
  return {
    name: target.name,
    role: target.role,
    running: running === 'true',
    restartCount: Number.parseInt(countStr ?? '0', 10) || 0,
    healthOk,
    healthDetail: `docker=${dockerHealth} ${bodyLine.trim()}`,
    latestBackup:
      latestLine && latestLine !== 'NONE' ? (latestLine.split('/').pop() ?? null) : null,
  };
}
