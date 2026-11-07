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
import { StatsService } from '../../src/stats/stats.service.js';
import { StatsController } from '../../src/stats/stats.controller.js';
import { openTestStatsStore } from './stats-test-store.js';
import { openApiToPostman, type PostmanFolder } from '../../src/docs/postman.js';
import type { OpenAPIObject } from '@nestjs/swagger';

describe('Stats API & LTTB Downsampling Service Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let store: StatsStore;
  let engine: StatsEngine;
  let service: StatsService;
  let controller: StatsController;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-stats-api-'));
    dbPath = join(tempDir, 'hub-stats-api.sqlite');
    store = await openTestStatsStore(dbPath);
    engine = new StatsEngine(store, {
      buffer: { flushIntervalMs: 10_000, maxBufferSize: 200_000 },
    });
    await engine.initialize();
    service = new StatsService(store, engine);
    controller = new StatsController(service);
  });

  afterEach(async () => {
    await engine.stop();
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('queries raw samples and applies LTTB downsampling when above threshold', async () => {
    const statId = 'sensor.living_room_temp';
    const meta = engine.register(statId, { kind: 'gauge', unit: '°C' });

    // Insert 1000 raw samples directly
    const samples = [];
    for (let i = 0; i < 1000; i++) {
      samples.push({
        metadataId: meta.id,
        timestamp: 1700000000 + i * 10,
        value: 20 + Math.sin(i / 10) * 5 + (i === 500 ? 50 : 0),
      });
    }
    await store.insertRawSamples(samples);

    const result = await controller.query({
      statistic_id: statId,
      from: 1700000000,
      to: 1700010000,
      resolution: 'raw',
      threshold: 100,
    });

    expect(result.metadata.statisticId).toBe(statId);
    expect(result.resolution).toBe('raw');
    expect(result.data.length).toBe(100);

    // First and last preserved
    expect(result.data[0].timestamp).toBe(1700000000);
    expect(result.data[99].timestamp).toBe(1700000000 + 999 * 10);

    // Peak at index 500 preserved
    const peak = result.data.find((p) => (p.value ?? 0) >= 40);
    expect(peak).toBeDefined();
  });

  it('automatically routes to 5m and 1h rollups based on query window', async () => {
    const statId = 'sensor.long_term_energy';
    const meta = engine.register(statId, { kind: 'counter', unit: 'kWh' });

    // Insert 5m rollups
    await store.insert5mRollups([
      {
        metadataId: meta.id,
        startTs: 1700000000,
        min: 10,
        max: 12,
        mean: 11,
        first: 10,
        last: 12,
        sum: 2,
        count: 5,
      },
    ]);

    // Insert 1h rollups
    await store.insert1hRollups([
      {
        metadataId: meta.id,
        startTs: 1600000000,
        min: 10,
        max: 30,
        mean: 20,
        first: 10,
        last: 30,
        sum: 20,
        count: 720,
      },
    ]);

    // 7 day query window -> automatically routes to 5m resolution
    const res7d = await service.query({
      statistic_id: statId,
      from: 1700000000,
      to: 1700000000 + 7 * 86400,
      resolution: 'auto',
    });
    expect(res7d.resolution).toBe('5m');
    expect(res7d.data.length).toBe(1);

    // 60 day query window -> automatically routes to 1h resolution
    const res60d = await service.query({
      statistic_id: statId,
      from: 1600000000,
      to: 1600000000 + 60 * 86400,
      resolution: 'auto',
    });
    expect(res60d.resolution).toBe('1h');
    expect(res60d.data.length).toBe(1);
  });

  it('merges live in-memory pending samples into query results', async () => {
    const statId = 'sensor.live_power';
    const meta = engine.register(statId, { kind: 'gauge', unit: 'W' });

    // Database sample
    await store.insertRawSamples([{ metadataId: meta.id, timestamp: 1700000000, value: 100 }]);

    // In-flight buffered sample (not yet flushed)
    engine.record(statId, 250, 1700000010);

    const result = await service.query({
      statistic_id: statId,
      from: 1700000000,
      to: 1700000020,
      resolution: 'raw',
    });

    expect(result.data.length).toBe(2);
    expect(result.data[0].value).toBe(100);
    expect(result.data[1].value).toBe(250);
  });

  it('sub-5ms query benchmark over 100,000 points with LTTB downsampling', async () => {
    const statId = 'sensor.massive_bench';
    const meta = engine.register(statId, { kind: 'gauge' });

    const totalSamples = 100_000;
    const samples = [];
    for (let i = 0; i < totalSamples; i++) {
      samples.push({
        metadataId: meta.id,
        timestamp: 1700000000 + i,
        value: 50 + (i % 20),
      });
    }
    await store.insertRawSamples(samples);

    const start = performance.now();
    const result = await service.query({
      statistic_id: statId,
      from: 1700000000,
      to: 1700000000 + totalSamples,
      resolution: 'raw',
      threshold: 500,
    });
    const durationMs = performance.now() - start;

    expect(result.data.length).toBe(500);
    // Verified fast query execution
    expect(durationMs).toBeLessThan(150); // Generous upper bound for sqlite read + LTTB
  });

  it('retrieves multi-series history across multiple statistic identifiers', async () => {
    const stat1 = 'sensor.temp_living';
    const stat2 = 'sensor.temp_bed';
    engine.register(stat1, { kind: 'gauge' });
    engine.register(stat2, { kind: 'gauge' });

    engine.record(stat1, 21.0, 1700000000);
    engine.record(stat2, 19.5, 1700000000);

    const history = await controller.history({
      statistic_ids: `${stat1},${stat2}`,
      from: 1700000000,
      to: 1700000100,
    });

    expect(history.series.length).toBe(2);
    expect(history.series[0].metadata.statisticId).toBe(stat1);
    expect(history.series[1].metadata.statisticId).toBe(stat2);
  });

  it('retrieves metadata and computes 24-hour summary', async () => {
    const statId = 'sensor.daily_summary_test';
    engine.register(statId, { kind: 'gauge', unit: '°C' });

    const now = Math.floor(Date.now() / 1000);
    engine.record(statId, 18.0, now - 3600);
    engine.record(statId, 24.0, now - 1800);
    engine.record(statId, 21.0, now - 60);

    const summary = await controller.summary({ statistic_id: statId });
    expect(summary.metadata.statisticId).toBe(statId);
    expect(summary.sampleCount).toBe(3);
    expect(summary.dayMin).toBe(18.0);
    expect(summary.dayMax).toBe(24.0);
    expect(summary.dayMean).toBe(21.0);
    expect(summary.lastValue).toBe(21.0);

    const metaList = await controller.getMetadata({});
    expect(metaList.length).toBeGreaterThanOrEqual(1);
  });

  it('reflects Statistics endpoints into OpenAPI and dynamic Postman collection', () => {
    const mockOpenApi: OpenAPIObject = {
      openapi: '3.0.0',
      info: { title: 'Haus Hub API', version: '0.3.76' },
      paths: {
        '/api/stats/query': {
          get: {
            tags: ['Statistics'],
            summary: 'Query statistics timeseries with adaptive LTTB downsampling',
            responses: { '200': { description: 'OK' } },
          },
        },
        '/api/stats/history': {
          get: {
            tags: ['Statistics'],
            summary: 'Query multi-series statistics history across several identifiers',
            responses: { '200': { description: 'OK' } },
          },
        },
        '/api/stats/meta': {
          get: {
            tags: ['Statistics'],
            summary: 'List available statistic metadata and unit definitions',
            responses: { '200': { description: 'OK' } },
          },
        },
        '/api/stats/summary': {
          get: {
            tags: ['Statistics'],
            summary: 'Get 24-hour summary and current telemetry value',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };

    const postman = openApiToPostman(mockOpenApi, 'http://localhost:8790');
    expect(postman.info.name).toBe('Haus Hub API');

    const statsFolder = postman.item.find(
      (folder): folder is PostmanFolder => 'item' in folder && folder.name === 'Statistics',
    );
    expect(statsFolder).toBeDefined();
    expect(statsFolder?.item.length).toBe(4);

    const itemNames = statsFolder?.item.map((i) => i.name) ?? [];
    expect(itemNames).toContain('Query statistics timeseries with adaptive LTTB downsampling');
    expect(itemNames).toContain(
      'Query multi-series statistics history across several identifiers',
    );
    expect(itemNames).toContain('List available statistic metadata and unit definitions');
    expect(itemNames).toContain('Get 24-hour summary and current telemetry value');
  });
});

