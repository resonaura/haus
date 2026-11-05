/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stripControl } from './sanitize.js';

const exec = promisify(execFile);

/** Fixed executable/argument lists only; never a shell, inspect, environment or process command lines. */
export async function command(
  file: string,
  args: string[],
  options: Record<string, unknown> = {},
): Promise<string> {
  const { input, ...overrides } = options;
  const operation = exec(file, args, {
    timeout: 2500,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    encoding: 'utf8',
    ...overrides,
  });
  operation.child.stdin?.end(input as string | Uint8Array | undefined);
  const { stdout } = await operation;
  return String(stdout);
}

const text = (value: unknown, length = 160) =>
  typeof value === 'string' ? stripControl(value).slice(0, length) : '';

const numeric = (value: unknown) =>
  value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value)
    : null;

export function memorySize(value: unknown) {
  const match = /^([\d.]+)\s*(B|kB|KB|KiB|MB|MiB|GB|GiB|TB|TiB)?$/.exec(String(value));
  if (!match) return null;
  const power: Record<string, number> = {
    B: 0,
    kB: 1,
    KB: 1,
    KiB: 1,
    MB: 2,
    MiB: 2,
    GB: 3,
    GiB: 3,
    TB: 4,
    TiB: 4,
  };
  const unit = match[2] || 'B';
  const p = power[unit] ?? 0;
  const bytes = Number(match[1]) * (unit.includes('i') ? 1024 : 1000) ** p;
  return Number.isFinite(bytes) && bytes >= 0 ? Math.round(bytes) : null;
}

function jsonLines(output: string): Record<string, unknown>[] {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 256)
    .map((line) => JSON.parse(line));
}

export async function dockerTelemetry(
  run: (
    cmd: string,
    args: string[],
    options?: Record<string, unknown>,
  ) => Promise<string> = command,
) {
  try {
    const output = await run(
      'docker',
      [
        'ps',
        '--all',
        '--no-trunc',
        '--format',
        '{"ID":{{json .ID}},"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}}}',
      ],
      { timeout: 5000 },
    );
    let stats: Record<string, unknown>[] = [];
    try {
      stats = jsonLines(
        await run(
          'docker',
          [
            'stats',
            '--all',
            '--no-stream',
            '--no-trunc',
            '--format',
            '{"ID":{{json .ID}},"CPUPerc":{{json .CPUPerc}},"MemUsage":{{json .MemUsage}}}',
          ],
          { timeout: 5000 },
        ),
      );
    } catch {
      /* Container list remains useful when stats permissions or runtime differ. */
    }
    const byId = new Map(stats.map((row) => [String(row.ID), row]));
    let cpuPercentBasis: 'core' | 'host' | null = null;
    try {
      const engine = JSON.parse(
        await run('docker', ['info', '--format', '{"OSType":{{json .OSType}}}'], { timeout: 5000 }),
      );
      cpuPercentBasis =
        engine.OSType === 'linux' ? 'core' : engine.OSType === 'windows' ? 'host' : null;
    } catch {
      /* A daemon with unknown CPU units does not authorize guessing. */
    }
    return {
      available: true,
      source: 'local',
      cpuPercentBasis,
      containers: jsonLines(output).map((row) => {
        const sample = byId.get(String(row.ID));
        const memUsage = typeof sample?.MemUsage === 'string' ? sample.MemUsage : undefined;
        const memory = memUsage?.split('/').map((part: string) => memorySize(part.trim()));
        const cpuPerc = typeof sample?.CPUPerc === 'string' ? sample.CPUPerc : undefined;
        return {
          id: text(row.ID, 80),
          name: text(row.Names),
          image: text(row.Image, 240),
          state: text(row.State, 40),
          status: text(row.Status),
          cpuPercent: sample ? numeric(cpuPerc?.replace('%', '')) : null,
          memoryUsedBytes: memory?.[0] ?? null,
          memoryLimitBytes: memory?.[1] ?? null,
        };
      }),
    };
  } catch {
    return { available: false, source: 'unavailable', containers: [] };
  }
}

export async function pm2Telemetry({
  run = command,
  read = ((p: string, enc?: string) => readFile(p, (enc ?? 'utf8') as BufferEncoding)) as (
    path: string,
    encoding?: string,
  ) => Promise<string | Buffer>,
  home = process.env.PM2_HOME || join(homedir(), '.pm2'),
  alive = (pid: number) => process.kill(pid, 0),
  now = Date.now(),
  cli = process.env.HAUS_PM2_CLI,
  platform = process.platform,
}: {
  run?: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  read?: (path: string, encoding?: string) => Promise<string | Buffer>;
  home?: string;
  alive?: (pid: number) => void;
  now?: number;
  cli?: string;
  platform?: string;
} = {}) {
  try {
    const pid = Number(String(await read(join(home, 'pm2.pid'), 'utf8')).trim());
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('no_daemon');
    alive(pid);
    if (!cli && platform === 'win32') {
      const candidates = [
        process.env.APPDATA &&
          join(process.env.APPDATA, 'npm', 'node_modules', 'pm2', 'bin', 'pm2'),
        join(process.execPath, '..', 'node_modules', 'pm2', 'bin', 'pm2'),
      ].filter(Boolean) as string[];
      for (const candidate of candidates)
        if (
          await access(candidate).then(
            () => true,
            () => false,
          )
        ) {
          cli = candidate;
          break;
        }
      if (!cli) throw new Error('no_pm2_cli');
    }
    const rows = JSON.parse(
      await run(cli ? process.execPath : 'pm2', cli ? [cli, 'jlist'] : ['jlist'], {
        timeout: 5000,
      }),
    );
    if (!Array.isArray(rows)) throw new Error('invalid_pm2');
    return {
      available: true,
      source: 'local',
      cpuPercentBasis: 'core' as const,
      processes: rows.slice(0, 256).map((row: Record<string, unknown>) => {
        const env = row.pm2_env as Record<string, unknown> | undefined;
        const monit = row.monit as Record<string, unknown> | undefined;
        const uptime =
          typeof env?.pm_uptime === 'number' && Number.isFinite(env.pm_uptime)
            ? Math.max(0, (now - env.pm_uptime) / 1000)
            : null;
        return {
          id: numeric(row.pm_id),
          name: text(row.name),
          status: text(env?.status, 40),
          pid: numeric(row.pid),
          cpuPercent: numeric(monit?.cpu),
          memoryBytes: numeric(monit?.memory),
          uptimeSeconds: uptime,
          restarts: numeric(env?.restart_time),
        };
      }),
    };
  } catch {
    return { available: false, source: 'unavailable', processes: [] };
  }
}
