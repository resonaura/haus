/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile, readdir, statfs } from 'node:fs/promises';
import { HostTelemetry, parseHostCpuModel, parseHostProc } from '@haus/ha/node/host-telemetry';
import { hubStorageUsage } from '../storage/index.js';

export { parseHostCpuModel, parseHostProc };

export interface ServersConfig {
  data: string;
  media: string;
  max_storage_gb: number;
  retention_days?: number;
  standalone?: boolean;
  token?: string;
  [key: string]: unknown;
}

export interface ServersStorePort {
  media?: string;
  totals(): Promise<{
    bytes: number;
    archivedBytes: number;
    unavailableBytes: number;
    totalBytes: number;
    localEvents: number;
    archivedEvents: number;
  }>;
}

export interface ServersCatalogPort {
  policy(name: string): string | undefined;
  savePolicy(name: string, value: string): Promise<unknown> | unknown;
}

export interface ServersClusterPort {
  refreshHealth?(): Promise<unknown>;
  status(): {
    nodes?: Array<{
      id: string;
      livePriority?: number;
      sshServerId?: string | null;
      name: string;
      url: string;
      enabled: boolean;
      roles: string[];
      online?: boolean;
      lastSeen?: number | null;
      remote?: {
        host?: unknown;
        storage?: {
          storageLimitBytes?: number | null;
          limitSource?: string;
          [key: string]: unknown;
        } | null;
        settings?: unknown;
        streams?: unknown;
        analysis?: unknown;
        playback?: unknown;
      };
      backupCopies?: number;
      error?: string | null;
    }>;
  };
}

export interface ServersOptions {
  config: ServersConfig;
  ha?: { connected?: boolean };
  runtime?: { connected?: boolean };
  store: ServersStorePort;
  catalog: ServersCatalogPort;
  cluster?: ServersClusterPort;
  backups?: {
    markChanged(): void;
    list(): ReadonlyArray<{ digest: string; kind: string; path?: string }>;
  };
  fetcher?: typeof fetch;
  read?: (path: string, encoding?: 'utf8') => Promise<string | Buffer | null>;
  list?: (path: string) => Promise<string[]>;
  filesystem?: (path: string) => Promise<{
    blocks: number | bigint;
    bfree: number | bigint;
    bavail: number | bigint;
    bsize: number | bigint;
  } | null>;
  now?: () => number;
}

export class Servers {
  config: ServersConfig;
  ha?: { connected?: boolean };
  runtime?: { connected?: boolean };
  store: ServersStorePort;
  catalog: ServersCatalogPort;
  cluster?: ServersClusterPort;
  backups?: {
    markChanged(): void;
    list(): ReadonlyArray<{ digest: string; kind: string; path?: string }>;
  };
  fetcher: typeof fetch;
  read: (path: string, encoding?: 'utf8') => Promise<string | Buffer | null>;
  filesystem: NonNullable<ServersOptions['filesystem']>;
  now: () => number;
  telemetry: HostTelemetry;
  storageUsage: ReturnType<typeof hubStorageUsage>;
  policy: { storageLimitBytes: number | null; source: string };
  cached?: Record<string, unknown>;
  cachedAt = 0;
  loading?: Promise<Record<string, unknown>>;

  constructor({
    config,
    ha,
    runtime,
    store,
    catalog,
    cluster,
    backups,
    fetcher = fetch,
    read = readFile as (path: string, encoding?: 'utf8') => Promise<string | Buffer | null>,
    list = readdir,
    filesystem = statfs,
    now = Date.now,
  }: ServersOptions) {
    this.config = config;
    this.ha = ha;
    this.runtime = runtime;
    this.store = store;
    this.catalog = catalog;
    this.cluster = cluster;
    this.backups = backups;
    this.fetcher = fetcher;
    this.read = read;
    this.filesystem = filesystem;
    this.now = now;
    this.telemetry = new HostTelemetry(config, {
      fetcher,
      read,
      list,
      filesystem,
    });
    this.storageUsage = hubStorageUsage(config, backups);
    if (!catalog) throw new Error('service_catalog_required');
    const saved = catalog.policy('primary-storage');
    this.policy = saved
      ? (JSON.parse(saved) as { storageLimitBytes: number | null; source: string })
      : {
          storageLimitBytes: config.max_storage_gb > 0 ? config.max_storage_gb * 1024 ** 3 : null,
          source: config.max_storage_gb > 0 ? 'configuration' : 'default',
        };
    this.config.max_storage_gb =
      this.policy.storageLimitBytes === null ? 0 : this.policy.storageLimitBytes / 1024 ** 3;
  }

