/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { RawStatisticSample } from '@haus/core';

export interface StatsBufferOptions {
  readonly flushIntervalMs?: number;
  readonly maxBufferSize?: number;
  readonly onFlush?: (count: number) => void;
}

/** In-memory double buffer. Persistence stays in StatsEngine so metadata and samples commit together. */
export class StatsBuffer {
  private samples: RawStatisticSample[] = [];

  public record(sample: RawStatisticSample): void {
    this.samples.push(sample);
  }

  public take(): RawStatisticSample[] {
    const batch = this.samples;
    this.samples = [];
    return batch;
  }

  public restore(batch: readonly RawStatisticSample[]): void {
    if (batch.length > 0) this.samples = [...batch, ...this.samples];
  }

  public getRecent(metadataId: string): readonly RawStatisticSample[] {
    return this.samples.filter((sample) => sample.metadataId === metadataId);
  }

  public get pendingCount(): number {
    return this.samples.length;
  }
}
