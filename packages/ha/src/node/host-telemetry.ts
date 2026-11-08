/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile, readdir, statfs } from 'node:fs/promises';
import { parseHostCpuModel, parseHostProc } from '@haus/servers/os';

import { homeAssistantDisks } from './host-disks.js';
import { homeAssistantGraphics, type HostGraphicsReport } from './host-gpus.js';
import { linuxInstalledMemory } from './host-memory.js';
import { homeAssistantServices } from './host-services.js';
import { HostServiceCounters, type HostServiceSnapshot } from './host-service-counters.js';

export { parseHostCpuModel, parseHostProc } from '@haus/servers/os';
export type { HostProcParsed } from '@haus/servers/os';

const nullableNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function text(value: unknown, fallback: string): string;
function text(value: unknown, fallback?: null): string | null;
function text(value: unknown, fallback: string | null = null): string | null {
  return typeof value === 'string' ? value.slice(0, 240) : fallback;
}
const unavailable = () => ({ available: false, source: 'unavailable', containers: [] });

const container = (
  id: string,
  name: unknown,
  info: { image?: unknown } | null | undefined,
  stats:
    { cpu_percent?: unknown; memory_usage?: unknown; memory_limit?: unknown } | null | undefined,
  state: unknown = 'running',
) => ({
  id,
  name: text(name, id),
  image: text(info?.image),
  state: text(state, 'unknown'),
  status: text(state, 'unknown'),
  cpuPercent: nullableNumber(stats?.cpu_percent),
  memoryUsedBytes: nullableNumber(stats?.memory_usage),
  memoryLimitBytes: nullableNumber(stats?.memory_limit),
});

export interface HostTelemetryConfig {
  standalone?: boolean;
  token?: string;
  media: string;
}

export interface HostTelemetrySnapshot {
  sampledAt: string;
  scope: string;
  source: string;
  hostname: string | null;
  platform: string | null;
  osName: string | null;
  gpus?: HostGraphicsReport;
  release: string | null;
  arch: string | null;
  uptimeSeconds: number | null;
  cpu: {
    model: string | null;
    logicalCores: number | null;
    usage: number | null;
    loadAverage: number[];
  };
  memory: {
    totalBytes: number | null;
    availableBytes: number | null;
    usedBytes: number | null;
    installedBytes: number | null;
  };
  swap: { supported: boolean; totalBytes: number | null; usedBytes: number | null };
  disks: Array<Record<string, unknown>>;
  docker: Record<string, unknown>;
  pm2: { available: false; source: 'unavailable'; processes: never[] };
  systemServices: HostServiceSnapshot;
}

type FilesystemStat = {
  blocks: number | bigint;
  bfree: number | bigint;
  bavail: number | bigint;
  bsize: number | bigint;
};

export class HostTelemetry {
  config: HostTelemetryConfig;
  fetcher: typeof fetch;
  read: (path: string, encoding?: 'utf8') => Promise<string | Buffer | null>;
  list: (path: string) => Promise<string[]>;
  filesystem: (path: string) => Promise<FilesystemStat | null>;
  appStats = new Map<
    string,
    { sampledAt: number; data: Record<string, unknown> & { cpu_percent: number | null } }
  >();
  cpuSamples = new Map<string, { usage: number; system: number; at: number }>();
  appCursor = 0;
  serviceCounters: Pick<HostServiceCounters, 'collect' | 'snapshot' | 'stop'> | null;
  deadline?: number;
  value?: HostTelemetrySnapshot;
  inventoryRefresh?: Promise<void>;
  inventoryAt = 0;
  previousCpu?: { total: number; idle: number } | null;
  latestProcAt?: number;
  graphicsAt?: number;
  graphics?: HostGraphicsReport;
  installedMemoryAt?: number;
  installedMemory?: number | null;

