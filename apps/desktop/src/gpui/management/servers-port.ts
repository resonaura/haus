/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ServerDiskRecord,
  ServerNvrSummary,
  ServerServiceRow,
  ServerSummaryRecord,
} from '@haus/core/transport';
import type { HomeServer, ServersStatus } from '@haus/ha/server-types';
import {
  HausTerminalClient,
  type HausTerminalEvent,
  type HausTerminalOpenRequest,
  type TerminalAccessCredentials,
  type TerminalKeyStorePort,
} from '@haus/ipc/client';
import type { HausHelper } from '../../main/helper.js';
import { gpuiStateDirectory } from '../../platform/credentials.js';
import type { GpuiRpcRequest } from './integrations.js';

export interface GpuiServersPort {
  loadServers(): Promise<ServerSummaryRecord[]>;
  setServerEnabled(serverId: string, enabled: boolean): Promise<void>;
}

export interface GpuiTerminalPort {
  open(request: HausTerminalOpenRequest): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): void;
  close(sessionId: string): void;
  ack(sessionId: string, bytes: number): void;
  subscribe(listener: (event: HausTerminalEvent) => void): () => void;
  closeAll(): void;
}

export interface GpuiSystemPorts {
  readonly requestRpc: GpuiRpcRequest;
  readonly sessionKind: 'haus-hub' | 'home-assistant';
  readonly servers: GpuiServersPort;
  readonly terminal: GpuiTerminalPort;
}

const KEY_FILE = 'server-hub-keys.json';
const HEX_64 = /^[a-f0-9]{64}$/;

/** Persists pinned Ed25519 Hub identity fingerprints in user-only application state without Electron. */
export class GpuiTerminalKeyStore implements TerminalKeyStorePort {
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {}

  private keyFor(homeId: string, targetHubId: string): string {
    return `${homeId}\0${targetHubId}`;
  }

  private async loadAll(): Promise<Record<string, string>> {
    try {
      const raw = await readFile(join(this.directory, KEY_FILE), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && HEX_64.test(v)) clean[k] = v;
      }
      return clean;
    } catch {
      return {};
    }
  }

  async getPinned(homeId: string, targetHubId: string): Promise<string | undefined> {
    const all = await this.loadAll();
    return all[this.keyFor(homeId, targetHubId)];
  }

  async pin(homeId: string, targetHubId: string, fingerprintHex: string): Promise<void> {
    if (!HEX_64.test(fingerprintHex)) return;
    const entryKey = this.keyFor(homeId, targetHubId);
    const op = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const all = await this.loadAll();
        if (all[entryKey] === fingerprintHex) return;
        all[entryKey] = fingerprintHex;
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const tmp = join(this.directory, `.server-hub-keys-${randomUUID()}.tmp`);
        try {
          await writeFile(tmp, JSON.stringify(all, null, 2), { flag: 'wx', mode: 0o600 });
          await rename(tmp, join(this.directory, KEY_FILE));
        } finally {
          await rm(tmp, { force: true });
        }
      });
    this.pendingWrite = op;
    await op;
  }
}

