/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { In, type EntityManager } from 'typeorm';
import type { ClusterWorkloadRow } from '../../storage/cluster/entities.js';
import {
  StandaloneHomeEntryEntity,
  type StandaloneHomeEntryRow,
} from '../../storage/standalone/entities.js';
import type {
  CacheBundlePayload,
  ConfigBundlePayload,
  CredentialBundlePayload,
} from './snapshot.js';
import type { TelemetryDeltaPayload } from './telemetry.js';

const MAX_CACHE_HISTORY_BYTES = 1024 * 1024;
const MAX_HISTORY_ROW_BYTES = 16 * 1024;
const MAX_HISTORY_POINTS_PER_ENDPOINT = 20;

const PRUNABLE_CONFIG_KINDS = new Set([
  'room',
  'device',
  'device_alias',
  'scene',
  'script',
  'automation',
  'app',
  'ignored_matter_node',
  'integration_entry',
  'repair_issue',
]);

export function clearPeerSentDigests(
  peerLastSentDigest: Map<string, string>,
  peerLastSentStatesDigest: Map<string, string>,
  peerId: string,
): void {
  const prefix = `${peerId}:`;
  for (const key of peerLastSentDigest.keys()) {
    if (key.startsWith(prefix)) peerLastSentDigest.delete(key);
  }
  peerLastSentStatesDigest.delete(peerId);
}

/** Ensures replicated standby Apps stay stopped and local containerId/logs are never clobbered. */
export function normalizeReplicatedAppValue(
  rawValue: string,
  entryId: string,
  localHubId: string,
  ownership: ReadonlyMap<string, ClusterWorkloadRow>,
  existingApps: ReadonlyMap<string, Record<string, unknown>>,
): string {
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    const wl = ownership.get(`app:${entryId}`);
    const localActiveOwner = wl && wl.ownerHubId === localHubId && wl.state === 'active';
    if (!localActiveOwner) {
      return JSON.stringify({ ...parsed, state: 'stopped', containerId: undefined });
    }
    const local = existingApps.get(entryId);
    const localContainerId =
      typeof local?.containerId === 'string' && local.containerId.length > 0
        ? local.containerId
        : undefined;
    return JSON.stringify({
      ...parsed,
      containerId: localContainerId,
      ...(Array.isArray(local?.logs) ? { logs: local.logs } : {}),
      ...(parsed.image === undefined && local?.image !== undefined ? { image: local.image } : {}),
    });
  } catch {
    return rawValue;
  }
}

/** Filters out stale incoming rows whose updatedAt lags the receiver's persisted row. */
export async function filterFreshRows(
  manager: EntityManager,
  incoming: readonly StandaloneHomeEntryRow[],
  kinds: readonly string[],
): Promise<StandaloneHomeEntryRow[]> {
  if (incoming.length === 0) return [];
  const existing = await manager.find(StandaloneHomeEntryEntity, {
    select: { kind: true, entryId: true, updatedAt: true },
    where: { kind: In([...kinds]) },
  });
  const latest = new Map<string, number>();
  for (const row of existing) {
    latest.set(`${row.kind}:${row.entryId}`, row.updatedAt);
  }
  return incoming.filter((row) => {
    const prevAt = latest.get(`${row.kind}:${row.entryId}`);
    return prevAt === undefined || row.updatedAt >= prevAt;
  });
}

/**
 * Removes standby config rows that were deleted on the authoritative coordinator,
 * while preserving rows belonging to workloads actively owned by this node.
 */
export async function pruneDeletedConfigRows(
  manager: EntityManager,
  incoming: readonly StandaloneHomeEntryRow[],
  localActiveWorkloadIds: ReadonlySet<string>,
  preservedRoomIds?: ReadonlySet<string>,
): Promise<number> {
  const incomingKeys = new Set(incoming.map((row) => `${row.kind}:${row.entryId}`));
  const existing = await manager.find(StandaloneHomeEntryEntity, {
    select: { kind: true, entryId: true },
    where: { kind: In([...PRUNABLE_CONFIG_KINDS]) },
  });
  let removed = 0;
  for (const row of existing) {
    if (incomingKeys.has(`${row.kind}:${row.entryId}`)) continue;
    if (row.kind === 'room' && preservedRoomIds?.has(row.entryId)) continue;
    if (row.kind === 'app' && localActiveWorkloadIds.has(`app:${row.entryId}`)) continue;
    if (
      row.kind === 'integration_entry' &&
      (localActiveWorkloadIds.has(`integration:${row.entryId}`) ||
        localActiveWorkloadIds.has(`integration:tuya:${row.entryId}`))
    ) {
      continue;
    }
    await manager.delete(StandaloneHomeEntryEntity, { kind: row.kind, entryId: row.entryId });
    removed += 1;
  }
  return removed;
}

