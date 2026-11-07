/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  downsampleLTTB,
  type StatisticMetadata,
  type StatisticResolution,
  type StatsDataPoint,
  type StatsSeriesResult,
  type StatisticSource,
} from '@haus/core';
import type { StatsStore } from './stats.store.js';
import type { StatsEngine } from './stats.engine.js';
import type { QueryStatsDto, HistoryStatsDto, MetaStatsQueryDto } from './stats.dto.js';

export interface StatsSummaryResult {
  readonly metadata: StatisticMetadata;
  readonly lastValue: number | null;
  readonly lastTimestamp: number | null;
  readonly dayMin: number | null;
  readonly dayMax: number | null;
  readonly dayMean: number | null;
  readonly daySum: number | null;
  readonly sampleCount: number;
}

export interface StatsHistoryResult {
  readonly series: readonly StatsSeriesResult[];
}

@Injectable()
export class StatsService {
  constructor(
    private readonly store: StatsStore,
    private readonly engine: StatsEngine,
  ) {}

  public async query(dto: QueryStatsDto): Promise<StatsSeriesResult> {
    const meta =
      this.engine.getMetadata(dto.statistic_id) ?? (await this.store.getMetadata(dto.statistic_id));
    if (!meta) {
      throw new NotFoundException(`statistic_not_found: ${dto.statistic_id}`);
    }

    const range = dto.to - dto.from;
    let effectiveRes: StatisticResolution = 'raw';

    if (dto.resolution && dto.resolution !== 'auto') {
      effectiveRes = dto.resolution;
    } else if (range <= 24 * 3600) {
      effectiveRes = 'raw';
    } else if (range <= 30 * 86400) {
      effectiveRes = '5m';
    } else {
      effectiveRes = '1h';
    }

    let points: StatsDataPoint[] = [];

    if (effectiveRes === 'raw') {
      const dbSamples = await this.store.queryRawSamples(meta.id, dto.from, dto.to, 50_000);
      const memSamples = this.engine
        .getBufferedSamples(dto.statistic_id)
        .filter((s) => s.timestamp >= dto.from && s.timestamp <= dto.to);

      // Merge and sort
      const merged = [...dbSamples, ...memSamples].sort((a, b) => a.timestamp - b.timestamp);
      points = merged.map((s) => ({
        timestamp: s.timestamp,
        value: s.value,
      }));
    } else if (effectiveRes === '5m') {
      const rollups = await this.store.query5mRollups(meta.id, dto.from, dto.to);
      points = rollups.map((r) => ({
        timestamp: r.startTs,
        value: r.mean ?? r.last,
        min: r.min,
        max: r.max,
      }));
    } else {
      const rollups = await this.store.query1hRollups(meta.id, dto.from, dto.to);
      points = rollups.map((r) => ({
        timestamp: r.startTs,
        value: r.mean ?? r.last,
        min: r.min,
        max: r.max,
      }));
    }

    const threshold = dto.threshold ?? 500;
    const downsampled = downsampleLTTB(points, threshold);

    return {
      metadata: meta,
      resolution: effectiveRes,
      data: downsampled,
    };
  }

  public async history(dto: HistoryStatsDto): Promise<StatsHistoryResult> {
    const ids = dto.statistic_ids
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const series: StatsSeriesResult[] = [];
    for (const id of ids) {
      try {
        const res = await this.query({
          statistic_id: id,
          from: dto.from,
          to: dto.to,
          threshold: dto.threshold,
        });
        series.push(res);
      } catch {
        // Skip unknown statistics in multi-series queries
      }
    }

    return { series };
  }

  public async getMetadata(dto: MetaStatsQueryDto): Promise<readonly StatisticMetadata[]> {
    if (dto.statistic_id) {
      const meta =
        this.engine.getMetadata(dto.statistic_id) ??
        (await this.store.getMetadata(dto.statistic_id));
      return meta ? [meta] : [];
    }
    return this.engine.listMetadata(dto.source as StatisticSource | undefined);
  }

  public async summary(statisticId: string): Promise<StatsSummaryResult> {
    const meta =
      this.engine.getMetadata(statisticId) ?? (await this.store.getMetadata(statisticId));
    if (!meta) {
      throw new NotFoundException(`statistic_not_found: ${statisticId}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const dayAgo = now - 86400;

    // Check raw samples first for freshest 24h data
    const raw = await this.store.queryRawSamples(meta.id, dayAgo, now, 10_000);
    const inMem = this.engine.getBufferedSamples(statisticId);
    const all24h = [...raw, ...inMem].sort((a, b) => a.timestamp - b.timestamp);

    if (all24h.length === 0) {
      return {
        metadata: meta,
        lastValue: null,
        lastTimestamp: null,
        dayMin: null,
        dayMax: null,
        dayMean: null,
        daySum: null,
        sampleCount: 0,
      };
    }

    let min = all24h[0].value;
    let max = all24h[0].value;
    let sum = 0;

    for (const s of all24h) {
      if (s.value < min) min = s.value;
      if (s.value > max) max = s.value;
      sum += s.value;
    }

    const last = all24h[all24h.length - 1];
    const mean = Math.round((sum / all24h.length) * 1000) / 1000;
    const netSum = meta.kind === 'counter' ? last.value - all24h[0].value : null;

    return {
      metadata: meta,
      lastValue: last.value,
      lastTimestamp: last.timestamp,
      dayMin: min,
      dayMax: max,
      dayMean: meta.kind === 'counter' ? null : mean,
      daySum: meta.kind === 'counter' ? netSum : null,
      sampleCount: all24h.length,
    };
  }
}
