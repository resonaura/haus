/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { StatsStore } from '../../src/stats/stats.store.js';
import { openTestStatsStore } from './stats-test-store.js';

describe('Statistics TypeORM migration', () => {
  let tempDir: string | undefined;
  let store: StatsStore | undefined;

  afterEach(async () => {
    await store?.close();
    store = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('renames the legacy schema, preserves data, and reopens under snake_case names', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-stats-upgrade-'));
    const database = join(tempDir, 'hub-stats.sqlite');
    const legacy = new DatabaseSync(database);
    legacy.exec(`
      CREATE TABLE "stats-metadata" (
        "id" TEXT PRIMARY KEY,
        "statistic-id" TEXT NOT NULL UNIQUE,
        "source" TEXT NOT NULL,
        "unit" TEXT,
        "kind" TEXT NOT NULL,
        "display-name" TEXT,
        "has-mean" INTEGER NOT NULL,
        "has-sum" INTEGER NOT NULL,
        "created-at" INTEGER NOT NULL
      );
      CREATE TABLE "stats-raw" (
        "metadata-id" TEXT NOT NULL, "timestamp" INTEGER NOT NULL, "value" REAL NOT NULL,
        PRIMARY KEY ("metadata-id", "timestamp")
      );
      CREATE TABLE "stats-5m" (
        "metadata-id" TEXT NOT NULL, "start-ts" INTEGER NOT NULL, "min" REAL NOT NULL,
        "max" REAL NOT NULL, "mean" REAL, "first" REAL NOT NULL, "last" REAL NOT NULL,
        "sum" REAL, "count" INTEGER NOT NULL, PRIMARY KEY ("metadata-id", "start-ts")
      );
      CREATE TABLE "stats-1h" (
        "metadata-id" TEXT NOT NULL, "start-ts" INTEGER NOT NULL, "min" REAL NOT NULL,
        "max" REAL NOT NULL, "mean" REAL, "first" REAL NOT NULL, "last" REAL NOT NULL,
        "sum" REAL, "count" INTEGER NOT NULL, PRIMARY KEY ("metadata-id", "start-ts")
      );
      INSERT INTO "stats-metadata" VALUES ('legacy-id', 'sensor.temperature', 'device', '°C', 'gauge', 'Temperature', 1, 0, 42);
      INSERT INTO "stats-raw" VALUES ('legacy-id', 120, 21.5);
      INSERT INTO "stats-5m" VALUES ('legacy-id', 0, 20, 23, 21.5, 20, 23, NULL, 2);
      INSERT INTO "stats-1h" VALUES ('legacy-id', 0, 19, 24, 21.5, 19, 24, NULL, 8);
    `);
    legacy.close();

    store = await openTestStatsStore(database);
    const metadata = await store.getMetadata('sensor.temperature');
    expect(metadata).toMatchObject({
      id: 'legacy-id',
      displayName: 'Temperature',
      createdAt: 42,
    });
    expect(await store.queryRawSamples('legacy-id', 0, 200)).toEqual([
      { metadataId: 'legacy-id', timestamp: 120, value: 21.5 },
    ]);
    expect(await store.query5mRollups('legacy-id', 0, 300)).toMatchObject([
      { startTs: 0, min: 20, max: 23, mean: 21.5, count: 2 },
    ]);
    expect(await store.query1hRollups('legacy-id', 0, 3600)).toMatchObject([
      { startTs: 0, min: 19, max: 24, mean: 21.5, count: 8 },
    ]);

    const tables = await store.source.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'stats%' OR name LIKE 'haus_stats%') ORDER BY name",
    ) as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).toEqual([
      'haus_stats_migrations',
      'stats_1h',
      'stats_5m',
      'stats_metadata',
      'stats_raw',
    ]);

    await store.close();
    store = await openTestStatsStore(database);
    expect((await store.getMetadata('sensor.temperature'))?.id).toBe('legacy-id');
    expect((await store.queryRawSamples('legacy-id', 0, 200)).length).toBe(1);
  });
});
