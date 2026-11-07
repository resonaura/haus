/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { StatsStore } from '../../src/stats/stats.store.js';
import { StatsEngine } from '../../src/stats/stats.engine.js';
import { openTestStatsStore } from './stats-test-store.js';
import { FIVE_MINUTES_SECONDS, ONE_HOUR_SECONDS } from '@haus/core';

describe('StatsEngine & Rollup Ingestion Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let store: StatsStore;
  let engine: StatsEngine;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-stats-engine-'));
    dbPath = join(tempDir, 'hub-stats-engine.sqlite');
    store = await openTestStatsStore(dbPath);
    engine = new StatsEngine(store, {
      buffer: { flushIntervalMs: 5000, maxBufferSize: 20000 },
      worker: {
        rawRetentionSeconds: 48 * 3600,
        fiveMinRetentionSeconds: 90 * 86400,
      },
    });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.stop();
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('exceeds 50,000 samples/second non-blocking ingestion throughput', () => {
    const benchEngine = new StatsEngine(store, {
      buffer: { flushIntervalMs: 60000, maxBufferSize: 200_000 },
    });
    const statId = 'sensor.bench_metric';
    benchEngine.register(statId, { kind: 'gauge', unit: 'W' });

    const totalSamples = 100_000;
    const startTime = performance.now();

    for (let i = 0; i < totalSamples; i++) {
      benchEngine.record(statId, 20 + (i % 50), 1700000000 + i);
    }

    const durationMs = performance.now() - startTime;
    const samplesPerSec = (totalSamples / durationMs) * 1000;

    // Must exceed the 50,000 samples/second benchmark
    expect(samplesPerSec).toBeGreaterThan(50_000);

    // Verify samples are safely in buffer before flush
    expect(benchEngine.pendingBufferCount).toBe(totalSamples);
  });

  it('flushes buffered samples to SQLite in bulk transactions', async () => {
    const statId = 'sensor.living_room_temp';
    const meta = engine.register(statId, { kind: 'gauge', unit: '°C' });

    engine.record(statId, 21.5, 1700000100);
    engine.record(statId, 22.0, 1700000200);
    engine.record(statId, 22.5, 1700000250);

    expect(engine.pendingBufferCount).toBe(3);

    const flushed = await engine.flush();
    expect(flushed).toBe(3);
    expect(engine.pendingBufferCount).toBe(0);

    const saved = await store.queryRawSamples(meta.id, 1700000000, 1700000300);
    expect(saved.length).toBe(3);
    expect(saved[0].value).toBe(21.5);
    expect(saved[2].value).toBe(22.5);
  });

  it('provides live access to in-memory buffered samples prior to flush', () => {
    const statId = 'sensor.instant_power';
    engine.register(statId, { kind: 'gauge' });

    engine.record(statId, 150.0, 1700000010);
    engine.record(statId, 155.0, 1700000020);

    const live = engine.getBufferedSamples(statId);
    expect(live.length).toBe(2);
    expect(live[0].value).toBe(150.0);
    expect(live[1].value).toBe(155.0);
  });

  it('calculates incremental 5-minute and 1-hour rollups accurately', async () => {
    const statId = 'sensor.outdoor_temperature';
    const meta = engine.register(statId, { kind: 'gauge', unit: '°C' });

    // Base timestamp aligned to 1-hour boundary
    const baseHour = 1700000000 - (1700000000 % ONE_HOUR_SECONDS);
    const bucket0 = baseHour; // 5m bucket 0
    const bucket1 = baseHour + FIVE_MINUTES_SECONDS; // 5m bucket 1

    // Samples for 5m bucket 0 (e.g. 10.0, 20.0, 30.0 -> mean 20.0, min 10.0, max 30.0)
    engine.record(statId, 10.0, bucket0 + 10);
    engine.record(statId, 20.0, bucket0 + 60);
    engine.record(statId, 30.0, bucket0 + 120);

    // Samples for 5m bucket 1 (e.g. 40.0, 50.0 -> mean 45.0, min 40.0, max 50.0)
    engine.record(statId, 40.0, bucket1 + 10);
    engine.record(statId, 50.0, bucket1 + 60);

    await engine.flush();

    // Trigger rollups when current time is 2 hours later (both buckets closed)
    const futureTime = baseHour + ONE_HOUR_SECONDS + 300;
    const rollupResult = await engine.processRollups(futureTime);

    expect(rollupResult.fiveMinuteRollups).toBeGreaterThanOrEqual(2);

    // Query 5m rollups
    const rollups5m = await store.query5mRollups(meta.id, baseHour, baseHour + ONE_HOUR_SECONDS);
    expect(rollups5m.length).toBe(2);

    expect(rollups5m[0].startTs).toBe(bucket0);
    expect(rollups5m[0].min).toBe(10.0);
    expect(rollups5m[0].max).toBe(30.0);
    expect(rollups5m[0].mean).toBe(20.0);
    expect(rollups5m[0].count).toBe(3);

    expect(rollups5m[1].startTs).toBe(bucket1);
    expect(rollups5m[1].min).toBe(40.0);
    expect(rollups5m[1].max).toBe(50.0);
    expect(rollups5m[1].mean).toBe(45.0);
    expect(rollups5m[1].count).toBe(2);

    // Verify 1h rollup was created combining the 5m rollups
    const rollups1h = await store.query1hRollups(meta.id, baseHour, baseHour);
    expect(rollups1h.length).toBe(1);
    expect(rollups1h[0].startTs).toBe(baseHour);
    expect(rollups1h[0].min).toBe(10.0);
    expect(rollups1h[0].max).toBe(50.0);
    // Weighted mean: (20.0 * 3 + 45.0 * 2) / 5 = (60 + 90) / 5 = 30.0
    expect(rollups1h[0].mean).toBe(30.0);
    expect(rollups1h[0].count).toBe(5);
  });

  it('executes automated retention eviction on aged raw samples and short-term rollups', async () => {
    const statId = 'sensor.eviction_test';
    const meta = engine.register(statId, { kind: 'gauge' });

    const now = 1700000000;
    const retention48h = 48 * 3600;

    // Insert an old sample (older than 48h) and a recent sample
    await store.insertRawSamples([
      { metadataId: meta.id, timestamp: now - retention48h - 100, value: 5 },
      { metadataId: meta.id, timestamp: now - 300, value: 10 },
    ]);

    const evictionResult = await engine.processEviction(now);
    expect(evictionResult.rawPurged).toBe(1);

    const remaining = await store.queryRawSamples(meta.id, 0, now + 1000);
    expect(remaining.length).toBe(1);
    expect(remaining[0].value).toBe(10);
  });
});
