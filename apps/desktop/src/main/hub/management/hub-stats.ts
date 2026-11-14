/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { stateFor } from '../entities';
import { isRecord, type CompatView, type EntityBinding, type HubDevice } from '../types';

export interface HubStatsContext {
  readonly api: (
    path: string,
    init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
  ) => Promise<unknown>;
  readonly getView: () => CompatView;
  readonly getDevices?: () => readonly HubDevice[];
}

interface HubStatMetadata {
  readonly statisticId: string;
  readonly source?: string;
  readonly unit?: string;
  readonly displayName?: string;
  readonly hasMean?: boolean;
  readonly hasSum?: boolean;
}

function parseMetaList(payload: unknown): HubStatMetadata[] {
  if (!Array.isArray(payload)) return [];
  const out: HubStatMetadata[] = [];
  for (const item of payload) {
    if (!isRecord(item) || typeof item.statisticId !== 'string' || !item.statisticId) continue;
    out.push({
      statisticId: item.statisticId,
      source: typeof item.source === 'string' ? item.source : undefined,
      unit: typeof item.unit === 'string' ? item.unit : undefined,
      displayName: typeof item.displayName === 'string' ? item.displayName : undefined,
      hasMean: Boolean(item.hasMean),
      hasSum: Boolean(item.hasSum),
    });
  }
  return out;
}

function resolveEntityMeta(
  binding: EntityBinding,
  metaById: Map<string, HubStatMetadata>,
): HubStatMetadata | undefined {
  return (
    metaById.get(`device.${binding.endpointId}.${binding.capability.id}`) ??
    metaById.get(`device.${binding.endpointId}.state`) ??
    metaById.get(`device.${binding.endpointId}.value`)
  );
}

function parseEpochMs(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return fallback;
}

function friendlyName(view: CompatView, entityId: string): string | undefined {
  const match = view.states.find((item) => item.entity_id === entityId);
  const raw = match?.attributes.friendly_name;
  return typeof raw === 'string' && raw ? raw : undefined;
}

function unitOf(view: CompatView, entityId: string): string | undefined {
  const match = view.states.find((item) => item.entity_id === entityId);
  const raw = match?.attributes.unit_of_measurement;
  return typeof raw === 'string' && raw ? raw : undefined;
}

/** Lists recorder statistics metadata mapped onto desktop compat entity IDs plus host metrics. */
export async function listHubStatisticIds(
  ctx: HubStatsContext,
): Promise<Array<Record<string, unknown>>> {
  let raw: unknown;
  try {
    raw = await ctx.api('/api/stats/meta');
  } catch {
    return [];
  }
  const metas = parseMetaList(raw);
  if (metas.length === 0) return [];
  const metaById = new Map(metas.map((item) => [item.statisticId, item]));
  const matched = new Set<string>();
  const view = ctx.getView();
  const out: Array<Record<string, unknown>> = [];

  for (const [entityId, binding] of view.bindings) {
    const meta = resolveEntityMeta(binding, metaById);
    if (!meta || matched.has(meta.statisticId)) continue;
    matched.add(meta.statisticId);
    out.push({
      statistic_id: entityId,
      source: 'recorder',
      name: friendlyName(view, entityId) ?? meta.displayName ?? entityId,
      unit_of_measurement: meta.unit ?? unitOf(view, entityId) ?? null,
      mean_type: meta.hasMean ? 1 : 0,
      has_mean: Boolean(meta.hasMean),
      has_sum: Boolean(meta.hasSum),
    });
  }

  for (const meta of metas) {
    if (matched.has(meta.statisticId)) continue;
    out.push({
      statistic_id: meta.statisticId,
      source: meta.source ?? 'custom',
      name: meta.displayName ?? meta.statisticId,
      unit_of_measurement: meta.unit ?? null,
      mean_type: meta.hasMean ? 1 : 0,
      has_mean: Boolean(meta.hasMean),
      has_sum: Boolean(meta.hasSum),
    });
  }

  return out;
}

function hubStatCandidates(reqId: string, binding: EntityBinding | undefined): string[] {
  if (!binding) return [reqId];
  return [
    `device.${binding.endpointId}.${binding.capability.id}`,
    `device.${binding.endpointId}.state`,
    `device.${binding.endpointId}.value`,
  ];
}

