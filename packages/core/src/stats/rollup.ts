/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { RawStatisticSample, StatisticKind, StatisticRollup } from './types.js';

export const FIVE_MINUTES_SECONDS = 300;
export const ONE_HOUR_SECONDS = 3600;

/**
 * Aligns a Unix epoch seconds timestamp down to the start of its enclosing interval bucket.
 */
export function alignToBucket(timestampSeconds: number, bucketSeconds: number): number {
  if (bucketSeconds <= 0) return Math.floor(timestampSeconds);
  return Math.floor(timestampSeconds / bucketSeconds) * bucketSeconds;
}

export function alignTo5m(timestampSeconds: number): number {
  return alignToBucket(timestampSeconds, FIVE_MINUTES_SECONDS);
}

export function alignTo1h(timestampSeconds: number): number {
  return alignToBucket(timestampSeconds, ONE_HOUR_SECONDS);
}

/**
 * Computes an aggregated rollup record from a batch of raw samples belonging to the same bucket.
 */
export function computeRollup(
  metadataId: string,
  startTs: number,
  samples: readonly RawStatisticSample[],
  kind: StatisticKind = 'gauge',
): StatisticRollup | null {
  if (samples.length === 0) return null;

  // Sort samples chronologically if needed
  const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);

  let min = sorted[0].value;
  let max = sorted[0].value;
  let rawSum = 0;

  for (const s of sorted) {
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
    rawSum += s.value;
  }

  const count = sorted.length;
  const first = sorted[0].value;
  const last = sorted[sorted.length - 1].value;

  const isCounter = kind === 'counter';
  const mean = isCounter ? null : Math.round((rawSum / count) * 1000) / 1000;
  const sum = isCounter ? Math.round((last - first) * 1000) / 1000 : null;

  return {
    metadataId,
    startTs,
    min,
    max,
    mean,
    first,
    last,
    sum,
    count,
  };
}

/**
 * Combines multiple smaller rollups (e.g. 5m intervals) into a higher-tier rollup (e.g. 1h).
 */
export function combineRollups(
  metadataId: string,
  startTs: number,
  rollups: readonly StatisticRollup[],
): StatisticRollup | null {
  if (rollups.length === 0) return null;

  const sorted = [...rollups].sort((a, b) => a.startTs - b.startTs);

  let min = sorted[0].min;
  let max = sorted[0].max;
  let totalCount = 0;
  let weightedMeanSum = 0;
  let totalSum: number | null = null;

  for (const r of sorted) {
    if (r.min < min) min = r.min;
    if (r.max > max) max = r.max;
    totalCount += r.count;

    if (r.mean !== null) {
      weightedMeanSum += r.mean * r.count;
    }
    if (r.sum !== null) {
      totalSum = (totalSum ?? 0) + r.sum;
    }
  }

  const first = sorted[0].first;
  const last = sorted[sorted.length - 1].last;
  const mean =
    totalCount > 0 && sorted[0].mean !== null
      ? Math.round((weightedMeanSum / totalCount) * 1000) / 1000
      : null;

  return {
    metadataId,
    startTs,
    min,
    max,
    mean,
    first,
    last,
    sum: totalSum !== null ? Math.round(totalSum * 1000) / 1000 : null,
    count: totalCount,
  };
}
