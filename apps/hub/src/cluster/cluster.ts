/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { nodeJson, nodeRequest } from '@haus/servers';
import { isRecord } from '@haus/core/record';
import {
  archivedMedia,
  RecordingCache,
  type ArchiveEventRecord,
  type ArchiveVariant,
  type RecordingCacheCatalog,
  type RecordingCacheConfig,
  type RecordingCacheStore,
} from '../events/index.js';
import type { ClusterCatalog } from './catalog.js';
import { ClusterEnrollment } from './enrollment.js';
import { validSshServerId } from './nodes.js';
import { ClusterHealthTracker, type ClusterHealthEntry, type ClusterNode } from './health.js';
import { playbackCandidates, prepareClusterPlayback } from './playback.js';
import {
  ClusterReplicationEngine,
  type ClusterReplicationBackupItem,
  type ClusterReplicationHost,
} from './replication.js';

export type ClusterStore = ClusterReplicationHost['store'] &
  RecordingCacheStore & {
    clusterCatalog?: ClusterCatalog;
  };

export interface ClusterBackups {
  list(): ClusterReplicationBackupItem[];
  path(digest: string): string;
  markChanged(): void;
  retry(kind: string): { readonly nextAt: number } | null | undefined;
  canSnapshot(kind?: string): boolean;
  snapshot(kind?: string): Promise<ClusterReplicationBackupItem | null | undefined>;
  busy?: boolean;
  error?: string;
}

export class Cluster implements ClusterReplicationHost {
  private readonly enrollment: ClusterEnrollment;
  private readonly mutations = new Set<Promise<unknown>>();
  private stopping?: Promise<void>;
  store: ClusterStore;
  backups: ClusterBackups;
  catalog: ClusterCatalog;
  now: () => number;
  health = new Map<string, ClusterHealthEntry>();
  stopped = false;
  abort = new AbortController();
  errors = new Map<string, string>();
  playbackNodes = new Set<string>();
  blobPins = new Map<string, number>();
  blobDeletes = new Map<string, Promise<void>>();
  healthTracker: ClusterHealthTracker;
  replicationEngine: ClusterReplicationEngine;
  recordingCache?: RecordingCache;
  archiveCursor?: { at: number; id: string };

  constructor(
    store: ClusterStore,
    backups: ClusterBackups,
    { catalog, now = Date.now }: { catalog?: ClusterCatalog; now?: () => number } = {},
  ) {
    if (!catalog) throw new Error('cluster_catalog_required');
    this.store = store;
    this.backups = backups;
    this.catalog = catalog;
    this.enrollment = new ClusterEnrollment(this);
    this.now = now;
    this.healthTracker = new ClusterHealthTracker(this);
    this.replicationEngine = new ClusterReplicationEngine(this);
  }

  async initialize(): Promise<void> {
    await this.catalog.initialize();
    this.store.clusterCatalog = this.catalog;
  }

  nodes(): ClusterNode[] {
    return this.catalog.nodes().map((row) => {
      const parsed = JSON.parse(row.value) as ClusterNode;
      return { ...parsed, id: row.id };
    });
  }

  /** Pins synchronize replica adoption and temporary playback against pruning. */
  async pinBlob(nodeId: string, digest: string): Promise<() => void> {
    const key = `${nodeId}:${digest}`;
    while (this.blobDeletes.has(key)) await this.blobDeletes.get(key);
    this.abort.signal.throwIfAborted();
    this.blobPins.set(key, (this.blobPins.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.blobPins.get(key) ?? 1) - 1;
      if (remaining) this.blobPins.set(key, remaining);
      else this.blobPins.delete(key);
    };
  }

  notePlaybackUpload(nodeId: string, digest: string): Promise<void> {
    return this.catalog.ensureLocation(digest, nodeId, 'preparation');
  }

  canPreparePlayback(): boolean {
    return playbackCandidates(this).length > 0;
  }

  preparePlayback(
    event: { id: string; duration?: number },
    options: { output: string; audioTrimSeconds?: number; signal?: AbortSignal },
  ): Promise<boolean> {
    return prepareClusterPlayback(this, event, options);
  }

  status() {
    const backups = this.backups.list();
    return {
      optional: true,
      nodes: this.nodes().map(({ key: _key, ...node }) => ({
        ...node,
        ...this.health.get(node.id),
        error: this.errors.get(node.id),
        backupCopies: this.catalog.backupCount(node.id),
      })),
      backups: {
        items: backups,
        busy: this.backups.busy,
        error: this.backups.error,
      },
      sync: { enabled: true, authority: 'helper' },
      busy: this.busy,
    };
  }