function trimHistoryRow(row: StandaloneHomeEntryRow): StandaloneHomeEntryRow | undefined {
  let value = row.value;
  if (Buffer.byteLength(value, 'utf8') > MAX_HISTORY_ROW_BYTES) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
      let count = Math.min(parsed.length, MAX_HISTORY_POINTS_PER_ENDPOINT);
      while (count > 0) {
        const candidate = JSON.stringify(parsed.slice(-count));
        if (Buffer.byteLength(candidate, 'utf8') <= MAX_HISTORY_ROW_BYTES) {
          value = candidate;
          break;
        }
        count = count === 1 ? 0 : Math.floor(count / 2);
      }
      if (count === 0) return undefined;
    } catch {
      return undefined;
    }
  } else {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length > MAX_HISTORY_POINTS_PER_ENDPOINT) {
        value = JSON.stringify(parsed.slice(-MAX_HISTORY_POINTS_PER_ENDPOINT));
      }
    } catch {
      // Preserve compact non-array history entries as-is.
    }
  }
  return { ...row, value };
}

export function boundHistoryRowsForSync(
  rows: readonly StandaloneHomeEntryRow[],
  cache: Map<string, { updatedAt: number; row: StandaloneHomeEntryRow | undefined }>,
  budgetBytes = MAX_CACHE_HISTORY_BYTES,
): StandaloneHomeEntryRow[] {
  const seen = new Set<string>();
  const bounded: StandaloneHomeEntryRow[] = [];
  let usedBytes = 0;
  for (const row of rows) {
    seen.add(row.entryId);
    const cached = cache.get(row.entryId);
    let trimmed: StandaloneHomeEntryRow | undefined;
    if (cached && cached.updatedAt === row.updatedAt) {
      trimmed = cached.row;
    } else {
      trimmed = trimHistoryRow(row);
      cache.set(row.entryId, { updatedAt: row.updatedAt, row: trimmed });
    }
    if (!trimmed) continue;
    const rowBytes = Buffer.byteLength(JSON.stringify(trimmed), 'utf8') + 2;
    if (usedBytes + rowBytes > budgetBytes) continue;
    usedBytes += rowBytes;
    bounded.push(trimmed);
  }
  for (const key of cache.keys()) {
    if (!seen.has(key)) cache.delete(key);
  }
  return bounded;
}

export interface SyncExportCandidate {
  readonly kind: 'credential' | 'config' | 'cache';
  readonly resourceId: string;
  readonly payload: unknown;
  readonly statesDigest?: string;
}

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Exports only the requested sync bundles, optionally omitting heavy cache history. */
export async function exportSyncCandidates(params: {
  readonly codec: {
    readonly exportCredentialBundle: (includeHomeKit: boolean) => Promise<unknown>;
    readonly exportConfigBundle: () => Promise<unknown>;
    readonly exportCacheBundle: (opts: {
      readonly includeHistory: boolean;
    }) => Promise<{ readonly endpointStates: readonly unknown[] }>;
    readonly computePayloadDigest: (payload: unknown) => string;
  };
  readonly requestedKinds: ReadonlySet<'credential' | 'config' | 'cache'>;
  readonly includeHomeKit: boolean;
  readonly includeHistory: boolean;
}): Promise<SyncExportCandidate[]> {
  const candidates: SyncExportCandidate[] = [];
  if (params.requestedKinds.has('credential')) {
    candidates.push({
      kind: 'credential',
      resourceId: 'bundle',
      payload: await params.codec.exportCredentialBundle(params.includeHomeKit),
    });
  }
  if (params.requestedKinds.has('config')) {
    if (candidates.length > 0) await yieldEventLoop();
    candidates.push({
      kind: 'config',
      resourceId: 'bundle',
      payload: await params.codec.exportConfigBundle(),
    });
  }
  if (params.requestedKinds.has('cache')) {
    if (candidates.length > 0) await yieldEventLoop();
    const cachePayload = await params.codec.exportCacheBundle({
      includeHistory: params.includeHistory,
    });
    await yieldEventLoop();
    candidates.push({
      kind: 'cache',
      resourceId: 'bundle',
      payload: cachePayload,
      statesDigest: params.codec.computePayloadDigest(cachePayload.endpointStates),
    });
  }
  return candidates;
}

/** Applies incoming workload lease hints honoring epoch/generation fencing rules. */
export async function applyIncomingWorkloads(
  store: {
    readonly getWorkloadSync: (id: string) => ClusterWorkloadRow | undefined;
    readonly saveWorkload: (row: ClusterWorkloadRow) => Promise<unknown>;
  },
  workloads: readonly ClusterWorkloadRow[],
  fromCoordinator: boolean,
): Promise<boolean> {
  let updated = false;
  for (const incoming of workloads) {
    const existing = store.getWorkloadSync(incoming.workloadId);
    const acceptEqualGeneration =
      fromCoordinator &&
      existing !== undefined &&
      incoming.epoch === existing.epoch &&
      incoming.generation === existing.generation;
    if (
      !existing ||
      incoming.epoch > existing.epoch ||
      (incoming.epoch === existing.epoch && incoming.generation > existing.generation) ||
      acceptEqualGeneration
    ) {
      await store.saveWorkload(incoming);
      updated = true;
    }
  }
  return updated;
}

