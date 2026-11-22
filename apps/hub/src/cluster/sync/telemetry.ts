/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { RawStatisticSample, StatisticMetadata, StatisticRollup } from '@haus/core';
import type { ClusterStateStore } from '../coordination/state.js';
import { sealClusterEnvelope, type ClusterSecretEnvelope } from '../crypto/envelope.js';
import type { ClusterCryptoIdentity } from '../crypto/identity.js';
import { sendSignedPeerRequest, sha256Hex } from '../crypto/transport.js';
import type { Transactions } from '../../storage/transactions.js';
import { StandaloneHomeEntryEntity } from '../../storage/standalone/entities.js';
import type { StatsEngine } from '../../stats/stats.engine.js';
import type { StatsStore, TimeKeyCursor } from '../../stats/stats.store.js';
import type { EndpointHistoryEventRow, StatisticMetadataRow } from '../../stats/stats.types.js';

export interface TelemetryWatermarks {
  readonly raw: TimeKeyCursor;
  readonly rollups5m: TimeKeyCursor;
  readonly rollups1h: TimeKeyCursor;
  readonly history: TimeKeyCursor;
  readonly metadataDigest: string;
}

export interface TelemetryDeltaPayload {
  readonly metadata: readonly StatisticMetadataRow[];
  readonly rawSamples: readonly RawStatisticSample[];
  readonly rollups5m: readonly StatisticRollup[];
  readonly rollups1h: readonly StatisticRollup[];
  readonly endpointHistory: readonly EndpointHistoryEventRow[];
  readonly nextWatermarks: TelemetryWatermarks;
  readonly hasMore: boolean;
}

const ZERO_CURSOR: TimeKeyCursor = { ts: 0, key: '' };
const MAX_RAW_PER_BATCH = 1500;
const MAX_5M_PER_BATCH = 800;
const MAX_1H_PER_BATCH = 500;
const MAX_HISTORY_PER_BATCH = 800;
const MAX_DELTA_BYTES = 2 * 1024 * 1024;

function defaultWatermarks(): TelemetryWatermarks {
  return {
    raw: ZERO_CURSOR,
    rollups5m: ZERO_CURSOR,
    rollups1h: ZERO_CURSOR,
    history: ZERO_CURSOR,
    metadataDigest: '',
  };
}

function parseCursor(raw: unknown): TimeKeyCursor {
  if (!raw || typeof raw !== 'object') return ZERO_CURSOR;
  const obj = raw as Record<string, unknown>;
  return {
    ts: typeof obj.ts === 'number' && Number.isFinite(obj.ts) ? obj.ts : 0,
    key: typeof obj.key === 'string' ? obj.key : '',
  };
}

function parseWatermarks(raw: string): TelemetryWatermarks {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      raw: parseCursor(parsed.raw),
      rollups5m: parseCursor(parsed.rollups5m),
      rollups1h: parseCursor(parsed.rollups1h),
      history: parseCursor(parsed.history),
      metadataDigest: typeof parsed.metadataDigest === 'string' ? parsed.metadataDigest : '',
    };
  } catch {
    return defaultWatermarks();
  }
}

function toMetadataRow(meta: StatisticMetadata): StatisticMetadataRow {
  return {
    id: meta.id,
    statisticId: meta.statisticId,
    source: meta.source,
    unit: meta.unit ?? null,
    kind: meta.kind,
    displayName: meta.displayName ?? null,
    hasMean: meta.hasMean,
    hasSum: meta.hasSum,
    createdAt: meta.createdAt,
  };
}

function fromMetadataRow(row: StatisticMetadataRow): StatisticMetadata {
  return {
    id: row.id,
    statisticId: row.statisticId,
    source: row.source,
    unit: row.unit ?? undefined,
    kind: row.kind,
    displayName: row.displayName ?? undefined,
    hasMean: row.hasMean,
    hasSum: row.hasSum,
    createdAt: row.createdAt,
  };
}

function trimByByteBudget<T>(
  items: readonly T[],
  budgetBytes: number,
): {
  readonly kept: T[];
  readonly truncated: boolean;
} {
  const kept: T[] = [];
  let bytes = 2;
  for (const item of items) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
    if (kept.length > 0 && bytes + itemBytes > budgetBytes) {
      return { kept, truncated: true };
    }
    bytes += itemBytes;
    kept.push(item);
  }
  return { kept, truncated: false };
}

/**
 * Watermarked incremental replicator for `stats_metadata`, `stats_raw`, `stats_5m`,
 * `stats_1h`, and unbounded `endpoint_history_events` between Hub cluster peers.
 */
export class ClusterTelemetrySync {
  private readonly watermarkCache = new Map<string, TelemetryWatermarks>();

  constructor(
    private readonly transactions?: Transactions,
    private readonly statsStore?: StatsStore,
    private readonly statsEngine?: StatsEngine,
  ) {}

