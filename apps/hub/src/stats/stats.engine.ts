/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createHash } from 'node:crypto';
import type {
  StatisticMetadata,
  RawStatisticSample,
  StatisticKind,
  StatisticSource,
} from '@haus/core';
import type { StatisticMetadataRow } from './stats.types.js';
import type { StatsStore } from './stats.store.js';
import { StatsBuffer, type StatsBufferOptions } from './stats.buffer.js';
import {
  StatsRollupWorker,
  type StatsWorkerOptions,
  type RollupCycleResult,
  type EvictionCycleResult,
} from './stats.worker.js';

export interface StatsEngineOptions {
  readonly buffer?: StatsBufferOptions;
  readonly worker?: StatsWorkerOptions;
  readonly onError?: (error: unknown) => void;
}

export interface RegisterStatisticOptions {
  readonly source?: StatisticSource;
  readonly unit?: string;
  readonly kind?: StatisticKind;
  readonly displayName?: string;
  readonly hasMean?: boolean;
  readonly hasSum?: boolean;
}

function metadataRow(meta: StatisticMetadata): StatisticMetadataRow {
  return {
    id: meta.id,
    statisticId: meta.statisticId,
    source: meta.source,
    unit: meta.unit ?? null,
    kind: meta.kind,
    displayName: meta.displayName ?? null,
    hasMean: meta.hasMean,
    hasSum: meta.hasSum,
    createdAt: meta.createdAt,
  };
}

/** Keeps ingestion synchronous and in-memory while TypeORM writes run in bounded batches. */
export class StatsEngine {
  private readonly buffer = new StatsBuffer();
  private readonly worker: StatsRollupWorker;
  private readonly metadata = new Map<string, StatisticMetadata>();
  private readonly pendingMetadata = new Map<string, StatisticMetadataRow>();
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushTask: Promise<number> | null = null;
  private lastFailure: unknown;

  constructor(
    public readonly store: StatsStore,
    private readonly options: StatsEngineOptions = {},
  ) {
    this.flushIntervalMs = options.buffer?.flushIntervalMs ?? 2000;
    this.maxBufferSize = options.buffer?.maxBufferSize ?? 10000;
    this.worker = new StatsRollupWorker(store, options.worker, (error) => this.reportError(error));
  }

  public async initialize(): Promise<void> {
    for (const metadata of await this.store.listMetadata()) {
      this.metadata.set(metadata.statisticId, metadata);
    }
  }

  public start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.scheduleFlush(), this.flushIntervalMs);
    this.flushTimer.unref();
    this.worker.start();
  }

  public async stop(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    await this.worker.stop();
    while (this.buffer.pendingCount > 0 || this.pendingMetadata.size > 0 || this.flushTask) {
      await this.flush();
    }
  }

  public register(statisticId: string, options: RegisterStatisticOptions = {}): StatisticMetadata {
    const existing = this.metadata.get(statisticId);
    if (existing) return existing;

    const kind = options.kind ?? 'gauge';
    const isCounter = kind === 'counter';
    const meta: StatisticMetadata = {
      id: createHash('sha256').update(statisticId).digest('hex').slice(0, 16),
      statisticId,
      source: options.source ?? 'device',
      unit: options.unit,
      kind,
      displayName: options.displayName,
      hasMean: options.hasMean ?? !isCounter,
      hasSum: options.hasSum ?? isCounter,
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.metadata.set(statisticId, meta);
    this.pendingMetadata.set(statisticId, metadataRow(meta));
    return meta;
  }

  /** Records without I/O; persistence happens on the flush timer or at capacity. */
  public record(statisticId: string, value: number, timestampSeconds?: number): void {
    const meta = this.metadata.get(statisticId) ?? this.register(statisticId);
    this.buffer.record({
      metadataId: meta.id,
      timestamp: timestampSeconds ?? Math.floor(Date.now() / 1000),
      value,
    });
    if (this.buffer.pendingCount >= this.maxBufferSize) this.scheduleFlush();
  }

  public flush(): Promise<number> {
    if (this.flushTask) return this.flushTask;
    const samples = this.buffer.take();
    const metadata = [...this.pendingMetadata.values()];
    if (samples.length === 0 && metadata.length === 0) return Promise.resolve(0);

    const task = this.store
      .persistIngestion(samples, metadata)
      .then(() => {
        for (const row of metadata) {
          if (this.pendingMetadata.get(row.statisticId) === row) {
            this.pendingMetadata.delete(row.statisticId);
          }
        }
        this.options.buffer?.onFlush?.(samples.length);
        this.lastFailure = undefined;
        return samples.length;
      })
      .catch((error: unknown) => {
        this.buffer.restore(samples);
        this.reportError(error);
        throw error;
      })
      .finally(() => {
        if (this.flushTask === task) this.flushTask = null;
      });
    this.flushTask = task;
    return task;
  }

  public processRollups(currentTsSeconds?: number): Promise<RollupCycleResult> {
    return this.worker.processRollups(currentTsSeconds);
  }

  public processEviction(currentTsSeconds?: number): Promise<EvictionCycleResult> {
    return this.worker.processEviction(currentTsSeconds);
  }

  public get pendingBufferCount(): number {
    return this.buffer.pendingCount;
  }

  public getMetadata(statisticId: string): StatisticMetadata | undefined {
    return this.metadata.get(statisticId);
  }

  public listMetadata(source?: StatisticSource): readonly StatisticMetadata[] {
    return [...this.metadata.values()]
      .filter((metadata) => !source || metadata.source === source)
      .sort((left, right) => left.statisticId.localeCompare(right.statisticId));
  }

  public get lastPersistenceFailure(): unknown {
    return this.lastFailure;
  }

  public getBufferedSamples(statisticId: string): readonly RawStatisticSample[] {
    const meta = this.metadata.get(statisticId);
    return meta ? this.buffer.getRecent(meta.id) : [];
  }

  private scheduleFlush(): void {
    const task = this.flush();
    void task.catch((error: unknown) => this.reportError(error));
  }

  private reportError(error: unknown): void {
    this.lastFailure = error;
    this.options.onError?.(error);
  }
}