  async update(patch: { storageLimitBytes?: unknown; [key: string]: unknown }): Promise<void> {
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      Object.keys(patch).length !== 1 ||
      !Object.hasOwn(patch, 'storageLimitBytes') ||
      (patch.storageLimitBytes !== null &&
        (typeof patch.storageLimitBytes !== 'number' ||
          !Number.isSafeInteger(patch.storageLimitBytes) ||
          patch.storageLimitBytes < 1024 ** 2))
    )
      throw new Error('invalid_storage_limit');
    const limit = patch.storageLimitBytes as number | null;
    const policy = {
      storageLimitBytes: limit,
      source: 'user',
    };
    await this.catalog.savePolicy('primary-storage', JSON.stringify(policy));
    this.policy = policy;
    this.config.max_storage_gb = limit === null ? 0 : limit / 1024 ** 3;
    this.backups?.markChanged();
    this.cached = undefined;
  }

  isOnline(): boolean {
    return Boolean(this.runtime?.connected ?? this.ha?.connected);
  }

  async primary(): Promise<Record<string, unknown>> {
    const at = this.now();
    // Coalesce callers without aliasing a one-second UI timer into two-second updates.
    if (this.cached && at - this.cachedAt < 250) return this.cached;
    if (this.loading) return this.loading;
    this.loading = this.collect(at)
      .then((value) => {
        this.cached = value;
        this.cachedAt = at;
        return value;
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  async collect(at: number): Promise<Record<string, unknown>> {
    const [host, fs] = await Promise.all([
      this.telemetry.collect(at),
      this.filesystem(this.config.media ?? this.store.media ?? '').catch(() => null),
    ]);
    const totals = await this.store.totals();
    const usedBytes = totals.bytes,
      freeBytes = fs ? Number(fs.bavail) * Number(fs.bsize) : null;
    const reserveBytes = 256 * 1024 ** 2;
    const availableBytes =
      freeBytes === null
        ? null
        : Math.max(
            0,
            Math.min(
              freeBytes - reserveBytes,
              this.policy.storageLimitBytes === null
                ? Infinity
                : this.policy.storageLimitBytes - usedBytes,
            ),
          );
    return {
      id: 'home-assistant',
      kind: 'home-assistant',
      name: 'Home Assistant',
      online: this.isOnline(),
      lastSeen: at,
      enabled: true,
      roles: ['storage', 'stream'],
      host,
      settings: { ...this.policy },
      storage: {
        ...(this.storageUsage ? { usage: this.storageUsage.status() } : {}),
        usedBytes,
        localBytes: usedBytes,
        archivedBytes: totals.archivedBytes,
        unavailableBytes: totals.unavailableBytes,
        totalRecordingBytes: totals.totalBytes,
        localEvents: totals.localEvents,
        archivedEvents: totals.archivedEvents,
        cachePolicy: 'verified-archive',
        reservedBytes: 0,
        reserveBytes,
        freeBytes,
        totalBytes: fs ? Number(fs.blocks) * Number(fs.bsize) : null,
        availableBytes,
        maxBytes:
          availableBytes === null ? this.policy.storageLimitBytes : usedBytes + availableBytes,
        storageLimitBytes: this.policy.storageLimitBytes,
        limitSource: this.policy.source,
        retentionDays: this.config.retention_days,
      },
    };
  }

  async status(): Promise<{
    features: { monitoringOnlyServers: true };
    servers: Array<Record<string, unknown>>;
    sampledAt: number;
  }> {
    // A slow/offline peer must not hold HA and other last-known cards hostage.
    // Cluster owns/coalesces the bounded refresh and waits for it on shutdown.
    void this.cluster?.refreshHealth?.().catch(() => {});
    const primary = await this.primary();
    const remotes = (this.cluster?.status().nodes ?? []).map((node) => ({
      id: node.id,
      livePriority: node.livePriority ?? 0,
      ...(node.sshServerId ? { sshServerId: node.sshServerId } : {}),
      kind: 'nvr',
      name: node.name,
      url: node.url,
      enabled: node.enabled,
      roles: node.roles,
      online: Boolean(node.online),
      lastSeen: node.lastSeen ?? null,
      host: node.remote?.host ?? null,
      storage: node.remote?.storage ?? null,
      settings: node.remote?.settings ?? {
        storageLimitBytes: node.remote?.storage?.storageLimitBytes ?? null,
        source: node.remote?.storage?.limitSource ?? 'default',
      },
      streams: node.remote?.streams,
      analysis: node.remote?.analysis,
      playback: node.remote?.playback,
      backupCopies: node.backupCopies,
      error: node.error,
    }));
    return {
      features: { monitoringOnlyServers: true },
      servers: [{ ...primary, online: this.isOnline() }, ...remotes],
      sampledAt: this.now(),
    };
  }
}