  constructor(
    config: HostTelemetryConfig,
    {
      fetcher = fetch,
      read = readFile as (path: string, encoding?: 'utf8') => Promise<string | Buffer | null>,
      list = readdir,
      filesystem = statfs,
      serviceCounters,
    }: {
      fetcher?: typeof fetch;
      read?: (path: string, encoding?: 'utf8') => Promise<string | Buffer | null>;
      list?: (path: string) => Promise<string[]>;
      filesystem?: (path: string) => Promise<FilesystemStat | null>;
      serviceCounters?: Pick<HostServiceCounters, 'collect' | 'snapshot' | 'stop'> | null;
    } = {},
  ) {
    this.config = config;
    this.fetcher = fetcher;
    this.read = read;
    this.list = list;
    this.filesystem = filesystem;
    this.serviceCounters =
      serviceCounters ?? (!config.standalone ? new HostServiceCounters() : null);
  }

  async supervisor(path: string): Promise<Record<string, unknown> | null> {
    if (this.config.standalone) return null;
    try {
      const response = await this.fetcher(`http://supervisor${path}`, {
        headers: { Authorization: `Bearer ${this.config.token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(1500, (this.deadline ?? Infinity) - Date.now())),
        ),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const body = await response.text();
      if (body.length > 1000000) return null;
      const value = JSON.parse(body) as { result?: string; data?: Record<string, unknown> };
      return value.result === 'ok' ? (value.data ?? null) : null;
    } catch {
      return null;
    }
  }

  async stats(
    path: string,
  ): Promise<(Record<string, unknown> & { cpu_percent: number | null }) | null> {
    const stats =
      (await this.supervisor(`${path}?one_shot=true`)) ??
      (Date.now() < (this.deadline ?? 0) ? await this.supervisor(path) : null);
    if (!stats) return null;
    // Supervisor one-shot samples expose cumulative counters but no measurement
    // window. Match Supervisor's whole-host percentage across our bounded polls.
    const previous = this.cpuSamples.get(path);
    const at = Date.now();
    const usage = nullableNumber(stats.cpu_usage);
    const system = nullableNumber(stats.cpu_system_usage);
    let percent = nullableNumber(stats.cpu_percent);
    if (
      percent === null &&
      previous &&
      at - previous.at <= 60000 &&
      usage !== null &&
      system !== null &&
      usage >= previous.usage &&
      system > previous.system
    )
      percent = Math.min(100, ((usage - previous.usage) / (system - previous.system)) * 100);
    if (usage !== null && system !== null) this.cpuSamples.set(path, { usage, system, at });
    else this.cpuSamples.delete(path);
    return { ...stats, cpu_percent: percent };
  }

  async collect(at: number, inventory = false): Promise<HostTelemetrySnapshot> {
    if (this.value && !this.config.standalone && !inventory) {
      if (!this.inventoryRefresh && at - this.inventoryAt >= 10000)
        this.inventoryRefresh = this.collect(at, true)
          .then(() => undefined)
          .catch(() => {})
          .finally(() => {
            this.inventoryRefresh = undefined;
          });
      const [stat, meminfo, uptime, loadavg] = await Promise.all(
        ['stat', 'meminfo', 'uptime', 'loadavg'].map((name) =>
          this.read(`/proc/${name}`, 'utf8').catch(() => null),
        ),
      );
      if (typeof stat !== 'string' || typeof meminfo !== 'string') return this.value;
      const proc = parseHostProc(stat, meminfo, typeof uptime === 'string' ? uptime : '');
      let usage: number | null = null;
      if (this.previousCpu && proc.cpuTimes && proc.cpuTimes.total > this.previousCpu.total)
        usage = Math.max(
          0,
          Math.min(
            1,
            1 -
              (proc.cpuTimes.idle - this.previousCpu.idle) /
                (proc.cpuTimes.total - this.previousCpu.total),
          ),
        );
      this.previousCpu = proc.cpuTimes;
      this.latestProcAt = at;
      this.value = {
        ...this.value,
        sampledAt: new Date(at).toISOString(),
        uptimeSeconds: proc.uptimeSeconds,
        cpu: {
          ...this.value.cpu,
          usage,
          logicalCores: proc.logicalCores,
          loadAverage:
            typeof loadavg === 'string'
              ? loadavg.trim().split(/\s+/).slice(0, 3).map(Number).filter(Number.isFinite)
              : [],
        },
        memory: { ...proc.memory, installedBytes: this.value.memory.installedBytes },
        swap: proc.swap,
        systemServices: this.serviceCounters?.snapshot() ?? this.value.systemServices,
      };
      return this.value;
    }
    this.inventoryAt = at;
    this.deadline = Date.now() + 2500;
    const [
      info,
      core,
      stats,
      apps,
      diskInfo,
      files,
      hardware,
      mountinfo,
      mediaFilesystem,
      systemServices,
      serviceCounters,
    ] = await Promise.all([
      this.supervisor('/host/info'),
      this.supervisor('/core/info'),
      this.stats('/core/stats'),
      this.supervisor('/addons'),
      this.supervisor('/host/disks'),
      this.config.standalone
        ? null
        : Promise.all(
            ['stat', 'meminfo', 'uptime', 'cpuinfo', 'loadavg'].map((name) =>
              this.read(`/proc/${name}`, 'utf8').catch(() => null),
            ),
          ),
      this.supervisor('/hardware/info'),
      this.read('/proc/self/mountinfo', 'utf8').catch(() => ''),
      this.filesystem(this.config.media).catch(() => null),
      this.supervisor('/host/services'),
      this.serviceCounters?.collect(),
    ]);
    const proc =
      typeof files?.[0] === 'string' && typeof files?.[1] === 'string'
        ? parseHostProc(files[0], files[1], typeof files[2] === 'string' ? files[2] : '')
        : null;
    let cpuUsage: number | null = null;
    if (this.previousCpu && proc?.cpuTimes && proc.cpuTimes.total > this.previousCpu.total)
      cpuUsage = Math.max(
        0,
        Math.min(
          1,
          1 -
            (proc.cpuTimes.idle - this.previousCpu.idle) /
              (proc.cpuTimes.total - this.previousCpu.total),
        ),
      );
    if (this.latestProcAt === undefined || at >= this.latestProcAt) {
      this.previousCpu = proc?.cpuTimes;
      this.latestProcAt = at;
    }
    const disks = homeAssistantDisks({
      hardware: hardware as Parameters<typeof homeAssistantDisks>[0]['hardware'],
      diskInfo: diskInfo as Parameters<typeof homeAssistantDisks>[0]['diskInfo'],
      hostInfo: info as Parameters<typeof homeAssistantDisks>[0]['hostInfo'],
      media: this.config.media,
      mountinfo: typeof mountinfo === 'string' ? mountinfo : '',
      mediaFilesystem,
    });
    const containers: Array<ReturnType<typeof container> & { sampledAt?: string | null }> = core
      ? [
          container(
            'home-assistant-core',
            'Home Assistant',
            core,
            stats,
            stats ? 'running' : 'unknown',
          ),
        ]
      : [];
    const addons = Array.isArray(apps?.addons)
      ? (apps.addons as Array<{ slug?: unknown; name?: unknown; image?: unknown; state?: unknown }>)
      : [];
    const list = addons
      .slice(0, 64)
      .filter(
        (app): app is { slug: string; name?: unknown; image?: unknown; state?: unknown } =>
          typeof app.slug === 'string' && /^[a-zA-Z0-9_-]+$/.test(app.slug),
      );
    const current = new Set(list.map((app) => app.slug));
    for (const path of this.cpuSamples.keys())
      if (path !== '/core/stats' && !current.has(path.split('/')[2] ?? ''))
        this.cpuSamples.delete(path);
    for (const id of this.appStats.keys()) if (!current.has(id)) this.appStats.delete(id);
    const cursor = this.appCursor % Math.max(1, list.length);
    const ordered = [...list.slice(cursor), ...list.slice(0, cursor)];
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, ordered.length) }, async () => {
        while (index < ordered.length && Date.now() < (this.deadline ?? 0)) {
          const app = ordered[index++]!;
          if (app.state !== 'started') continue;
          const usage = await this.stats(`/addons/${app.slug}/stats`);
          if (usage) this.appStats.set(app.slug, { sampledAt: at, data: usage });
        }
      }),
    );
    this.appCursor = (cursor + index) % Math.max(1, list.length);
    for (const app of list) {
      const cached = this.appStats.get(app.slug);
      const usage =
        app.state === 'started' && cached && at - cached.sampledAt < 30000 ? cached.data : null;
      containers.push({
        ...container(app.slug, app.name, app, usage, app.state),
        sampledAt: usage && cached ? new Date(cached.sampledAt).toISOString() : null,
      });
    }
    const bootTimestamp =
      typeof info?.boot_timestamp === 'number' && info.boot_timestamp > 0
        ? info.boot_timestamp
        : null;
    const boot = bootTimestamp !== null ? Math.max(0, at / 1000 - bootTimestamp / 1000000) : null;
    if (this.graphicsAt === undefined || at - this.graphicsAt >= 60000) {
      this.graphicsAt = at;
      this.graphics = await homeAssistantGraphics(
        hardware as Parameters<typeof homeAssistantGraphics>[0],
        {
          read: this.read,
          now: () => at,
        },
      );
    }
    if (this.installedMemoryAt === undefined || at - this.installedMemoryAt >= 60000) {
      this.installedMemoryAt = at;
      this.installedMemory = await linuxInstalledMemory({ list: this.list, read: this.read });
    }
    const host: HostTelemetrySnapshot = {
      sampledAt: new Date(at).toISOString(),
      scope: 'host',
      source: files ? 'linux-proc-and-supervisor' : 'supervisor',
      hostname: text(info?.hostname),
      platform: text(info?.operating_system),
      osName: text(info?.operating_system),
      gpus: this.graphics,
      release: text(info?.kernel),
      arch: text(core?.arch),
      uptimeSeconds: proc?.uptimeSeconds ?? boot,
      cpu: {
        model: parseHostCpuModel(files?.[3]),
        logicalCores: proc?.logicalCores ?? null,
        usage: cpuUsage,
        loadAverage:
          typeof files?.[4] === 'string'
            ? files[4].trim().split(/\s+/).slice(0, 3).map(Number).filter(Number.isFinite)
            : [],
      },
      memory: {
        ...(proc?.memory ?? { totalBytes: null, availableBytes: null, usedBytes: null }),
        installedBytes: nullableNumber(this.installedMemory),
      },
      swap: proc?.swap ?? { supported: false, totalBytes: null, usedBytes: null },
      disks,
      docker:
        core || apps
          ? {
              available: true,
              source: 'supervisor',
              cpuPercentBasis: 'host',
              containers: containers.sort((a, b) => a.name.localeCompare(b.name)),
              scope: 'managed-containers',
            }
          : unavailable(),
      pm2: { available: false, source: 'unavailable', processes: [] },
      systemServices:
        serviceCounters ??
        homeAssistantServices(systemServices as Parameters<typeof homeAssistantServices>[0], at),
    };
    if (inventory && this.value && Date.parse(this.value.sampledAt) >= at) {
      const latest = this.value;
      host.sampledAt = latest.sampledAt;
      host.cpu = { ...host.cpu, usage: latest.cpu.usage, loadAverage: latest.cpu.loadAverage };
      host.memory = {
        ...latest.memory,
        installedBytes: host.memory.installedBytes ?? latest.memory.installedBytes,
      };
      host.swap = latest.swap;
      host.uptimeSeconds = latest.uptimeSeconds;
      if (
        Date.parse(latest.systemServices?.sampledAt ?? '') >
        Date.parse(host.systemServices?.sampledAt ?? '')
      )
        host.systemServices = latest.systemServices;
    }
    this.value = host;
    return host;
  }

  stop(): void {
    this.serviceCounters?.stop();
  }
}
