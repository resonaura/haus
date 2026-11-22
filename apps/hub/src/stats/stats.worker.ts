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
  readonly endpointHistoryRetentionSeconds?: number;
}

export interface RollupCycleResult {
  readonly fiveMinuteRollups: number;
  readonly oneHourRollups: number;
}

export interface EvictionCycleResult {
  readonly rawPurged: number;
  readonly rollupsPurged: number;
  readonly historyPurged?: number;
}

export type StatsRollupStorePort = Pick<
  StatsStore,
  | 'listMetadata'
  | 'query5mRollups'
  | 'query1hRollups'
  | 'queryRawSamples'
  | 'insert5mRollups'
  | 'insert1hRollups'
  | 'purgeOldRawSamples'
  | 'purgeOld5mRollups'
> &
  Partial<Pick<StatsStore, 'purgeOldEndpointHistory' | 'isPostgres'>>;

/** Calculates closed rollups in bounded batches and removes expired tiers. */
export class StatsRollupWorker {
  private readonly rollupIntervalMs: number;
  private readonly evictionIntervalMs: number;
  private readonly rawRetentionSeconds: number;
  private readonly fiveMinRetentionSeconds: number;
  private readonly endpointHistoryRetentionSeconds: number;
  private rollupTimer: NodeJS.Timeout | null = null;
  private evictionTimer: NodeJS.Timeout | null = null;
  private rollupTask: Promise<RollupCycleResult> | null = null;
  private evictionTask: Promise<EvictionCycleResult> | null = null;
  private isProcessingRollups = false;
  private isProcessingEviction = false;
  private readonly dirtyMetadataIds = new Set<string>();
  private initialSweepDone = false;

  constructor(
    private readonly store: StatsRollupStorePort,
    options: StatsWorkerOptions = {},
    private readonly onError: (error: unknown) => void = (error) => {
      process.emitWarning(error instanceof Error ? error : String(error));
    },
  ) {
    const isPg = Boolean(store.isPostgres);
    const historyDaysEnv = Number(process.env.HAUS_HISTORY_RETENTION_DAYS);
    const defaultHistoryDays =
      Number.isFinite(historyDaysEnv) && historyDaysEnv > 0 ? historyDaysEnv : isPg ? 365 : 30;
    this.rollupIntervalMs = options.rollupIntervalMs ?? 60_000;
    this.evictionIntervalMs = options.evictionIntervalMs ?? 3_600_000;
    this.rawRetentionSeconds = options.rawRetentionSeconds ?? (isPg ? 7 * 86400 : 48 * 3600);
    this.fiveMinRetentionSeconds =
      options.fiveMinRetentionSeconds ?? (isPg ? 365 * 86400 : 90 * 86400);
    this.endpointHistoryRetentionSeconds =
      options.endpointHistoryRetentionSeconds ?? defaultHistoryDays * 86400;
  }

  public markDirty(metadataId: string): void {
    if (metadataId) this.dirtyMetadataIds.add(metadataId);
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
      const useDirtyFilter = currentTsSeconds === undefined && this.initialSweepDone;
      const dirtySnapshot = useDirtyFilter ? new Set(this.dirtyMetadataIds) : undefined;
      if (useDirtyFilter) {
        this.dirtyMetadataIds.clear();
        if (dirtySnapshot && dirtySnapshot.size === 0) {
          return { fiveMinuteRollups: 0, oneHourRollups: 0 };
        }
      }

      const allMetadata = await this.store.listMetadata();
      const metadataList = dirtySnapshot
        ? allMetadata.filter((meta) => dirtySnapshot.has(meta.id))
        : allMetadata;
      let fiveMinuteCount = 0;
      let oneHourCount = 0;
      let processed = 0;

      for (const meta of metadataList) {
        if (processed > 0 && processed % 4 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        processed += 1;

        const start5m = current5mBucket - 2 * 3600;
        const existing5m = await this.store.query5mRollups(meta.id, start5m, current5mBucket - 1);
        const completed5m = new Set(existing5m.map((rollup) => rollup.startTs));
        const missingBuckets: number[] = [];

        for (let bucket = start5m; bucket < current5mBucket; bucket += FIVE_MINUTES_SECONDS) {
          if (!completed5m.has(bucket)) missingBuckets.push(bucket);
        }

        const pending5m = [];
        if (missingBuckets.length > 0) {
          const rangeStart = missingBuckets[0]!;
          const rangeEnd = missingBuckets[missingBuckets.length - 1]! + FIVE_MINUTES_SECONDS - 1;
          const allSamples = await this.store.queryRawSamples(
            meta.id,
            rangeStart,
            rangeEnd,
            50_000,
          );
          if (allSamples.length > 0) {
            const byBucket = new Map<
              number,
              typeof allSamples extends readonly (infer S)[] ? S[] : never
            >();
            for (const sample of allSamples) {
              const b = alignTo5m(sample.timestamp);
              if (completed5m.has(b)) continue;
              const arr = byBucket.get(b);
              if (arr) arr.push(sample);
              else byBucket.set(b, [sample]);
            }
            for (const bucket of missingBuckets) {
              const bucketSamples = byBucket.get(bucket);
              if (!bucketSamples || bucketSamples.length === 0) continue;
              const rollup = computeRollup(meta.id, bucket, bucketSamples, meta.kind);
              if (rollup) pending5m.push(rollup);
            }
          }
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

        if (fiveMinuteRollups.length > 0) {
          for (let hour = start1h; hour < current1hBucket; hour += ONE_HOUR_SECONDS) {
            if (completed1h.has(hour)) continue;
            const rollups = fiveMinuteRollups.filter(
              (rollup) => rollup.startTs >= hour && rollup.startTs < hour + ONE_HOUR_SECONDS,
            );
            const rollup = combineRollups(meta.id, hour, rollups);
            if (rollup) pending1h.push(rollup);
          }
        }

        if (pending1h.length > 0) {
          await this.store.insert1hRollups(pending1h);
          oneHourCount += pending1h.length;
        }
      }

      if (currentTsSeconds === undefined) {
        this.initialSweepDone = true;
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
      const historyPurged = this.store.purgeOldEndpointHistory
        ? await this.store.purgeOldEndpointHistory(
            this.endpointHistoryRetentionSeconds * 1000,
            now * 1000,
          )
        : 0;
      return { rawPurged, rollupsPurged, historyPurged };
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
