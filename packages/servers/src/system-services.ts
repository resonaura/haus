/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { uptime } from 'node:os';
import { command } from './services.js';
import { stripControl } from './sanitize.js';

export interface SystemServiceItem {
  id: string;
  name: string;
  status: string;
  detail: string;
  pid: number | null;
  sharedProcess?: boolean;
  cpuPercent: number | null;
  memoryBytes: number | null;
  uptimeSeconds: number | null;
  domain?: string;
}

export interface SystemServiceReport {
  available: boolean;
  source: string;
  cpuPercentBasis?: 'core' | 'host';
  sampledAt?: string;
  services: SystemServiceItem[];
  cpuPercent?: number | null;
  memoryBytes?: number | null;
}

const text = (value: unknown, max = 240) =>
  typeof value === 'string' ? stripControl(value).slice(0, max) : '';

const number = (value: unknown) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0 &&
  Number(value) < Number.MAX_SAFE_INTEGER
    ? Number(value)
    : null;

const unavailable = (): SystemServiceReport => ({
  available: false,
  source: 'unavailable',
  services: [],
});

const sum = (rows: Record<string, unknown>[], key: string) =>
  rows.every((row) => number(row[key]) !== null)
    ? rows.reduce((total, row) => total + Number(row[key]), 0)
    : null;

export function parseSystemdServices(
  output: string,
  {
    previous = new Map(),
    now = Date.now(),
    uptimeSeconds = uptime(),
  }: {
    previous?: Map<string, { cpu: number | null; pid: number; at: number }>;
    now?: number;
    uptimeSeconds?: number;
  } = {},
) {
  const next = new Map<string, { cpu: number | null; pid: number; at: number }>();
  const services = String(output)
    .split(/\r?\n\r?\n/)
    .slice(0, 512)
    .flatMap((block) => {
      const fields = Object.fromEntries(
        block.split(/\r?\n/).flatMap((line) => {
          const at = line.indexOf('=');
          return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : [];
        }),
      );
      if (!fields.Id?.endsWith('.service') || fields.LoadState === 'not-found') return [];
      const cpu = number(fields.CPUUsageNSec);
      const pid = number(fields.MainPID) ?? 0;
      const emptyGroup = pid === 0 && fields.ControlGroup === '';
      const prior = previous.get(fields.Id);
      const elapsed = prior ? now - prior.at : 0;
      const cpuPercent = emptyGroup
        ? 0
        : cpu !== null &&
            prior?.cpu !== null &&
            prior?.cpu !== undefined &&
            prior.pid === pid &&
            cpu >= prior.cpu &&
            elapsed > 0 &&
            elapsed <= 60000
          ? (cpu - prior.cpu) / (elapsed * 10000)
          : null;
      next.set(fields.Id, { cpu, pid, at: now });
      const entered = number(fields.ActiveEnterTimestampMonotonic);
      return [
        {
          id: text(fields.Id),
          name: text(fields.Description) || text(fields.Id),
          status: text(fields.ActiveState, 40) || 'unknown',
          detail: text(fields.SubState, 40),
          pid: pid > 0 ? pid : null,
          cpuPercent,
          memoryBytes: emptyGroup ? 0 : number(fields.MemoryCurrent),
          uptimeSeconds:
            fields.ActiveState === 'active' &&
            entered !== null &&
            entered > 0 &&
            entered / 1000000 <= uptimeSeconds
              ? uptimeSeconds - entered / 1000000
              : null,
        },
      ];
    });
  const active = services.filter((row) =>
    ['active', 'activating', 'reloading'].includes(row.status),
  );
  return {
    report: {
      available: true,
      source: 'systemd',
      cpuPercentBasis: 'core' as const,
      sampledAt: new Date(now).toISOString(),
      services,
      cpuPercent: sum(active, 'cpuPercent'),
      memoryBytes: sum(active, 'memoryBytes'),
    },
    previous: next,
  };
}

const windowsScript =
  "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$services=@(Get-CimInstance Win32_Service -Property Name,DisplayName,State,ProcessId -OperationTimeoutSec 2 | Select-Object Name,DisplayName,State,ProcessId);$processes=@();try{$processes=@(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Property IDProcess,PercentProcessorTime,WorkingSetPrivate -OperationTimeoutSec 2 | Select-Object IDProcess,PercentProcessorTime,WorkingSetPrivate)}catch{};[pscustomobject]@{Services=$services;Processes=$processes}|ConvertTo-Json -Depth 4 -Compress";

export function parseWindowsServices(
  value: Record<string, unknown> | null | undefined,
  now = Date.now(),
): SystemServiceReport {
  if (!Array.isArray(value?.Services)) throw new Error('invalid_windows_services');
  const processes = new Map<number | null, Record<string, unknown>>(
    (Array.isArray(value.Processes) ? (value.Processes as Record<string, unknown>[]) : [])
      .slice(0, 1024)
      .map((row) => [number(row.IDProcess), row]),
  );
  const inputs = (value.Services as Record<string, unknown>[]).slice(0, 512);
  const counts = new Map<number, number>();
  for (const row of inputs) {
    const pid = number(row.ProcessId);
    if (pid && pid > 0 && row.State === 'Running') counts.set(pid, (counts.get(pid) || 0) + 1);
  }
  const services: SystemServiceItem[] = inputs
    .filter((row) => text(row.Name))
    .map((row) => {
      const pid = number(row.ProcessId);
      const sharedProcess = pid ? (counts.get(pid) || 0) > 1 : false;
      const sample =
        pid && pid > 0 && row.State === 'Running' && !sharedProcess ? processes.get(pid) : null;
      return {
        id: text(row.Name),
        name: text(row.DisplayName) || text(row.Name),
        status: text(row.State, 40).toLowerCase(),
        detail: '',
        pid: pid && pid > 0 ? pid : null,
        sharedProcess,
        cpuPercent: number(sample?.PercentProcessorTime),
        memoryBytes: number(sample?.WorkingSetPrivate),
        uptimeSeconds: null,
      };
    });
  const measured: Record<string, unknown>[] = [...counts.keys()].map((pid) => ({
    cpuPercent: number(processes.get(pid)?.PercentProcessorTime),
    memoryBytes: number(processes.get(pid)?.WorkingSetPrivate),
  }));
  return {
    available: true,
    source: 'windows',
    cpuPercentBasis: 'core' as const,
    sampledAt: new Date(now).toISOString(),
    services,
    cpuPercent: sum(measured, 'cpuPercent'),
    memoryBytes: sum(measured, 'memoryBytes'),
  };
}