/** Queries Hub timeseries stats for requested HA statistic IDs or entity IDs. */
export async function queryHubStatisticsDuringPeriod(
  message: Record<string, unknown>,
  ctx: HubStatsContext,
): Promise<Record<string, Array<Record<string, unknown>>>> {
  const ids = Array.isArray(message.statistic_ids)
    ? message.statistic_ids.filter(
        (item): item is string => typeof item === 'string' && item.length > 0,
      )
    : [];
  if (ids.length === 0) return {};

  const nowMs = Date.now();
  const fromMs = parseEpochMs(message.start_time, nowMs - 86_400_000);
  const toMs = Math.max(fromMs + 1000, parseEpochMs(message.end_time, nowMs));
  const fromSec = Math.max(0, Math.floor(fromMs / 1000));
  const toSec = Math.max(fromSec + 1, Math.ceil(toMs / 1000));
  const period = typeof message.period === 'string' ? message.period : '';
  const resolution = period === '5minute' ? '5m' : period === 'month' ? '1h' : 'auto';
  const view = ctx.getView();
  const out: Record<string, Array<Record<string, unknown>>> = {};

  for (const reqId of ids.slice(0, 64)) {
    const candidates = hubStatCandidates(reqId, view.bindings.get(reqId));
    for (const candidate of candidates) {
      const points = await fetchStatSeries(ctx, candidate, fromSec, toSec, resolution);
      if (points && points.length > 0) {
        out[reqId] = points;
        break;
      }
    }
  }
  return out;
}

async function fetchStatSeries(
  ctx: HubStatsContext,
  statisticId: string,
  fromSec: number,
  toSec: number,
  resolution: string,
): Promise<Array<Record<string, unknown>> | undefined> {
  const fetchRes = async (res: string): Promise<unknown> =>
    ctx
      .api(
        `/api/stats/query?statistic_id=${encodeURIComponent(statisticId)}&from=${fromSec}&to=${toSec}&resolution=${res}&threshold=1000`,
      )
      .catch(() => undefined);

  let payload = await fetchRes(resolution);
  if (
    resolution !== 'raw' &&
    isRecord(payload) &&
    Array.isArray(payload.data) &&
    payload.data.length === 0
  ) {
    payload = await fetchRes('raw');
  }
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  const hasSum = isRecord(payload.metadata) && Boolean(payload.metadata.hasSum);
  const points: Array<Record<string, unknown>> = [];
  for (const pt of payload.data) {
    if (!isRecord(pt) || typeof pt.timestamp !== 'number' || typeof pt.value !== 'number') continue;
    points.push({
      start: pt.timestamp * 1000,
      mean: pt.value,
      min: typeof pt.min === 'number' ? pt.min : pt.value,
      max: typeof pt.max === 'number' ? pt.max : pt.value,
      state: pt.value,
      ...(hasSum ? { sum: pt.value } : {}),
    });
  }
  return points;
}

/** Queries recent state transitions for entity IDs and projects them into HA history rows. */
export async function queryHubHistoryDuringPeriod(
  message: Record<string, unknown>,
  ctx: HubStatsContext,
): Promise<Record<string, Array<Record<string, unknown>>>> {
  const entityIds = Array.isArray(message.entity_ids)
    ? message.entity_ids.filter(
        (item): item is string => typeof item === 'string' && item.length > 0,
      )
    : [];
  if (entityIds.length === 0) return {};

  const nowMs = Date.now();
  const toMs = parseEpochMs(message.end_time, nowMs);
  const fromMs = parseEpochMs(message.start_time, toMs - 86_400_000);
  const view = ctx.getView();
  const deviceMap = new Map((ctx.getDevices?.() ?? []).map((device) => [device.id, device]));

  const bindings: Array<[string, EntityBinding]> = [];
  const endpointSet = new Set<string>();
  for (const entityId of entityIds) {
    const binding = view.bindings.get(entityId);
    if (!binding) continue;
    bindings.push([entityId, binding]);
    endpointSet.add(binding.endpointId);
  }
  if (endpointSet.size === 0) return {};

  const payload = await ctx
    .api(
      `/api/history?endpoint_ids=${encodeURIComponent([...endpointSet].join(','))}&from=${Math.floor(fromMs)}&to=${Math.ceil(toMs)}`,
    )
    .catch(() => undefined);
  if (!isRecord(payload) || !isRecord(payload.history)) return {};

  const noAttributes = Boolean(message.no_attributes);
  const significantOnly = Boolean(message.significant_changes_only);
  const out: Record<string, Array<Record<string, unknown>>> = {};

  for (const [entityId, binding] of bindings) {
    const rawEntries = payload.history[binding.endpointId];
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) continue;
    const device = deviceMap.get(binding.deviceId) ?? {
      id: binding.deviceId,
      name: binding.deviceId,
      category: 'other',
      availability: 'online',
      endpoints: [],
    };
    const rows: Array<Record<string, unknown>> = [];
    let lastSig = '';
    for (const entry of rawEntries) {
      if (!isRecord(entry) || typeof entry.tsMs !== 'number' || !isRecord(entry.state)) continue;
      const translated = stateFor(binding.domain, binding.capability, entry.state, device);
      const sig = `${translated.state}|${noAttributes ? '' : JSON.stringify(translated.attributes)}`;
      if (significantOnly && rows.length > 0 && sig === lastSig) continue;
      lastSig = sig;
      const tsSec = Math.floor(entry.tsMs / 1000);
      rows.push({
        s: translated.state,
        lu: tsSec,
        lc: tsSec,
        ...(noAttributes ? {} : { a: translated.attributes }),
      });
    }
    if (rows.length > 0) out[entityId] = rows;
  }

  return out;
}