export function normalizeHomeServer(server: HomeServer): ServerSummaryRecord {
  const host = server.host;
  const osLabel =
    [host?.operatingSystem?.name ?? host?.osName ?? host?.distribution, host?.release, host?.arch]
      .filter(Boolean)
      .join(' · ') ||
    host?.platform ||
    'Linux';
  const loadValues =
    host?.cpu?.loadAverage?.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    ) ?? [];

  const disks: ServerDiskRecord[] = (host?.disks ?? []).map((disk) => ({
    id: disk.id,
    name: disk.name,
    mountpoint: disk.mountpoint,
    filesystem: disk.filesystem,
    totalBytes: disk.totalBytes,
    usedBytes: disk.usedBytes,
    availableBytes: disk.availableBytes,
  }));

  const services: ServerServiceRow[] = [
    ...(host?.docker?.containers ?? []).map((c) => ({
      id: `docker:${c.id}`,
      name: c.name,
      manager: 'docker' as const,
      running: c.state === 'running',
      status: c.status || c.state,
      cpuPercent: c.cpuPercent,
      memoryBytes: c.memoryUsedBytes,
      uptimeSeconds: null,
    })),
    ...(host?.pm2?.processes ?? []).map((p) => ({
      id: `pm2:${p.id}`,
      name: p.name,
      manager: 'pm2' as const,
      running: p.status === 'online',
      status: p.status,
      cpuPercent: p.cpuPercent,
      memoryBytes: p.memoryBytes,
      uptimeSeconds: p.uptimeSeconds,
    })),
    ...(host?.systemServices?.services ?? []).map((s) => ({
      id: `sys:${s.id}`,
      name: s.name,
      manager: 'systemServices' as const,
      running: s.status === 'active' || s.status === 'running',
      status: s.status,
      cpuPercent: s.cpuPercent,
      memoryBytes: s.memoryBytes,
      uptimeSeconds: s.uptimeSeconds,
    })),
  ];

  const hasNvr =
    server.kind === 'nvr' ||
    Boolean(server.roles?.some((r) => r === 'storage' || r === 'stream')) ||
    Boolean(
      server.streams || server.playback || server.analysis || server.backupCopies !== undefined,
    );
  const nvr: ServerNvrSummary | undefined = hasNvr
    ? {
        hasNvr: true,
        storageAssigned: Boolean(server.roles?.includes('storage')),
        streamingAssigned: Boolean(server.roles?.includes('stream')),
        ...(server.streams
          ? { activeStreams: `${server.streams.active} / ${server.streams.max}` }
          : {}),
        ...(server.playback
          ? { playbackPrep: `${server.playback.active} / ${server.playback.max}` }
          : {}),
        ...(server.analysis
          ? { activityAssist: `${server.analysis.active} / ${server.analysis.max}` }
          : {}),
        ...(server.backupCopies !== undefined ? { backupCopies: server.backupCopies } : {}),
        usedBytes: server.storage?.usedBytes ?? null,
        limitBytes: server.settings?.storageLimitBytes ?? server.storage?.limitBytes ?? null,
      }
    : undefined;

  return {
    id: server.id,
    ...(server.managedId ? { managedId: server.managedId } : {}),
    name: server.name,
    kind: server.kind,
    ...(host?.hostname ? { hostname: host.hostname } : {}),
    ...(host?.platform ? { platform: host.platform } : {}),
    ...(host?.arch ? { architecture: host.arch } : {}),
    ...(host?.scope ? { reportingScope: host.scope } : {}),
    online: server.online,
    enabled: server.enabled !== false,
    local: server.local,
    ...(server.url ? { url: server.url } : {}),
    ...(server.lastSeen !== undefined ? { lastSeen: server.lastSeen } : {}),
    osLabel,
    cpuModel: host?.cpu?.model?.replace(/\bGfx\b/g, 'GFX') || 'Not reported',
    cpuCores: host?.cpu?.logicalCores ?? null,
    cpuUsage: host?.cpu?.usage ?? null,
    loadAverageLabel: loadValues.length
      ? loadValues.map((value) => value.toFixed(2)).join(' · ')
      : 'Not available',
    memoryUsedBytes: host?.memory?.usedBytes ?? null,
    memoryTotalBytes: host?.memory?.totalBytes ?? null,
    memoryInstalledBytes: host?.memory?.installedBytes ?? host?.memory?.totalBytes ?? null,
    swapSupported: host?.swap?.supported ?? false,
    swapUsedBytes: host?.swap?.usedBytes ?? null,
    swapTotalBytes: host?.swap?.totalBytes ?? null,
    uptimeSeconds: host?.uptimeSeconds ?? null,
    ...(host?.battery
      ? { batteryLevel: host.battery.level, batteryCharging: Boolean(host.battery.charging) }
      : {}),
    disks,
    services,
    ...(nvr ? { nvr } : {}),
    ...(server.error ? { error: server.error } : {}),
  };
}

export function createGpuiTerminalPort(
  getHubAccess: () => TerminalAccessCredentials | null,
  stateDirectory: string = gpuiStateDirectory(),
): GpuiTerminalPort {
  const listeners = new Set<(event: HausTerminalEvent) => void>();
  const client = new HausTerminalClient(
    getHubAccess,
    new GpuiTerminalKeyStore(stateDirectory),
    (event) => {
      for (const listener of listeners) listener(event);
    },
  );
  return {
    open: (request) => client.open(request),
    write: (sessionId, data) => client.write(sessionId, data),
    resize: (sessionId, cols, rows) => client.resize(sessionId, cols, rows),
    close: (sessionId) => client.close(sessionId),
    ack: (sessionId, bytes) => client.ack(sessionId, bytes),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    closeAll: () => client.closeAll(),
  };
}

export function createGpuiServersPort(getHelper: () => HausHelper | null): GpuiServersPort {
  return {
    async loadServers(): Promise<ServerSummaryRecord[]> {
      const helper = getHelper();
      if (!helper) throw new Error('Connect to a Haus Hub to view servers.');
      const payload = (await helper.request({
        method: 'GET',
        path: '/api/servers',
      })) as ServersStatus;
      return Array.isArray(payload?.servers) ? payload.servers.map(normalizeHomeServer) : [];
    },
    async setServerEnabled(serverId: string, enabled: boolean): Promise<void> {
      const helper = getHelper();
      if (!helper) throw new Error('Connect to a Haus Hub to manage servers.');
      await helper.request({
        method: 'PATCH',
        path: `/api/servers/${encodeURIComponent(serverId)}`,
        data: { enabled },
      });
    },
  };
}

export function createGpuiRuntimeSystem(options: {
  readonly getHubAccess: () => TerminalAccessCredentials | null;
  readonly getHelper: () => HausHelper | null;
  readonly getRequestRpc: () => GpuiRpcRequest;
  readonly getSessionKind: () => 'haus-hub' | 'home-assistant';
}) {
  const terminal = createGpuiTerminalPort(options.getHubAccess);
  const servers = createGpuiServersPort(options.getHelper);
  const ports: GpuiSystemPorts = {
    requestRpc: <T = unknown>(message: Record<string, unknown>) =>
      options.getRequestRpc()<T>(message),
    get sessionKind() {
      return options.getSessionKind();
    },
    servers,
    terminal,
  };
  return {
    terminal,
    snapshotPorts(): GpuiSystemPorts {
      return ports;
    },
  };
}
