/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isDeepStrictEqual } from 'node:util';
import type { Capability, HausDevice } from '@haus/core';
import type { StatsCollector } from '../stats/stats.collector.js';
import type { StatsStore } from '../stats/stats.store.js';
import type { EndpointHistoryEventRow } from '../stats/stats.types.js';
import type { StandaloneHomePersistence } from './home.persistence.js';
import { findEndpointDevice } from './readings.js';

export interface EndpointHistoryEntry {
  readonly tsMs: number;
  readonly state: Record<string, unknown>;
}

export type EndpointHistoryStorePort = Pick<
  StatsStore,
  'insertEndpointHistory' | 'queryEndpointHistory' | 'deleteEndpointHistory'
>;

export interface HomeStatsDeps {
  readonly listDevices: () => readonly HausDevice[];
  readonly getDeviceByEndpoint?: (endpointId: string) => HausDevice | undefined;
  readonly persistence: Pick<StandaloneHomePersistence, 'save' | 'remove'>;
  readonly getCollector: () => Pick<StatsCollector, 'ingestDeviceReading'> | undefined;
  readonly getStatsStore?: () => EndpointHistoryStorePort | undefined;
}

const MAX_ENTRIES_PER_ENDPOINT = 256;
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_PERSIST_INTERVAL_MS = 5_000;
const EVENT_FLUSH_INTERVAL_MS = 2_000;
const EVENT_FLUSH_BATCH_THRESHOLD = 200;
const UNCHANGED_INGEST_HEARTBEAT_MS = 60_000;
const IGNORED_METRIC_KEYS = new Set([
  'attributes',
  'friendly_name',
  'unit',
  'icon',
  'device_id',
  'last_updated',
  'last_changed',
]);
const OMITTED_HISTORY_KEYS = new Set([
  'attributes',
  'effect_list',
  'platform_metadata',
  'platform_state',
  'source_list',
  'event_types',
  'options',
  'hvac_modes',
  'fan_modes',
  'swing_modes',
  'supported_color_modes',
]);

