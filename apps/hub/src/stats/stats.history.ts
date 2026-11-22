/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { EntityManager } from 'typeorm';
import type { RawStatisticSample, StatisticRollup } from '@haus/core';
import { sqlParams } from '../storage/dialect.js';
import type { EndpointHistoryEventRow, StatisticRollupRow } from './stats.types.js';

export interface TimeKeyCursor {
  readonly ts: number;
  readonly key: string;
}

export interface EndpointHistoryEntryResult {
  readonly tsMs: number;
  readonly state: Record<string, unknown>;
}

function parseStateJson(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function queryEndpointHistoryRows(
  manager: EntityManager,
  isPostgres: boolean,
  endpointIds: readonly string[],
  fromMs: number,
  toMs: number,
  maxPerEndpoint = 5000,
): Promise<Record<string, EndpointHistoryEntryResult[]>> {
  const out: Record<string, EndpointHistoryEntryResult[]> = {};
  const uniqueIds = [...new Set(endpointIds.filter(Boolean))];
  for (const id of uniqueIds) out[id] = [];
  if (uniqueIds.length === 0) return out;

  const baselines = new Map<string, EndpointHistoryEntryResult>();
  if (isPostgres) {
    const baseRows = (await manager.query(
      'SELECT DISTINCT ON (endpoint_id) endpoint_id AS "endpointId", ts_ms AS "tsMs", state_json AS "stateJson" FROM endpoint_history_events WHERE endpoint_id = ANY($1) AND ts_ms < $2 ORDER BY endpoint_id, ts_ms DESC',
      [uniqueIds, fromMs],
    )) as EndpointHistoryEventRow[];
    for (const row of baseRows) {
      const parsed = parseStateJson(row.stateJson);
      if (parsed) baselines.set(row.endpointId, { tsMs: Number(row.tsMs), state: parsed });
    }
  } else {
    for (const id of uniqueIds) {
      const baseRows = (await manager.query(
        'SELECT endpoint_id AS "endpointId", ts_ms AS "tsMs", state_json AS "stateJson" FROM endpoint_history_events WHERE endpoint_id = ? AND ts_ms < ? ORDER BY ts_ms DESC LIMIT 1',
        [id, fromMs],
      )) as EndpointHistoryEventRow[];
      const row = baseRows[0];
      const parsed = row ? parseStateJson(row.stateJson) : undefined;
      if (row && parsed) baselines.set(id, { tsMs: Number(row.tsMs), state: parsed });
    }
  }

  const placeholders = uniqueIds.map(() => '?').join(',');
  const rangeLimit = Math.min(50_000, Math.max(100, uniqueIds.length * maxPerEndpoint));
  const rangeRows = (await manager.query(
    sqlParams(
      isPostgres,
      `SELECT endpoint_id AS "endpointId", ts_ms AS "tsMs", state_json AS "stateJson" FROM endpoint_history_events WHERE endpoint_id IN (${placeholders}) AND ts_ms >= ? AND ts_ms <= ? ORDER BY endpoint_id ASC, ts_ms ASC LIMIT ?`,
    ),
    [...uniqueIds, fromMs, toMs, rangeLimit],
  )) as EndpointHistoryEventRow[];

  for (const id of uniqueIds) {
    const base = baselines.get(id);
    if (base) out[id]!.push(base);
  }
  for (const row of rangeRows) {
    const list = out[row.endpointId];
    if (!list || list.length >= maxPerEndpoint + 1) continue;
    const parsed = parseStateJson(row.stateJson);
    if (parsed) list.push({ tsMs: Number(row.tsMs), state: parsed });
  }
  return out;
}

export function queryRawSamplesAfterCursor(
  manager: EntityManager,
  isPostgres: boolean,
  cursor: TimeKeyCursor,
  limit: number,
): Promise<readonly RawStatisticSample[]> {
  return manager.query(
    sqlParams(
      isPostgres,
      'SELECT metadata_id AS "metadataId", timestamp, value FROM stats_raw WHERE timestamp > ? OR (timestamp = ? AND metadata_id > ?) ORDER BY timestamp ASC, metadata_id ASC LIMIT ?',
    ),
    [cursor.ts, cursor.ts, cursor.key, limit],
  ) as Promise<readonly RawStatisticSample[]>;
}

export async function queryRollupsAfterCursor(
  manager: EntityManager,
  isPostgres: boolean,
  tier: '5m' | '1h',
  cursor: TimeKeyCursor,
  limit: number,
): Promise<readonly StatisticRollup[]> {
  const table = tier === '5m' ? 'stats_5m' : 'stats_1h';
  const rows = (await manager.query(
    sqlParams(
      isPostgres,
      `SELECT metadata_id AS "metadataId", start_ts AS "startTs", min, max, mean, first, last, sum, count FROM "${table}" WHERE start_ts > ? OR (start_ts = ? AND metadata_id > ?) ORDER BY start_ts ASC, metadata_id ASC LIMIT ?`,
    ),
    [cursor.ts, cursor.ts, cursor.key, limit],
  )) as StatisticRollupRow[];
  return rows.map((row) => ({
    metadataId: row.metadataId,
    startTs: row.startTs,
    min: row.min,
    max: row.max,
    mean: row.mean,
    first: row.first,
    last: row.last,
    sum: row.sum,
    count: row.count,
  }));
}

export function queryEndpointHistoryAfterCursor(
  manager: EntityManager,
  isPostgres: boolean,
  cursor: TimeKeyCursor,
  limit: number,
): Promise<readonly EndpointHistoryEventRow[]> {
  return manager.query(
    sqlParams(
      isPostgres,
      'SELECT endpoint_id AS "endpointId", ts_ms AS "tsMs", state_json AS "stateJson" FROM endpoint_history_events WHERE ts_ms > ? OR (ts_ms = ? AND endpoint_id > ?) ORDER BY ts_ms ASC, endpoint_id ASC LIMIT ?',
    ),
    [cursor.ts, cursor.ts, cursor.key, limit],
  ) as Promise<readonly EndpointHistoryEventRow[]>;
}
