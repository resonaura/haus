/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type HistoryPoint = { readonly at: number; readonly state: string };

export interface HistoryRow {
  readonly s?: unknown;
  readonly state?: unknown;
  readonly lu?: unknown;
  readonly lc?: unknown;
  readonly last_updated?: string;
  readonly last_changed?: string;
}

export function historyPoints(
  rows: readonly HistoryRow[],
  from?: number,
  to?: number,
): HistoryPoint[] {
  const unique = new Map<number, HistoryPoint>();
  for (const row of rows) {
    const at =
      typeof row.lu === 'number'
        ? row.lu * 1000
        : typeof row.lc === 'number'
          ? row.lc * 1000
          : Date.parse(row.last_updated || row.last_changed || '');
    const state = row.s ?? row.state;
    if (Number.isFinite(at) && state !== undefined && state !== null) {
      unique.set(at, { at, state: String(state) });
    }
  }
  const points = [...unique.values()].sort((a, b) => a.at - b.at);
  if (from === undefined) return points;
  const first = points.findIndex((point) => point.at >= from);
  const start = first < 0 ? Math.max(0, points.length - 1) : Math.max(0, first - 1);
  return points.slice(start).filter((point) => to === undefined || point.at <= to);
}

export const numericState = (state: string): number | undefined =>
  state.trim() && Number.isFinite(Number(state)) ? Number(state) : undefined;

export interface HistorySample extends HistoryPoint {
  readonly value: number;
  readonly segment: number;
  readonly index: number;
}

/** Keep each pixel bucket's extrema and endpoints; segment identity preserves known data gaps. */
export function historyChart(
  points: readonly HistoryPoint[],
  from: number,
  to: number,
  width = 580,
) {
  const buckets = new Map<
    number,
    { first: HistorySample; last: HistorySample; low: HistorySample; high: HistorySample }
  >();
  let segment = 0;
  let low = Infinity;
  let high = -Infinity;
  let count = 0;

  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const value = numericState(point.state);
    if (value === undefined) {
      segment++;
      continue;
    }
    if (point.at > to) continue;
    if (point.at < from && points[index + 1]?.at < from) continue;
    const sample: HistorySample = { ...point, at: Math.max(from, point.at), value, segment, index };
    low = Math.min(low, value);
    high = Math.max(high, value);
    count++;
    const key = Math.max(
      0,
      Math.min(width, Math.floor(((sample.at - from) / Math.max(1, to - from)) * width)),
    );
    const bucket = buckets.get(key);
    if (!bucket) buckets.set(key, { first: sample, last: sample, low: sample, high: sample });
    else {
      bucket.last = sample;
      if (value < bucket.low.value) bucket.low = sample;
      if (value > bucket.high.value) bucket.high = sample;
    }
  }

  const samples = [...buckets.values()].flatMap((bucket) =>
    [
      ...new Map(
        [bucket.first, bucket.low, bucket.high, bucket.last].map((point) => [point.index, point]),
      ).values(),
    ].sort((a, b) => a.index - b.index),
  );

  let previousSegment: number | undefined;
  const path = samples
    .map((point) => {
      const command = previousSegment === point.segment ? 'L' : 'M';
      previousSegment = point.segment;
      const x = 10 + ((point.at - from) / Math.max(1, to - from)) * width;
      const y = high === low ? 80 : 145 - ((point.value - low) / (high - low)) * 130;
      return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return { path, low, high, count, samples };
}

export function nearestHistoryPoint(points: readonly HistoryPoint[], at: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (points[mid].at < at) low = mid + 1;
    else high = mid;
  }
  if (!low) return 0;
  if (low >= points.length) return points.length - 1;
  return at - points[low - 1].at <= points[low].at - at ? low - 1 : low;
}