  isAvailable(): boolean {
    return Boolean(this.statsStore);
  }

  async getPeerWatermarks(peerHubId: string): Promise<TelemetryWatermarks> {
    const cached = this.watermarkCache.get(peerHubId);
    if (cached) return cached;
    if (!this.transactions) return defaultWatermarks();
    const row = await this.transactions.read((manager) =>
      manager.findOneBy(StandaloneHomeEntryEntity, {
        kind: 'cluster_telemetry_watermark',
        entryId: peerHubId,
      }),
    );
    const loaded = row ? parseWatermarks(row.value) : defaultWatermarks();
    this.watermarkCache.set(peerHubId, loaded);
    return loaded;
  }

  async commitPeerWatermarks(peerHubId: string, next: TelemetryWatermarks): Promise<void> {
    this.watermarkCache.set(peerHubId, next);
    if (!this.transactions) return;
    await this.transactions.run((manager) =>
      manager.upsert(
        StandaloneHomeEntryEntity,
        {
          kind: 'cluster_telemetry_watermark',
          entryId: peerHubId,
          value: JSON.stringify(next),
          updatedAt: Date.now(),
        },
        ['kind', 'entryId'],
      ),
    );
  }

  async exportDeltaForPeer(peerHubId: string): Promise<TelemetryDeltaPayload | null> {
    if (!this.statsStore) return null;
    const prev = await this.getPeerWatermarks(peerHubId);
    const allMeta = (await this.statsStore.listMetadata()).map(toMetadataRow);
    const metadataDigest = sha256Hex(JSON.stringify(allMeta));
    const metadataChanged = metadataDigest !== prev.metadataDigest && allMeta.length > 0;

    const [rawBatch, rollups5mBatch, rollups1hBatch, historyBatch] = await Promise.all([
      this.statsStore.queryRawSamplesSince(prev.raw, MAX_RAW_PER_BATCH + 1),
      this.statsStore.queryRollupsSince('5m', prev.rollups5m, MAX_5M_PER_BATCH + 1),
      this.statsStore.queryRollupsSince('1h', prev.rollups1h, MAX_1H_PER_BATCH + 1),
      this.statsStore.queryEndpointHistorySince(prev.history, MAX_HISTORY_PER_BATCH + 1),
    ]);

    const rawHasMore = rawBatch.length > MAX_RAW_PER_BATCH;
    const r5mHasMore = rollups5mBatch.length > MAX_5M_PER_BATCH;
    const r1hHasMore = rollups1hBatch.length > MAX_1H_PER_BATCH;
    const histHasMore = historyBatch.length > MAX_HISTORY_PER_BATCH;

    const metadata = metadataChanged ? allMeta : [];
    const metaBytes = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
    let remainingBudget = Math.max(64 * 1024, MAX_DELTA_BYTES - metaBytes - 4096);

    const rawTrimmed = trimByByteBudget(rawBatch.slice(0, MAX_RAW_PER_BATCH), remainingBudget / 2);
    remainingBudget = Math.max(
      32 * 1024,
      remainingBudget - Buffer.byteLength(JSON.stringify(rawTrimmed.kept), 'utf8'),
    );
    const r5mTrimmed = trimByByteBudget(
      rollups5mBatch.slice(0, MAX_5M_PER_BATCH),
      remainingBudget / 2,
    );
    remainingBudget = Math.max(
      32 * 1024,
      remainingBudget - Buffer.byteLength(JSON.stringify(r5mTrimmed.kept), 'utf8'),
    );
    const r1hTrimmed = trimByByteBudget(
      rollups1hBatch.slice(0, MAX_1H_PER_BATCH),
      remainingBudget / 2,
    );
    remainingBudget = Math.max(
      32 * 1024,
      remainingBudget - Buffer.byteLength(JSON.stringify(r1hTrimmed.kept), 'utf8'),
    );
    const histTrimmed = trimByByteBudget(
      historyBatch.slice(0, MAX_HISTORY_PER_BATCH),
      remainingBudget,
    );

    const hasRows =
      metadata.length > 0 ||
      rawTrimmed.kept.length > 0 ||
      r5mTrimmed.kept.length > 0 ||
      r1hTrimmed.kept.length > 0 ||
      histTrimmed.kept.length > 0;
    if (!hasRows) return null;

    const lastRaw = rawTrimmed.kept.at(-1);
    const last5m = r5mTrimmed.kept.at(-1);
    const last1h = r1hTrimmed.kept.at(-1);
    const lastHist = histTrimmed.kept.at(-1);

    const nextWatermarks: TelemetryWatermarks = {
      raw: lastRaw ? { ts: lastRaw.timestamp, key: lastRaw.metadataId } : prev.raw,
      rollups5m: last5m ? { ts: last5m.startTs, key: last5m.metadataId } : prev.rollups5m,
      rollups1h: last1h ? { ts: last1h.startTs, key: last1h.metadataId } : prev.rollups1h,
      history: lastHist ? { ts: lastHist.tsMs, key: lastHist.endpointId } : prev.history,
      metadataDigest,
    };

    const hasMore =
      rawHasMore ||
      r5mHasMore ||
      r1hHasMore ||
      histHasMore ||
      rawTrimmed.truncated ||
      r5mTrimmed.truncated ||
      r1hTrimmed.truncated ||
      histTrimmed.truncated;

    return {
      metadata,
      rawSamples: rawTrimmed.kept,
      rollups5m: r5mTrimmed.kept,
      rollups1h: r1hTrimmed.kept,
      endpointHistory: histTrimmed.kept,
      nextWatermarks,
      hasMore,
    };
  }

