/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/**
 * Kind of statistical metric determining mathematical aggregation behavior:
 * - 'gauge': Continuous instantaneous measurements (temperature, voltage, CPU %); rolls up with mean, min, max.
 * - 'counter': Monotonically increasing accumulators (energy kWh, water liters); rolls up with sum delta and last.
 * - 'rate': Velocity or throughput per unit time (packets/sec, bytes/sec); rolls up with mean, min, max.
 * - 'state': Discrete or binary state transition counters (door open count, automation triggers).
 */
export type StatisticKind = 'gauge' | 'counter' | 'rate' | 'state';

/**
 * Origin subsystem producing the metric telemetry.
 */
export type StatisticSource = 'device' | 'system' | 'radio' | 'automation' | 'media' | 'custom';

/**
 * Canonical metadata entity describing a registered statistic series.
 */
export interface StatisticMetadata {
  readonly id: string;
  readonly statisticId: string;
  readonly source: StatisticSource;
  readonly unit?: string;
  readonly kind: StatisticKind;
  readonly displayName?: string;
  readonly hasMean: boolean;
  readonly hasSum: boolean;
  readonly createdAt: number; // Unix epoch seconds
}

/**
 * High-resolution raw sample point before rollup aggregation.
 */
export interface RawStatisticSample {
  readonly metadataId: string;
  readonly timestamp: number; // Unix epoch seconds (integer)
  readonly value: number;
}

/**
 * Compact aggregated rollup record for 5-minute or 1-hour tiers.
 */
export interface StatisticRollup {
  readonly metadataId: string;
  readonly startTs: number; // Unix epoch seconds aligned to interval start
  readonly min: number;
  readonly max: number;
  readonly mean: number | null;
  readonly first: number;
  readonly last: number;
  readonly sum: number | null;
  readonly count: number;
}

/**
 * Storage and query tier resolution.
 */
export type StatisticResolution = 'raw' | '5m' | '1h';

/**
 * Input query parameters for retrieving timeseries statistics.
 */
export interface StatsQueryFilter {
  readonly statisticIds: readonly string[];
  readonly start: number; // Unix epoch seconds
  readonly end: number; // Unix epoch seconds
  readonly resolution?: StatisticResolution;
  readonly maxPoints?: number; // Target viewport bucket count for adaptive downsampling
}

/**
 * Uniform output timeseries point returned to charting clients.
 */
export interface StatsDataPoint {
  readonly timestamp: number;
  readonly value?: number;
  readonly min?: number;
  readonly max?: number;
  readonly mean?: number;
  readonly last?: number;
  readonly sum?: number;
  readonly count?: number;
}

/**
 * Formatted series result for a single requested statistic ID.
 */
export interface StatsSeriesResult {
  readonly metadata: StatisticMetadata;
  readonly resolution: StatisticResolution;
  readonly data: readonly StatsDataPoint[];
}
