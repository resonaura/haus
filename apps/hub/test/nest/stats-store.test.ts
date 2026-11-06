/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StatsStore } from '../../src/stats/stats.store.js';
import type { RawStatisticSample, StatisticRollup } from '@haus/core';

describe('StatsStore Integration Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let store: StatsStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-stats-nest-'));
    dbPath = join(tempDir, 'hub-stats.sqlite');
    store = new StatsStore(dbPath);
  });

  afterEach(async () => {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('registers and retrieves statistic metadata', () => {
    const meta = store.registerMetadata({
      statisticId: 'sensor.living_room_temperature',
      source: 'device',
      unit: '°C',
      kind: 'gauge',
      displayName: 'Living Room Temperature',
      hasMean: true,
      hasSum: false,
    });

    expect(meta.id).toBeDefined();
    expect(meta.statisticId).toBe('sensor.living_room_temperature');
    expect(meta.hasMean).toBe(true);

    const fetched = store.getMetadata('sensor.living_room_temperature');
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(meta.id);
    expect(fetched?.displayName).toBe('Living Room Temperature');

    const byId = store.getMetadataById(meta.id);
    expect(byId?.statisticId).toBe('sensor.living_room_temperature');

    // Update metadata
    store.registerMetadata({
      statisticId: 'sensor.living_room_temperature',
      source: 'device',
      unit: '°C',
      kind: 'gauge',
      displayName: 'Updated Name',
      hasMean: true,
      hasSum: false,
    });

    const updated = store.getMetadata('sensor.living_room_temperature');
    expect(updated?.displayName).toBe('Updated Name');
    expect(updated?.id).toBe(meta.id);
  });

  it('lists metadata with optional source filter', () => {
    store.registerMetadata({
      statisticId: 'sensor.temp',
      source: 'device',
      kind: 'gauge',
      hasMean: true,
      hasSum: false,
    });
    store.registerMetadata({
      statisticId: 'system.cpu',
      source: 'system',
      kind: 'gauge',
      hasMean: true,
      hasSum: false,
    });

    const all = store.listMetadata();
    expect(all.length).toBe(2);

    const devices = store.listMetadata('device');
    expect(devices.length).toBe(1);
    expect(devices[0].statisticId).toBe('sensor.temp');

    const system = store.listMetadata('system');
    expect(system.length).toBe(1);
    expect(system[0].statisticId).toBe('system.cpu');
  });

  it('inserts and queries raw samples in batch transactions', () => {
    const meta = store.registerMetadata({
      statisticId: 'sensor.power',
      source: 'device',
      unit: 'W',
      kind: 'gauge',
      hasMean: true,
      hasSum: false,
    });

    const samples: RawStatisticSample[] = [
      { metadataId: meta.id, timestamp: 1000, value: 42.5 },
      { metadataId: meta.id, timestamp: 1005, value: 43.0 },
      { metadataId: meta.id, timestamp: 1010, value: 44.2 },
      { metadataId: meta.id, timestamp: 1015, value: 41.8 },
    ];

    store.insertRawSamples(samples);

    const queried = store.queryRawSamples(meta.id, 1000, 1010);
    expect(queried.length).toBe(3);
    expect(queried[0].value).toBe(42.5);
    expect(queried[2].value).toBe(44.2);

    const limited = store.queryRawSamples(meta.id, 1000, 1020, 2);
    expect(limited.length).toBe(2);
  });

  it('inserts and queries 5m rollups', () => {
    const meta = store.registerMetadata({
      statisticId: 'sensor.energy',
      source: 'device',
      unit: 'kWh',
      kind: 'counter',
      hasMean: false,
      hasSum: true,
    });

    const rollups: StatisticRollup[] = [
      {
        metadataId: meta.id,
        startTs: 1700000000,
        min: 10.0,
        max: 12.0,
        mean: null,
        first: 10.0,
        last: 12.0,
        sum: 2.0,
        count: 10,
      },
      {
        metadataId: meta.id,
        startTs: 1700000300,
        min: 12.0,
        max: 15.0,
        mean: null,
        first: 12.0,
        last: 15.0,
        sum: 3.0,
        count: 12,
      },
    ];

    store.insert5mRollups(rollups);

    const queried = store.query5mRollups(meta.id, 1700000000, 1700000300);
    expect(queried.length).toBe(2);
    expect(queried[0].startTs).toBe(1700000000);
    expect(queried[0].sum).toBe(2.0);
    expect(queried[1].startTs).toBe(1700000300);
    expect(queried[1].sum).toBe(3.0);
  });

  it('inserts and queries 1h rollups', () => {
    const meta = store.registerMetadata({
      statisticId: 'sensor.humidity',
      source: 'device',
      unit: '%',
      kind: 'gauge',
      hasMean: true,
      hasSum: false,
    });

    const rollups: StatisticRollup[] = [
      {
        metadataId: meta.id,
        startTs: 1700000000,
        min: 40.0,
        max: 60.0,
        mean: 50.0,
        first: 42.0,
        last: 58.0,
        sum: null,
        count: 720,
      },
    ];

    store.insert1hRollups(rollups);

    const queried = store.query1hRollups(meta.id, 1700000000, 1700003600);
    expect(queried.length).toBe(1);
    expect(queried[0].mean).toBe(50.0);
    expect(queried[0].count).toBe(720);
  });

  it('purges old raw samples and short-term rollups correctly', () => {
    const meta = store.registerMetadata({
      statisticId: 'sensor.purge_test',
      source: 'device',
      kind: 'gauge',
      hasMean: true,
      hasSum: false,
    });

    const now = Math.floor(Date.now() / 1000);

    store.insertRawSamples([
      { metadataId: meta.id, timestamp: now - 1000, value: 1 },
      { metadataId: meta.id, timestamp: now - 500, value: 2 },
      { metadataId: meta.id, timestamp: now - 10, value: 3 },
    ]);

    // Purge older than 100 seconds (should delete samples at now - 1000 and now - 500)
    const purged = store.purgeOldRawSamples(100);
    expect(purged).toBe(2);

    const remaining = store.queryRawSamples(meta.id, 0, now + 100);
    expect(remaining.length).toBe(1);
    expect(remaining[0].value).toBe(3);
  });
});