export class SystemServiceTelemetry {
  run: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
  now: () => number;
  uptimeSeconds: () => number;
  uid: () => number | undefined;
  previous: Map<string, { cpu: number | null; pid: number; at: number }>;

  constructor({
    run = command,
    now = Date.now,
    uptimeSeconds = uptime,
    uid = () => (process as NodeJS.Process & { getuid?: () => number }).getuid?.(),
  }: {
    run?: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>;
    now?: () => number;
    uptimeSeconds?: () => number;
    uid?: () => number | undefined;
  } = {}) {
    this.run = run;
    this.now = now;
    this.uptimeSeconds = uptimeSeconds;
    this.uid = uid;
    this.previous = new Map();
  }

  async collect({
    platform = process.platform,
    wsl = false,
  }: { platform?: string; wsl?: boolean } = {}): Promise<SystemServiceReport> {
    if (platform === 'linux' && wsl) {
      const [windows, linux] = await Promise.all([
        this.collectWindows(true),
        this.collect({ platform: 'linux' }),
      ]);
      const groups: [string, SystemServiceReport][] = (
        [
          ['windows', windows],
          ['wsl', linux],
        ] as [string, SystemServiceReport][]
      ).filter(([, report]) => report.available);
      if (!groups.length) return unavailable();
      return {
        available: true,
        source: groups.length === 2 ? 'windows-wsl' : groups[0][1].source,
        cpuPercentBasis: 'core',
        sampledAt: groups.map(([, report]) => report.sampledAt ?? '').sort()[0],
        cpuPercent: sum(
          groups.map(([, report]) => report as unknown as Record<string, unknown>),
          'cpuPercent',
        ),
        memoryBytes: sum(
          groups.map(([, report]) => report as unknown as Record<string, unknown>),
          'memoryBytes',
        ),
        services: groups.flatMap(([domain, report]) =>
          report.services.map((service) => ({
            ...service,
            id: `${domain}:${service.id}`,
            domain,
          })),
        ),
      };
    }
    try {
      if (platform === 'win32') return this.collectWindows(false);
      if (platform === 'linux') {
        const output = await this.run(
          'systemctl',
          [
            'show',
            '*.service',
            '--all',
            '--no-pager',
            '--property=Id,LoadState,Description,ActiveState,SubState,MainPID,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestampMonotonic,ControlGroup',
          ],
          { timeout: 2500 },
        );
        const result = parseSystemdServices(output, {
          previous: this.previous,
          now: this.now(),
          uptimeSeconds: this.uptimeSeconds(),
        });
        this.previous = result.previous;
        return result.report;
      }
      if (platform === 'darwin') {
        const [units, stats] = await Promise.all([
          this.run('launchctl', ['list']),
          this.run('ps', ['-axo', 'pid=,pcpu=,rss=']),
        ]);
        const samples = new Map(
          stats
            .trim()
            .split('\n')
            .slice(0, 4096)
            .map((line) => {
              const [pid, cpu, memory] = line.trim().split(/\s+/);
              return [
                number(pid),
                {
                  cpuPercent: number(cpu),
                  memoryBytes: number(memory) === null ? null : Number(memory) * 1024,
                },
              ];
            }),
        );
        const services = units
          .trim()
          .split('\n')
          .slice(1, 513)
          .flatMap((line) => {
            const [rawPid, status, id] = line.trim().split(/\s+/);
            if (!id) return [];
            const pid = number(rawPid) ?? 0,
              sample = pid > 0 ? samples.get(pid) : null;
            return [
              {
                id: text(id),
                name: text(id),
                status: pid > 0 ? 'running' : status === '0' ? 'stopped' : 'failed',
                detail: '',
                pid: pid > 0 ? pid : null,
                cpuPercent: sample?.cpuPercent ?? null,
                memoryBytes: sample?.memoryBytes ?? null,
                uptimeSeconds: null,
              },
            ];
          });
        const active = services.filter((row) => row.status === 'running');
        return {
          available: true,
          source: this.uid() === 0 ? 'launchd' : 'launchd-user',
          cpuPercentBasis: 'core' as const,
          sampledAt: new Date(this.now()).toISOString(),
          services,
          cpuPercent: sum(active, 'cpuPercent'),
          memoryBytes: sum(active, 'memoryBytes'),
        };
      }
    } catch {
      /* Unsupported managers remain unavailable. */
    }
    return unavailable();
  }

  async collectWindows(wsl: boolean) {
    try {
      const raw = await this.run(
        wsl ? '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : 'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(windowsScript, 'utf16le').toString('base64'),
        ],
        { timeout: 8000, maxBuffer: 1024 * 1024 },
      );
      return parseWindowsServices(JSON.parse(raw.replace(/^\uFEFF/, '')), this.now());
    } catch {
      return unavailable();
    }
  }
}
