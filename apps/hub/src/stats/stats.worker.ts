/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  alignTo5m,
  alignTo1h,
  computeRollup,
  combineRollups,
  FIVE_MINUTES_SECONDS,
  ONE_HOUR_SECONDS,
} from '@haus/core';
import type { StatsStore } from './stats.store.js';

export interface StatsWorkerOptions {
  readonly rollupIntervalMs?: number;
  readonly evictionIntervalMs?: number;
  readonly rawRetentionSeconds?: number;
  readonly fiveMinRetentionSeconds?: number;
}

export interface RollupCycleResult {
  readonly fiveMinuteRollups: number;
  readonly oneHourRollups: number;
}

export interface EvictionCycleResult {
  readonly rawPurged: number;
  readonly rollupsPurged: number;
}

/**
 * Background worker for incremental statistics rollup calculation and retention eviction.
 * Aggregates raw samples into 5-minute buckets, 5-minute rollups into 1-hour buckets,
 * and purges aged telemetry beyond retention windows.
 */
export class StatsRollupWorker {
  private readonly rollupIntervalMs: number;
  private readonly evictionIntervalMs: number;
  private readonly rawRetentionSeconds: number;
  private readonly fiveMinRetentionSeconds: number;

  private rollupTimer: NodeJS.Timeout | null = null;
  private evictionTimer: NodeJS.Timeout | null = null;
  private isProcessingRollups = false;
  private isProcessingEviction = false;

  constructor(
    private readonly store: StatsStore,
    options: StatsWorkerOptions = {},
  ) {
    this.rollupIntervalMs = options.rollupIntervalMs ?? 30_000;
    this.evictionIntervalMs = options.evictionIntervalMs ?? 3_600_000;
    this.rawRetentionSeconds = options.rawRetentionSeconds ?? 48 * 3600; // 48 hours
    this.fiveMinRetentionSeconds = options.fiveMinRetentionSeconds ?? 90 * 86400; // 90 days
  }

  public start(): void {
    if (!this.rollupTimer) {
      this.rollupTimer = setInterval(() => {
        void this.processRollups();
      }, this.rollupIntervalMs);
      this.rollupTimer.unref();
    }

    if (!this.evictionTimer) {
      this.evictionTimer = setInterval(() => {
        void this.processEviction();
      }, this.evictionIntervalMs);
      this.evictionTimer.unref();
    }
  }

  public stop(): void {
    if (this.rollupTimer) {
      clearInterval(this.rollupTimer);
      this.rollupTimer = null;
    }
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  /**
   * Executes an incremental rollup cycle for all registered metadata.
   * Checks for any closed 5-minute and 1-hour buckets that have not yet been aggregated.
   */
  public processRollups(currentTsSeconds?: number): RollupCycleResult {
    if (this.isProcessingRollups) {
      return { fiveMinuteRollups: 0, oneHourRollups: 0 };
    }

    this.isProcessingRollups = true;
    try {
      const now = currentTsSeconds ?? Math.floor(Date.now() / 1000);
      const metadataList = this.store.listMetadata();
      let fiveMinuteCount = 0;
      let oneHourCount = 0;

      // Current open bucket starts; rollups are only finalized for completed past buckets
      const current5mBucket = alignTo5m(now);
      const current1hBucket = alignTo1h(now);

      for (const meta of metadataList) {
        // 1. Process 5m rollups: check past buckets up to 2 hours back
        const checkStart5m = current5mBucket - 2 * 3600;
        for (let bucket = checkStart5m; bucket < current5mBucket; bucket += FIVE_MINUTES_SECONDS) {
          const existing = this.store.query5mRollups(meta.id, bucket, bucket);
          if (existing.length === 0) {
            const rawSamples = this.store.queryRawSamples(
              meta.id,
              bucket,
              bucket + FIVE_MINUTES_SECONDS - 1,
            );
            if (rawSamples.length > 0) {
              const rollup = computeRollup(meta.id, bucket, rawSamples, meta.kind);
              if (rollup) {
                this.store.insert5mRollups([rollup]);
                fiveMinuteCount++;
              }
            }
          }
        }

        // 2. Process 1h rollups: check past buckets up to 24 hours back
        const checkStart1h = current1hBucket - 24 * 3600;
        for (
          let hourBucket = checkStart1h;
          hourBucket < current1hBucket;
          hourBucket += ONE_HOUR_SECONDS
        ) {
          const existing1h = this.store.query1hRollups(meta.id, hourBucket, hourBucket);
          if (existing1h.length === 0) {
            const fiveMinRollups = this.store.query5mRollups(
              meta.id,
              hourBucket,
              hourBucket + ONE_HOUR_SECONDS - 1,
            );
            if (fiveMinRollups.length > 0) {
              const rollup1h = combineRollups(meta.id, hourBucket, fiveMinRollups);
              if (rollup1h) {
                this.store.insert1hRollups([rollup1h]);
                oneHourCount++;
              }
            }
          }
        }
      }

      return {
        fiveMinuteRollups: fiveMinuteCount,
        oneHourRollups: oneHourCount,
      };
    } finally {
      this.isProcessingRollups = false;
    }
  }

  /**
   * Executes retention eviction: purges raw samples older than `rawRetentionSeconds`
   * and 5m rollups older than `fiveMinRetentionSeconds`.
   */
  public processEviction(currentTsSeconds?: number): EvictionCycleResult {
    if (this.isProcessingEviction) {
      return { rawPurged: 0, rollupsPurged: 0 };
    }

    this.isProcessingEviction = true;
    try {
      const now = currentTsSeconds ?? Math.floor(Date.now() / 1000);
      const rawPurged = this.store.purgeOldRawSamples(this.rawRetentionSeconds, now);
      const rollupsPurged = this.store.purgeOld5mRollups(this.fiveMinRetentionSeconds, now);

      return { rawPurged, rollupsPurged };
    } finally {
      this.isProcessingEviction = false;
    }
  }
}
