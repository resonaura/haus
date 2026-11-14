/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  formatWslPreflightReport,
  inspectWslPreflight,
  mergeWslConfBootSystemd,
  mergeWslConfigMirrored,
  renderHubEnvFile,
  renderSystemdHubService,
} from '../runtime/wsl-setup.js';

interface CliOptions {
  readonly action: 'check' | 'env-template' | 'wsl-conf' | 'wslconfig' | 'systemd-unit';
  readonly json: boolean;
  readonly strict: boolean;
  readonly dataDirectory?: string;
  readonly port?: number;
  readonly publicUrl?: string;
  readonly workingDirectory?: string;
  readonly nvrEnabled: boolean;
}

function parseCliArgs(args: readonly string[]): CliOptions {
  let action: CliOptions['action'] = 'check';
  let json = false;
  let strict = false;
  let dataDirectory: string | undefined;
  let port: number | undefined;
  let publicUrl: string | undefined;
  let workingDirectory: string | undefined;
  let nvrEnabled = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') action = 'check';
    else if (arg === '--env-template') action = 'env-template';
    else if (arg === '--wsl-conf') action = 'wsl-conf';
    else if (arg === '--wslconfig') action = 'wslconfig';
    else if (arg === '--systemd-unit') action = 'systemd-unit';
    else if (arg === '--json') json = true;
    else if (arg === '--strict') strict = true;
    else if (arg === '--nvr') nvrEnabled = true;
    else if (arg === '--data-dir' && args[i + 1]) dataDirectory = args[++i];
    else if (arg === '--public-url' && args[i + 1]) publicUrl = args[++i];
    else if (arg === '--working-dir' && args[i + 1]) workingDirectory = args[++i];
    else if (arg === '--port' && args[i + 1]) {
      const parsed = Number(args[++i]);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error('invalid_port');
      }
      port = parsed;
    } else {
      throw new Error(`unknown_argument:${arg}`);
    }
  }

  return {
    action,
    json,
    strict,
    dataDirectory,
    port,
    publicUrl,
    workingDirectory,
    nvrEnabled,
  };
}

async function readIfExists(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

try {
  const opts = parseCliArgs(process.argv.slice(2));
  const report = await inspectWslPreflight({
    dataDirectory: opts.dataDirectory,
    port: opts.port,
    publicUrl: opts.publicUrl,
  });

  if (opts.action === 'check') {
    process.stdout.write(
      opts.json ? `${JSON.stringify(report, null, 2)}\n` : formatWslPreflightReport(report),
    );
    if (opts.strict && !report.ready) process.exitCode = 1;
  } else if (opts.action === 'env-template') {
    process.stdout.write(
      renderHubEnvFile({
        dataDirectory: report.dataDirectory,
        port: report.port,
        networkingMode: report.recommendedMode,
        publicUrl: opts.publicUrl ?? (report.windowsLanIp ? report.publicUrlHint : undefined),
        mdnsAddress: report.windowsLanIp ?? report.assessment.lanIps[0],
        nvrEnabled: opts.nvrEnabled,
      }),
    );
  } else if (opts.action === 'wsl-conf') {
    process.stdout.write(mergeWslConfBootSystemd(await readIfExists('/etc/wsl.conf')));
  } else if (opts.action === 'wslconfig') {
    process.stdout.write(mergeWslConfigMirrored(await readIfExists(report.wslConfigPath)));
  } else if (opts.action === 'systemd-unit') {
    process.stdout.write(
      renderSystemdHubService({
        workingDirectory: resolve(opts.workingDirectory ?? process.cwd()),
        readWritePaths: [report.dataDirectory],
      }),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