export function compactHistoryState(
  state: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (OMITTED_HISTORY_KEYS.has(key)) continue;
    if (typeof value === 'string' && value.length > 512) continue;
    if (Array.isArray(value) && value.length > 16) continue;
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length > 12
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function coerceMetricValue(
  raw: unknown,
  attr: string,
  cap?: Capability,
): number | boolean | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if (
    cap?.kind === 'binary' ||
    attr === 'on_off' ||
    (attr === 'power' && cap?.kind !== 'numeric')
  ) {
    if (normalized === 'on' || normalized === 'true' || normalized === 'open') return true;
    if (normalized === 'off' || normalized === 'false' || normalized === 'closed') return false;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Tracks bounded per-endpoint state transitions and mirrors numeric readings into StatsCollector. */
export class HomeStatsTracker {
  private readonly history = new Map<string, EndpointHistoryEntry[]>();
  private readonly dirtyHistory = new Set<string>();
  private readonly pendingEvents: EndpointHistoryEventRow[] = [];
  private readonly lastIngested = new Map<string, { value: number | boolean; tsMs: number }>();
  private persistTimer?: NodeJS.Timeout;
  private eventFlushTimer?: NodeJS.Timeout;

  constructor(private readonly deps?: HomeStatsDeps) {}

  private scheduleHistoryPersist(endpointId: string): void {
    if (!this.deps) return;
    this.dirtyHistory.add(endpointId);
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.flushHistory();
    }, HISTORY_PERSIST_INTERVAL_MS);
    this.persistTimer.unref();
  }

  private enqueueEventHistory(row: EndpointHistoryEventRow): void {
    if (!this.deps?.getStatsStore?.()) return;
    this.pendingEvents.push(row);
    if (this.pendingEvents.length >= EVENT_FLUSH_BATCH_THRESHOLD) {
      void this.flushEventHistory();
      return;
    }
    if (this.eventFlushTimer) return;
    this.eventFlushTimer = setTimeout(() => {
      this.eventFlushTimer = undefined;
      void this.flushEventHistory();
    }, EVENT_FLUSH_INTERVAL_MS);
    this.eventFlushTimer.unref();
  }

  async flushEventHistory(): Promise<void> {
    if (this.eventFlushTimer) {
      clearTimeout(this.eventFlushTimer);
      this.eventFlushTimer = undefined;
    }
    if (this.pendingEvents.length === 0) return;
    const store = this.deps?.getStatsStore?.();
    if (!store) {
      this.pendingEvents.length = 0;
      return;
    }
    const batch = this.pendingEvents.splice(0, this.pendingEvents.length);
    try {
      await store.insertEndpointHistory(batch);
    } catch {
      process.emitWarning('home_endpoint_history_events_persist_failed');
    }
  }

  flushHistory(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    void this.flushEventHistory();
    if (!this.deps || this.dirtyHistory.size === 0) {
      this.dirtyHistory.clear();
      return;
    }
    for (const id of this.dirtyHistory) {
      const entries = this.history.get(id);
      if (entries) {
        void this.deps.persistence.save('endpoint_history', id, entries).catch(() => {
          process.emitWarning('home_endpoint_history_persist_failed');
        });
      }
    }
    this.dirtyHistory.clear();
  }

  close(): void {
    this.flushHistory();
  }

  seedFromSnapshot(
    states: Iterable<[string, Record<string, unknown>]>,
    persistedHistory: ReadonlyArray<[string, EndpointHistoryEntry[]]> = [],
    devices: readonly HausDevice[] = this.deps?.listDevices() ?? [],
    collector: Pick<StatsCollector, 'ingestDeviceReading'> | undefined = this.deps?.getCollector(),
    nowMs = Date.now(),
  ): void {
    const cutoff = nowMs - HISTORY_RETENTION_MS;
    for (const [endpointId, entries] of persistedHistory) {
      let compactedAny = false;
      const valid = entries
        .filter(
          (entry) =>
            entry &&
            typeof entry.tsMs === 'number' &&
            Number.isFinite(entry.tsMs) &&
            entry.tsMs >= cutoff &&
            entry.state &&
            typeof entry.state === 'object',
        )
        .slice(-MAX_ENTRIES_PER_ENDPOINT)
        .map((entry) => {
          const compact = compactHistoryState(entry.state);
          if (!compactedAny && !isDeepStrictEqual(entry.state, compact)) compactedAny = true;
          return { tsMs: entry.tsMs, state: compact };
        });
      if (valid.length > 0) {
        this.history.set(endpointId, valid);
        if (compactedAny) this.scheduleHistoryPersist(endpointId);
      }
    }
    const deviceByEndpoint = new Map<string, HausDevice>();
    for (const device of devices) {
      for (const ep of device.endpoints) {
        deviceByEndpoint.set(ep.id, device);
      }
    }
    for (const [endpointId, state] of states) {
      if (!this.history.has(endpointId) && Object.keys(state).length > 0) {
        this.history.set(endpointId, [{ tsMs: nowMs, state: compactHistoryState(state) }]);
      }
      if (collector) {
        this.ingestMetrics(
          deviceByEndpoint.get(endpointId),
          endpointId,
          state,
          state,
          collector,
          nowMs,
        );
      }
    }
  }

  recordUpdate(
    endpointId: string,
    fullState: Record<string, unknown>,
    patch: Record<string, unknown>,
    device: HausDevice | undefined = this.deps
      ? (this.deps.getDeviceByEndpoint?.(endpointId) ??
        findEndpointDevice(this.deps.listDevices(), endpointId))
      : undefined,
    saveHistory?: (endpointId: string, entries: EndpointHistoryEntry[]) => void,
    collector: Pick<StatsCollector, 'ingestDeviceReading'> | undefined = this.deps?.getCollector(),
    nowMs = Date.now(),
  ): void {
    const cutoff = nowMs - HISTORY_RETENTION_MS;
    const raw = this.history.get(endpointId);
    const existing =
      raw && raw.length > 0 && raw[0]!.tsMs < cutoff
        ? raw.filter((entry) => entry.tsMs >= cutoff)
        : (raw ?? []);
    const last = existing.at(-1);
    const snapshot = compactHistoryState(fullState);
    if (!last || !isDeepStrictEqual(last.state, snapshot)) {
      const next = [...existing, { tsMs: nowMs, state: snapshot }].slice(-MAX_ENTRIES_PER_ENDPOINT);
      this.history.set(endpointId, next);
      this.enqueueEventHistory({ endpointId, tsMs: nowMs, stateJson: JSON.stringify(snapshot) });
      if (saveHistory) {
        saveHistory(endpointId, next);
      } else {
        this.scheduleHistoryPersist(endpointId);
      }
    }

    if (collector) {
      this.ingestMetrics(device, endpointId, fullState, patch, collector, nowMs);
    }
  }

  remove(endpointId: string): void {
    this.dirtyHistory.delete(endpointId);
    this.history.delete(endpointId);
    const prefix = `${endpointId}\0`;
    for (const key of this.lastIngested.keys()) {
      if (key.startsWith(prefix)) this.lastIngested.delete(key);
    }
    void this.deps?.persistence.remove('endpoint_history', endpointId);
    void this.deps
      ?.getStatsStore?.()
      ?.deleteEndpointHistory(endpointId)
      .catch(() => {});
  }

  query(
    endpointIds: readonly string[],
    fromMs: number,
    toMs: number,
  ): Record<string, EndpointHistoryEntry[]> {
    const out: Record<string, EndpointHistoryEntry[]> = {};
    for (const endpointId of endpointIds) {
      const entries = this.history.get(endpointId) ?? [];
      if (entries.length === 0) {
        out[endpointId] = [];
        continue;
      }
      let startBaseline: EndpointHistoryEntry | undefined;
      const inRange: EndpointHistoryEntry[] = [];
      for (const entry of entries) {
        if (entry.tsMs < fromMs) {
          startBaseline = entry;
        } else if (entry.tsMs <= toMs) {
          inRange.push(entry);
        }
      }
      out[endpointId] = startBaseline ? [startBaseline, ...inRange] : inRange;
    }
    return out;
  }

  /** Queries deep persisted endpoint history (months/year on PG) merged with hot RAM entries. */
  async queryAsync(
    endpointIds: readonly string[],
    fromMs: number,
    toMs: number,
  ): Promise<Record<string, EndpointHistoryEntry[]>> {
    const mem = this.query(endpointIds, fromMs, toMs);
    const store = this.deps?.getStatsStore?.();
    if (!store || endpointIds.length === 0) return mem;
    await this.flushEventHistory();
    let persisted: Record<string, EndpointHistoryEntry[]>;
    try {
      persisted = await store.queryEndpointHistory(endpointIds, fromMs, toMs);
    } catch {
      return mem;
    }
    const merged: Record<string, EndpointHistoryEntry[]> = {};
    for (const endpointId of endpointIds) {
      const dbEntries = persisted[endpointId] ?? [];
      const memEntries = mem[endpointId] ?? [];
      if (dbEntries.length === 0) {
        merged[endpointId] = memEntries;
        continue;
      }
      if (memEntries.length === 0) {
        merged[endpointId] = dbEntries;
        continue;
      }
      const byTs = new Map<number, EndpointHistoryEntry>();
      for (const entry of dbEntries) byTs.set(entry.tsMs, entry);
      for (const entry of memEntries) byTs.set(entry.tsMs, entry);
      const sorted = [...byTs.values()].sort((a, b) => a.tsMs - b.tsMs);
      let baseline: EndpointHistoryEntry | undefined;
      const inRange: EndpointHistoryEntry[] = [];
      for (const entry of sorted) {
        if (entry.tsMs < fromMs) baseline = entry;
        else if (entry.tsMs <= toMs) inRange.push(entry);
      }
      merged[endpointId] = baseline ? [baseline, ...inRange] : inRange;
    }
    return merged;
  }

  private ingestMetrics(
    device: HausDevice | undefined,
    endpointId: string,
    fullState: Record<string, unknown>,
    patch: Record<string, unknown>,
    collector: Pick<StatsCollector, 'ingestDeviceReading'>,
    nowMs: number,
  ): void {
    const endpoint = device?.endpoints.find((item) => item.id === endpointId);
    const tsSec = Math.floor(nowMs / 1000);
    for (const [rawKey, rawValue] of Object.entries(patch)) {
      if (IGNORED_METRIC_KEYS.has(rawKey)) continue;
      let attr = rawKey;
      if ((rawKey === 'state' || rawKey === 'value') && endpoint?.capabilities.length === 1) {
        const primaryCap = endpoint.capabilities[0]?.id;
        if (primaryCap && !(primaryCap in patch)) {
          attr = primaryCap;
        }
      }
      const cap = endpoint?.capabilities.find((item) => item.id === attr);
      const unit =
        typeof fullState.unit === 'string' && fullState.unit ? fullState.unit : cap?.unit;
      const value = coerceMetricValue(rawValue, attr, cap);
      if (value !== undefined) {
        const dedupKey = `${endpointId}\0${attr}`;
        const prev = this.lastIngested.get(dedupKey);
        if (
          prev &&
          prev.value === value &&
          nowMs >= prev.tsMs &&
          nowMs - prev.tsMs < UNCHANGED_INGEST_HEARTBEAT_MS
        ) {
          continue;
        }
        this.lastIngested.set(dedupKey, { value, tsMs: nowMs });
        collector.ingestDeviceReading(endpointId, attr, value, unit, tsSec);
      }
    }
  }
}