export function computeDirtyBundleKinds(params: {
  readonly peerId: string;
  readonly allKinds: readonly ('credential' | 'config' | 'cache')[];
  readonly peerLastSyncedKindAt: ReadonlyMap<string, number>;
  readonly bundleDirtyAt: ReadonlyMap<'credential' | 'config' | 'cache', number>;
  readonly now: number;
  readonly fullReconcileIntervalMs: number;
}): ('credential' | 'config' | 'cache')[] {
  return params.allKinds.filter((kind) => {
    const lastSynced = params.peerLastSyncedKindAt.get(`${params.peerId}:${kind}`);
    if (lastSynced === undefined) return true;
    const dirtyAt = params.bundleDirtyAt.get(kind) ?? 0;
    return dirtyAt > lastSynced || params.now - lastSynced >= params.fullReconcileIntervalMs;
  });
}

export async function applyOpenedSyncBundle(params: {
  readonly kind: string;
  readonly payload: unknown;
  readonly localHubId: string;
  readonly authoritativePrune: boolean;
  readonly codec: {
    readonly applyCredentialBundle: (payload: CredentialBundlePayload) => Promise<number>;
    readonly applyConfigBundle: (
      payload: ConfigBundlePayload,
      localHubId: string,
      options?: { readonly authoritativePrune?: boolean },
    ) => Promise<number>;
    readonly applyCacheBundle: (payload: CacheBundlePayload) => Promise<number>;
  };
  readonly applyTelemetryDelta?: (payload: TelemetryDeltaPayload) => Promise<number>;
}): Promise<{
  readonly appliedItems: number;
  readonly appliedKind?: 'credential' | 'config' | 'cache' | 'telemetry';
}> {
  if (params.kind === 'credential') {
    return {
      appliedItems: await params.codec.applyCredentialBundle(
        params.payload as CredentialBundlePayload,
      ),
      appliedKind: 'credential',
    };
  }
  if (params.kind === 'config') {
    return {
      appliedItems: await params.codec.applyConfigBundle(
        params.payload as ConfigBundlePayload,
        params.localHubId,
        { authoritativePrune: params.authoritativePrune },
      ),
      appliedKind: 'config',
    };
  }
  if (params.kind === 'cache') {
    return {
      appliedItems: await params.codec.applyCacheBundle(params.payload as CacheBundlePayload),
      appliedKind: 'cache',
    };
  }
  if (params.kind === 'telemetry' && params.applyTelemetryDelta) {
    return {
      appliedItems: await params.applyTelemetryDelta(params.payload as TelemetryDeltaPayload),
      appliedKind: 'telemetry',
    };
  }
  return { appliedItems: 0 };
}

export function recordPeerSyncBackoff(
  backoffMap: Map<string, { until: number; failures: number }>,
  peerId: string,
  baseMs: number,
  maxMs: number,
): number {
  const failures = (backoffMap.get(peerId)?.failures ?? 0) + 1;
  const delayMs = Math.min(maxMs, baseMs * 2 ** (failures - 1));
  backoffMap.set(peerId, { until: Date.now() + delayMs, failures });
  return delayMs;
}

export function shouldSuppressStandbyCachePush(
  kind: 'credential' | 'config' | 'cache',
  role: string,
  hubId: string,
  workloads: readonly ClusterWorkloadRow[],
): boolean {
  if (kind !== 'cache' || role !== 'node' || workloads.length === 0) return false;
  return !workloads.some((w) => w.ownerHubId === hubId && w.state === 'active');
}

/** Coalesces concurrent peer sync pushes for `(peerId, kind)` without dropping trailing updates. */
export async function pushPeerKindWithCoalescing(params: {
  readonly key: string;
  readonly peerId: string;
  readonly inFlight: Set<string>;
  readonly pending: Set<string>;
  readonly backoffMap: Map<string, { until: number; failures: number }>;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly send: () => Promise<unknown>;
  readonly onError: (delayMs: number, err: unknown) => void;
}): Promise<void> {
  if (params.inFlight.has(params.key)) {
    params.pending.add(params.key);
    return;
  }
  params.inFlight.add(params.key);
  try {
    do {
      params.pending.delete(params.key);
      try {
        await params.send();
      } catch (err: unknown) {
        params.pending.delete(params.key);
        const delayMs = recordPeerSyncBackoff(
          params.backoffMap,
          params.peerId,
          params.baseBackoffMs,
          params.maxBackoffMs,
        );
        params.onError(delayMs, err);
        break;
      }
    } while (params.pending.has(params.key));
  } finally {
    params.inFlight.delete(params.key);
  }
}

/** Identifies benign storage or abort errors thrown while a Hub is gracefully shutting down. */
export function isShutdownStorageError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  return (
    err.message === 'storage_closed' ||
    err.message === 'stats_store_closed' ||
    err.message === 'cluster_sync_shutdown'
  );
}

/** Serializes async operations per key so overlapping peer syncs never contend on identical DB rows. */
export async function runSerialized<T>(
  lanes: Map<string, Promise<void>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = lanes.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  lanes.set(key, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (lanes.get(key) === tail) lanes.delete(key);
  }
}
