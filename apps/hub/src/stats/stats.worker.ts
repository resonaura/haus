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

/** Calculates closed rollups in bounded batches and removes expired tiers. */
export class StatsRollupWorker {
  private readonly rollupIntervalMs: number;
  private readonly evictionIntervalMs: number;
  private readonly rawRetentionSeconds: number;
  private readonly fiveMinRetentionSeconds: number;
  private rollupTimer: NodeJS.Timeout | null = null;
  private evictionTimer: NodeJS.Timeout | null = null;
  private rollupTask: Promise<RollupCycleResult> | null = null;
  private evictionTask: Promise<EvictionCycleResult> | null = null;
  private isProcessingRollups = false;
  private isProcessingEviction = false;

  constructor(
    private readonly store: StatsStore,
    options: StatsWorkerOptions = {},
    private readonly onError: (error: unknown) => void = (error) => {
      process.emitWarning(error instanceof Error ? error : String(error));
    },
  ) {
    this.rollupIntervalMs = options.rollupIntervalMs ?? 30_000;
    this.evictionIntervalMs = options.evictionIntervalMs ?? 3_600_000;
    this.rawRetentionSeconds = options.rawRetentionSeconds ?? 48 * 3600;
    this.fiveMinRetentionSeconds = options.fiveMinRetentionSeconds ?? 90 * 86400;
  }

  public start(): void {
    if (!this.rollupTimer) {
      this.rollupTimer = setInterval(() => this.scheduleRollups(), this.rollupIntervalMs);
      this.rollupTimer.unref();
    }
    if (!this.evictionTimer) {
      this.evictionTimer = setInterval(() => this.scheduleEviction(), this.evictionIntervalMs);
      this.evictionTimer.unref();
    }
  }

  public async stop(): Promise<void> {
    if (this.rollupTimer) clearInterval(this.rollupTimer);
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    this.rollupTimer = null;
    this.evictionTimer = null;
    await Promise.all([this.rollupTask, this.evictionTask].filter((task) => task !== null));
  }

  public async processRollups(currentTsSeconds?: number): Promise<RollupCycleResult> {
    if (this.isProcessingRollups) {
      return { fiveMinuteRollups: 0, oneHourRollups: 0 };
    }

    this.isProcessingRollups = true;
    try {
      const now = currentTsSeconds ?? Math.floor(Date.now() / 1000);
      const current5mBucket = alignTo5m(now);
      const current1hBucket = alignTo1h(now);
      const metadataList = await this.store.listMetadata();
      let fiveMinuteCount = 0;
      let oneHourCount = 0;

      for (const meta of metadataList) {
        const start5m = current5mBucket - 2 * 3600;
        const existing5m = await this.store.query5mRollups(meta.id, start5m, current5mBucket - 1);
        const completed5m = new Set(existing5m.map((rollup) => rollup.startTs));
        const pending5m = [];

        for (let bucket = start5m; bucket < current5mBucket; bucket += FIVE_MINUTES_SECONDS) {
          if (completed5m.has(bucket)) continue;
          const samples = await this.store.queryRawSamples(
            meta.id,
            bucket,
            bucket + FIVE_MINUTES_SECONDS - 1,
          );
          const rollup = computeRollup(meta.id, bucket, samples, meta.kind);
          if (rollup) pending5m.push(rollup);
        }

        if (pending5m.length > 0) {
          await this.store.insert5mRollups(pending5m);
          fiveMinuteCount += pending5m.length;
        }

        const start1h = current1hBucket - 24 * 3600;
        const existing1h = await this.store.query1hRollups(meta.id, start1h, current1hBucket - 1);
        const completed1h = new Set(existing1h.map((rollup) => rollup.startTs));
        const fiveMinuteRollups = await this.store.query5mRollups(
          meta.id,
          start1h,
          current1hBucket - 1,
        );
        const pending1h = [];

        for (let hour = start1h; hour < current1hBucket; hour += ONE_HOUR_SECONDS) {
          if (completed1h.has(hour)) continue;
          const rollups = fiveMinuteRollups.filter(
            (rollup) => rollup.startTs >= hour && rollup.startTs < hour + ONE_HOUR_SECONDS,
          );
          const rollup = combineRollups(meta.id, hour, rollups);
          if (rollup) pending1h.push(rollup);
        }

        if (pending1h.length > 0) {
          await this.store.insert1hRollups(pending1h);
          oneHourCount += pending1h.length;
        }
      }

      return { fiveMinuteRollups: fiveMinuteCount, oneHourRollups: oneHourCount };
    } finally {
      this.isProcessingRollups = false;
    }
  }

  public async processEviction(currentTsSeconds?: number): Promise<EvictionCycleResult> {
    if (this.isProcessingEviction) return { rawPurged: 0, rollupsPurged: 0 };

    this.isProcessingEviction = true;
    try {
      const now = currentTsSeconds ?? Math.floor(Date.now() / 1000);
      const rawPurged = await this.store.purgeOldRawSamples(this.rawRetentionSeconds, now);
      const rollupsPurged = await this.store.purgeOld5mRollups(this.fiveMinRetentionSeconds, now);
      return { rawPurged, rollupsPurged };
    } finally {
      this.isProcessingEviction = false;
    }
  }

  private scheduleRollups(): void {
    const task = this.processRollups();
    this.rollupTask = task;
    void task.catch(this.onError).finally(() => {
      if (this.rollupTask === task) this.rollupTask = null;
    });
  }

  private scheduleEviction(): void {
    const task = this.processEviction();
    this.evictionTask = task;
    void task.catch(this.onError).finally(() => {
      if (this.evictionTask === task) this.evictionTask = null;
    });
  }
}
