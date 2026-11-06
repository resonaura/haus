/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { RawStatisticSample } from '@haus/core';
import type { StatsStore } from './stats.store.js';

export interface StatsBufferOptions {
  readonly flushIntervalMs?: number;
  readonly maxBufferSize?: number;
  readonly onFlush?: (count: number) => void;
}

/**
 * High-throughput in-memory telemetry buffer.
 * Batches incoming telemetry samples and writes them to SQLite in bulk transactions,
 * preventing per-sample disk I/O and event loop blocking.
 */
export class StatsBuffer {
  private buffer: RawStatisticSample[] = [];
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;
  private readonly onFlush?: (count: number) => void;
  private timer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  constructor(
    private readonly store: StatsStore,
    options: StatsBufferOptions = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? 2000;
    this.maxBufferSize = options.maxBufferSize ?? 10000;
    this.onFlush = options.onFlush;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
    // Unref timer so it does not hold the Node process open on exit
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  /**
   * Records a raw statistic sample into memory.
   * If the buffer reaches max capacity, automatically triggers a synchronous batch flush.
   */
  public record(sample: RawStatisticSample): void {
    this.buffer.push(sample);
    if (this.buffer.length >= this.maxBufferSize && !this.isFlushing) {
      this.flush();
    }
  }

  /**
   * Flushes all currently buffered samples to the SQLite database.
   * Uses double-buffering / array-swap so new samples can arrive uninterrupted.
   */
  public flush(): number {
    if (this.buffer.length === 0 || this.isFlushing) {
      return 0;
    }

    this.isFlushing = true;
    const batch = this.buffer;
    this.buffer = [];

    try {
      this.store.insertRawSamples(batch);
      this.onFlush?.(batch.length);
      return batch.length;
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Retrieves any buffered samples for a given metadataId that have not yet been flushed to disk.
   */
  public getRecent(metadataId: string): readonly RawStatisticSample[] {
    const results: RawStatisticSample[] = [];
    for (const sample of this.buffer) {
      if (sample.metadataId === metadataId) {
        results.push(sample);
      }
    }
    return results;
  }

  public get pendingCount(): number {
    return this.buffer.length;
  }
}
