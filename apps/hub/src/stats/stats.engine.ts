/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  StatisticMetadata,
  RawStatisticSample,
  StatisticKind,
  StatisticSource,
} from '@haus/core';
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
}

export interface RegisterStatisticOptions {
  readonly source?: StatisticSource;
  readonly unit?: string;
  readonly kind?: StatisticKind;
  readonly displayName?: string;
  readonly hasMean?: boolean;
  readonly hasSum?: boolean;
}

/**
 * High-performance statistics ingestion and rollup orchestration engine.
 * Combines zero-allocation in-memory ring-buffer ingestion with synchronous SQLite
 * batch persistence, background incremental rollup workers, and cached metadata resolution.
 */
export class StatsEngine {
  private readonly buffer: StatsBuffer;
  private readonly worker: StatsRollupWorker;
  private readonly metaCache = new Map<string, StatisticMetadata>();

  constructor(
    public readonly store: StatsStore,
    options: StatsEngineOptions = {},
  ) {
    this.buffer = new StatsBuffer(this.store, options.buffer);
    this.worker = new StatsRollupWorker(this.store, options.worker);
  }

  public start(): void {
    this.buffer.start();
    this.worker.start();
  }

  public stop(): void {
    this.worker.stop();
    this.buffer.stop();
  }

  /**
   * Registers or ensures metadata exists for a statistic identifier.
   * Results are cached in memory for sub-microsecond ingestion lookups.
   */
  public register(statisticId: string, options: RegisterStatisticOptions = {}): StatisticMetadata {
    const existing = this.metaCache.get(statisticId) ?? this.store.getMetadata(statisticId);
    if (existing) {
      this.metaCache.set(statisticId, existing);
      return existing;
    }

    const kind = options.kind ?? 'gauge';
    const isCounter = kind === 'counter';

    const meta = this.store.registerMetadata({
      statisticId,
      source: options.source ?? 'device',
      unit: options.unit,
      kind,
      displayName: options.displayName,
      hasMean: options.hasMean ?? !isCounter,
      hasSum: options.hasSum ?? isCounter,
    });

    this.metaCache.set(statisticId, meta);
    return meta;
  }

  /**
   * Records a numeric measurement for a statistic identifier.
   * Non-blocking: pushes directly to the in-memory batch buffer.
   */
  public record(statisticId: string, value: number, timestampSeconds?: number): void {
    let meta = this.metaCache.get(statisticId);
    if (!meta) {
      meta = this.register(statisticId);
    }

    const ts = timestampSeconds ?? Math.floor(Date.now() / 1000);
    this.buffer.record({
      metadataId: meta.id,
      timestamp: ts,
      value,
    });
  }

  public flush(): number {
    return this.buffer.flush();
  }

  public processRollups(currentTsSeconds?: number): RollupCycleResult {
    return this.worker.processRollups(currentTsSeconds);
  }

  public processEviction(currentTsSeconds?: number): EvictionCycleResult {
    return this.worker.processEviction(currentTsSeconds);
  }

  public get pendingBufferCount(): number {
    return this.buffer.pendingCount;
  }

  /**
   * Retrieves buffered in-memory samples for an entity that haven't been written to SQLite yet.
   */
  public getBufferedSamples(statisticId: string): readonly RawStatisticSample[] {
    const meta = this.metaCache.get(statisticId);
    if (!meta) return [];
    return this.buffer.getRecent(meta.id);
  }
}