  add(input: unknown) {
    return this.mutate(() => this.enrollment.add(input));
  }

  update(id: string, patch: unknown) {
    return this.mutate(() => this.updateNode(id, patch));
  }

  private async updateNode(id: string, patch: unknown) {
    const node = this.nodes().find((item) => item.id === id);
    if (!node) throw new Error('invalid_node');
    if (!isRecord(patch)) throw Error('invalid_node');
    const raw = { ...patch };
    if (
      !Object.keys(raw).length ||
      Object.keys(raw).some(
        (key) => !['enabled', 'storageLimitBytes', 'sshServerId', 'livePriority'].includes(key),
      ) ||
      (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') ||
      (raw.livePriority !== undefined &&
        (typeof raw.livePriority !== 'number' ||
          !Number.isInteger(raw.livePriority) ||
          raw.livePriority < 0 ||
          raw.livePriority > 100)) ||
      (raw.sshServerId !== undefined &&
        raw.sshServerId !== null &&
        !validSshServerId(raw.sshServerId)) ||
      (Object.hasOwn(raw, 'sshServerId') && Object.keys(raw).length !== 1) ||
      (raw.storageLimitBytes !== undefined &&
        raw.storageLimitBytes !== null &&
        (typeof raw.storageLimitBytes !== 'number' ||
          !Number.isSafeInteger(raw.storageLimitBytes) ||
          raw.storageLimitBytes < 1024 ** 2))
    )
      throw new Error('invalid_node');
    if (
      raw.sshServerId &&
      this.nodes().some((item) => item.id !== id && item.sshServerId === raw.sshServerId)
    )
      throw new Error('invalid_duplicate_ssh_server');
    if (Object.hasOwn(raw, 'storageLimitBytes')) {
      const settings = (await nodeJson(node, '/v1/settings', {
        method: 'PATCH',
        data: { storageLimitBytes: raw.storageLimitBytes },
        signal: this.abort.signal,
        timeout: 10000,
      })) as { storageLimitBytes?: number | null };
      if (settings.storageLimitBytes !== raw.storageLimitBytes)
        throw new Error('invalid_node_settings');
      const health = this.health.get(id);
      if (health?.remote)
        this.health.set(id, {
          ...health,
          remote: {
            ...health.remote,
            settings,
            storage: health.remote.storage
              ? {
                  ...health.remote.storage,
                  storageLimitBytes: settings.storageLimitBytes,
                }
              : undefined,
          },
        });
    }
    if (Object.hasOwn(raw, 'sshServerId'))
      await this.catalog.associateNode(id, raw.sshServerId ?? null);
    else
      await this.catalog.patchNode(id, {
        ...(raw.livePriority !== undefined ? { livePriority: raw.livePriority } : {}),
        ...(raw.enabled !== undefined ? { enabled: raw.enabled } : {}),
      });
    this.invalidateHealth();
    this.backups.markChanged();
    return this.status();
  }

  remove(id: string) {
    return this.mutate(async () => {
      await this.catalog.removeNode(id);
      this.health.delete(id);
      this.invalidateHealth();
      this.backups.markChanged();
      return this.status();
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopped || this.abort.signal.aborted) return Promise.reject(Error('cluster_stopped'));
    // Promise executes its constructor callback synchronously, assigning begin before use.
    let begin!: () => void;
    const pending = new Promise<T>((resolve, reject) => {
      begin = () => {
        try {
          void operation().then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      };
    });
    this.mutations.add(pending);
    const release = () => {
      this.mutations.delete(pending);
    };
    // The caller owns its result; shutdown also joins rejected work before releasing storage.
    void pending.then(release, release);
    begin();
    return pending;
  }

  get busy(): boolean {
    return this.replicationEngine.busy;
  }

  set busy(val: boolean) {
    this.replicationEngine.busy = val;
  }

  get running(): Promise<void> | undefined {
    return this.replicationEngine.running;
  }

  set running(val: Promise<void> | undefined) {
    this.replicationEngine.running = val;
  }

  get healthRevision(): number {
    return this.healthTracker.revision;
  }

  set healthRevision(val: number) {
    this.healthTracker.revision = val;
  }

  get healthSampledAt(): number | undefined {
    return this.healthTracker.sampledAt;
  }

  set healthSampledAt(val: number | undefined) {
    this.healthTracker.sampledAt = val;
  }

  get healthRefresh(): Promise<void> | undefined {
    return this.healthTracker.running;
  }

  get healthRefreshForced(): boolean {
    return this.healthTracker.refreshForced;
  }

  get forcedHealthRefresh(): Promise<void> | undefined {
    return this.healthTracker.forcedRunning;
  }

  invalidateHealth(): void {
    this.healthTracker.invalidate();
  }

  refreshHealth(options?: { force?: boolean }): Promise<void> {
    return this.healthTracker.refresh(options);
  }

  poll(): Promise<void> {
    return this.healthTracker.poll();
  }

  replicate(file: string, digest: string, kind: string, nodes: ClusterNode[]): Promise<void> {
    return this.replicationEngine.replicate(file, digest, kind, nodes);
  }

  replicatePinned(file: string, digest: string, kind: string, nodes: ClusterNode[]): Promise<void> {
    return this.replicationEngine.replicatePinned(file, digest, kind, nodes);
  }

  tick(): Promise<void> | undefined {
    return this.replicationEngine.tick();
  }

  work(): Promise<void> {
    return this.replicationEngine.work();
  }

  prune(nodes: ClusterNode[]): Promise<void> {
    return this.replicationEngine.prune(nodes);
  }

  enableRecordingCache(
    config: RecordingCacheConfig,
    catalog: RecordingCacheCatalog,
  ): RecordingCache {
    this.recordingCache = new RecordingCache(config, this.store, this, catalog);
    return this.recordingCache;
  }

  archiveMedia(
    event: ArchiveEventRecord,
    variant: ArchiveVariant,
    range?: string,
    signal?: AbortSignal,
    method?: string,
  ): ReturnType<typeof archivedMedia> {
    return archivedMedia(this, event, variant, range, signal, method);
  }

  async source(event: {
    id: string;
    playbackVersion?: number;
  }): Promise<{ url: string; expiresAt?: number } | null> {
    const media = this.catalog.media(event.id);
    if (media?.version !== event.playbackVersion) return null;
    if (!media) return null;
    const locations = new Set(
      this.catalog.locationsForDigest(media.digest).map((row) => row.nodeId),
    );
    const nodes = this.nodes()
      .filter(
        (node) =>
          node.enabled &&
          node.roles.includes('stream') &&
          locations.has(node.id) &&
          this.health.get(node.id)?.online,
      )
      .sort(
        (a, b) =>
          (this.health.get(a.id)?.remote?.streams?.active ?? 0) -
          (this.health.get(b.id)?.remote?.streams?.active ?? 0),
      );
    for (const node of nodes) {
      try {
        const grant = (await nodeJson(node, '/v1/grants', {
          method: 'POST',
          data: { digest: media.digest },
          signal: this.abort.signal,
          timeout: 5000,
        })) as { path?: string; expiresAt?: number };
        if (typeof grant.path !== 'string' || !grant.path.startsWith(`/media/${media.digest}?`))
          continue;
        return {
          url: new URL(grant.path, node.url).href,
          expiresAt: grant.expiresAt,
        };
      } catch {
        /* Try next stream candidate */
      }
    }
    return null;
  }

  async media(
    event: { id: string; playbackVersion?: number },
    range?: string,
    signal?: AbortSignal,
  ): Promise<Response | null> {
    const media = this.catalog.media(event.id);
    if (media?.version !== event.playbackVersion) return null;
    if (!media) return null;
    const locations = new Set(
      this.catalog.locationsForDigest(media.digest).map((row) => row.nodeId),
    );
    const candidates = this.nodes()
      .filter(
        (node) =>
          node.enabled &&
          node.roles.includes('stream') &&
          locations.has(node.id) &&
          this.health.get(node.id)?.online,
      )
      .sort(
        (a, b) =>
          (this.health.get(a.id)?.remote?.streams?.active ?? 0) -
          (this.health.get(b.id)?.remote?.streams?.active ?? 0),
      );
    for (const node of candidates) {
      try {
        const response = await nodeRequest(node, `/v1/blobs/${media.digest}`, {
          signal,
          timeout: 600000,
          headerTimeout: 3000,
          headers: range ? { Range: range } : {},
        });
        if (response.ok) return response;
        await response.body?.cancel();
      } catch {
        /* Try next stream candidate */
      }
    }
    return null;
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.stopping = Promise.resolve().then(async () => {
      await Promise.allSettled([
        ...this.mutations,
        this.running,
        this.healthRefresh,
        this.forcedHealthRefresh,
        this.recordingCache?.running,
      ]);
    });
    // Abort listeners may synchronously join stop(); publish the shared barrier first.
    this.abort.abort();
    return this.stopping;
  }
}