  async applyDelta(payload: TelemetryDeltaPayload): Promise<number> {
    if (!this.statsStore || !payload) return 0;
    const metadata = Array.isArray(payload.metadata) ? payload.metadata : [];
    const rawSamples = Array.isArray(payload.rawSamples) ? payload.rawSamples : [];
    const rollups5m = Array.isArray(payload.rollups5m) ? payload.rollups5m : [];
    const rollups1h = Array.isArray(payload.rollups1h) ? payload.rollups1h : [];
    const endpointHistory = Array.isArray(payload.endpointHistory) ? payload.endpointHistory : [];
    const applied = await this.statsStore.applyTelemetryDeltaBatch({
      metadata,
      rawSamples,
      rollups5m,
      rollups1h,
      endpointHistory,
    });
    if (metadata.length > 0 && this.statsEngine) {
      this.statsEngine.syncMetadataCache(metadata.map(fromMetadataRow));
    }
    return applied;
  }
}

/**
 * Streams bounded incremental telemetry/history chunks to a peer inside E2EE envelopes,
 * advancing the durable per-peer watermark only after each chunk is acknowledged by HTTP 200.
 */
export async function pushTelemetryDeltasToPeer(params: {
  readonly telemetrySync: ClusterTelemetrySync;
  readonly stateStore: ClusterStateStore;
  readonly identity: ClusterCryptoIdentity;
  readonly homeId: string;
  readonly epoch: number;
  readonly recipientHubId: string;
  readonly recipientExchangePublicKey: string;
  readonly channelSecret?: string;
  readonly targetUrl: string;
  readonly allowHttp: boolean;
  readonly maxChunks?: number;
}): Promise<{ readonly accepted: number; readonly appliedItems: number }> {
  if (!params.telemetrySync.isAvailable()) return { accepted: 0, appliedItems: 0 };
  const maxChunks = params.maxChunks ?? 8;
  let totalAccepted = 0;
  let totalApplied = 0;
  const resourceId = `peer:${params.identity.hubId}`;
  const syncKey = `telemetry:${resourceId}`;
  for (let chunk = 0; chunk < maxChunks; chunk += 1) {
    const delta = await params.telemetrySync.exportDeltaForPeer(params.recipientHubId);
    if (!delta) break;
    const cur = params.stateStore.getSyncState(syncKey);
    const revision = (cur?.revision ?? 0) + 1;
    const generation = (cur?.generation ?? 0) + 1;
    await params.stateStore.saveSyncState({
      syncKey,
      kind: 'telemetry',
      resourceId,
      revision,
      generation,
      epoch: params.epoch,
      sha256: sha256Hex(`${syncKey}:${revision}:${Date.now()}`),
      sourceHubId: params.identity.hubId,
      updatedAt: Date.now(),
    });
    const envelope: ClusterSecretEnvelope = sealClusterEnvelope({
      identity: params.identity,
      homeId: params.homeId,
      recipientHubId: params.recipientHubId,
      recipientExchangePublicKey: params.recipientExchangePublicKey,
      kind: 'telemetry',
      resourceId,
      revision,
      generation,
      epoch: params.epoch,
      payload: delta,
    });
    const res = await sendSignedPeerRequest<{
      readonly accepted: number;
      readonly appliedItems: number;
    }>({
      identity: params.identity,
      homeId: params.homeId,
      targetHubId: params.recipientHubId,
      targetUrl: params.targetUrl,
      allowHttp: params.allowHttp,
      channelSecret: params.channelSecret,
      method: 'POST',
      path: '/api/cluster/peer/sync',
      body: { envelopes: [envelope] },
      timeoutMs: 30_000,
    });
    if (res.accepted < 1) break;
    await params.telemetrySync.commitPeerWatermarks(params.recipientHubId, delta.nextWatermarks);
    totalAccepted += res.accepted;
    totalApplied += res.appliedItems;
    if (!delta.hasMore) break;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return { accepted: totalAccepted, appliedItems: totalApplied };
}
