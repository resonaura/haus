/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isDeepStrictEqual } from 'node:util';
import type { Capability, HausDevice } from '@haus/core';
import type { StatsCollector } from '../stats/stats.collector.js';
import type { StandaloneHomePersistence } from './home.persistence.js';
import { findEndpointDevice } from './readings.js';

export interface EndpointHistoryEntry {
  readonly tsMs: number;
  readonly state: Record<string, unknown>;
}

export interface HomeStatsDeps {
  readonly listDevices: () => readonly HausDevice[];
  readonly persistence: Pick<StandaloneHomePersistence, 'save' | 'remove'>;
  readonly getCollector: () => Pick<StatsCollector, 'ingestDeviceReading'> | undefined;
}

const MAX_ENTRIES_PER_ENDPOINT = 256;
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const IGNORED_METRIC_KEYS = new Set([
  'attributes',
  'friendly_name',
  'unit',
  'icon',
  'device_id',
  'last_updated',
  'last_changed',
]);

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
  if (cap?.kind === 'binary' || attr === 'on_off') {
    if (normalized === 'on' || normalized === 'true' || normalized === 'open') return true;
    if (normalized === 'off' || normalized === 'false' || normalized === 'closed') return false;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Tracks bounded per-endpoint state transitions and mirrors numeric readings into StatsCollector. */
export class HomeStatsTracker {
  private readonly history = new Map<string, EndpointHistoryEntry[]>();

  constructor(private readonly deps?: HomeStatsDeps) {}

  seedFromSnapshot(
    states: Iterable<[string, Record<string, unknown>]>,
    persistedHistory: ReadonlyArray<[string, EndpointHistoryEntry[]]> = [],
    devices: readonly HausDevice[] = this.deps?.listDevices() ?? [],
    collector: Pick<StatsCollector, 'ingestDeviceReading'> | undefined = this.deps?.getCollector(),
    nowMs = Date.now(),
  ): void {
    const cutoff = nowMs - HISTORY_RETENTION_MS;
    for (const [endpointId, entries] of persistedHistory) {
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
        .slice(-MAX_ENTRIES_PER_ENDPOINT);
      if (valid.length > 0) {
        this.history.set(endpointId, valid);
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
        this.history.set(endpointId, [{ tsMs: nowMs, state: { ...state } }]);
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
      ? findEndpointDevice(this.deps.listDevices(), endpointId)
      : undefined,
    saveHistory: ((endpointId: string, entries: EndpointHistoryEntry[]) => void) | undefined = this
      .deps
      ? (id, entries) => {
          void this.deps!.persistence.save('endpoint_history', id, entries);
        }
      : undefined,
    collector: Pick<StatsCollector, 'ingestDeviceReading'> | undefined = this.deps?.getCollector(),
    nowMs = Date.now(),
  ): void {
    const cutoff = nowMs - HISTORY_RETENTION_MS;
    const existing = (this.history.get(endpointId) ?? []).filter((entry) => entry.tsMs >= cutoff);
    const last = existing.at(-1);
    const snapshot = { ...fullState };
    if (!last || !isDeepStrictEqual(last.state, snapshot)) {
      const next = [...existing, { tsMs: nowMs, state: snapshot }].slice(-MAX_ENTRIES_PER_ENDPOINT);
      this.history.set(endpointId, next);
      saveHistory?.(endpointId, next);
    }

    if (collector) {
      this.ingestMetrics(device, endpointId, fullState, patch, collector, nowMs);
    }
  }

  remove(endpointId: string): void {
    this.history.delete(endpointId);
    void this.deps?.persistence.remove('endpoint_history', endpointId);
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
        collector.ingestDeviceReading(endpointId, attr, value, unit, tsSec);
      }
    }
  }
}
