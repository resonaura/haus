/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCatalog } from '../../src/storage/source.js';
import { scheduleDataSourceOperation, Transactions } from '../../src/storage/transactions.js';
import { MqttRetainedEntity } from '../../src/storage/mqtt/entities.js';
import { StandaloneHomeEntryEntity } from '../../src/storage/standalone/entities.js';
import {
  createPostgresPoolExtra,
  isPostgresUrl,
  resolveCatalogTarget,
  resolveStatsTarget,
  sqlParams,
} from '../../src/storage/dialect.js';
import { openStatsSource } from '../../src/stats/stats.source.js';
import { StatsStore } from '../../src/stats/stats.store.js';
import { HomeStatsTracker } from '../../src/home/home-stats.js';
import { RecordingStore } from '../../src/events/recording.store.js';
import { RetentionCatalog } from '../../src/storage/retention/catalog.js';
import { ActivityCatalog } from '../../src/storage/cameras/activity.js';
import { migrateSqliteToPostgres } from '../../src/cli/migrate-pg.js';

const PG_CATALOG_URL = process.env.HAUS_TEST_PG_CATALOG_URL?.trim();
const PG_STATS_URL = process.env.HAUS_TEST_PG_STATS_URL?.trim();

const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('Dual-dialect storage helpers & unbounded endpoint_history_events', () => {
  it('converts positional placeholders safely without mutating quoted literals', () => {
    expect(sqlParams(false, 'SELECT * FROM t WHERE a=? AND b=?')).toBe(
      'SELECT * FROM t WHERE a=? AND b=?',
    );
    expect(sqlParams(true, "SELECT * FROM t WHERE a=? AND note='what?' AND b=?")).toBe(
      "SELECT * FROM t WHERE a=$1 AND note='what?' AND b=$2",
    );
    expect(isPostgresUrl('postgresql://haus:secret@127.0.0.1:5432/haus')).toBe(true);
    expect(isPostgresUrl('/data/haus.sqlite')).toBe(false);
    expect(
      resolveCatalogTarget('/data/haus.sqlite', {
        HAUS_DATABASE_URL: 'postgres://u:p@127.0.0.1/h',
      }),
    ).toBe('postgres://u:p@127.0.0.1/h');
    expect(
      resolveStatsTarget('/data/hub-stats.sqlite', {
        HAUS_STATS_PG_URL: 'postgres://u:p@127.0.0.1/s',
      }),
    ).toBe('postgres://u:p@127.0.0.1/s');
    const statsExtra = createPostgresPoolExtra('stats');
    const catalogExtra = createPostgresPoolExtra('catalog');
    expect(statsExtra.options).toContain('synchronous_commit=off');
    expect(statsExtra.min).toBe(0);
    expect(statsExtra.connectionTimeoutMillis).toBe(20_000);
    expect(catalogExtra.options).not.toContain('synchronous_commit=off');
    expect(catalogExtra.min).toBe(0);
    expect(catalogExtra.connectionTimeoutMillis).toBe(20_000);
  });

  it('deduplicates duplicate conflict keys in a single batch (last-write-wins) and avoids PG unhandled rejections', async () => {
    const source = await openStatsSource(':memory:');
    const store = new StatsStore(source);
    try {
      const meta = await store.registerMetadata({
        statisticId: 'device.ep_dup.temp',
        source: 'device',
        unit: '°C',
        kind: 'gauge',
        displayName: 'Temp',
        hasMean: true,
        hasSum: false,
      });
      await store.persistIngestion(
        [
          { metadataId: meta.id, timestamp: 1700000100, value: 21.0 },
          { metadataId: meta.id, timestamp: 1700000100, value: 22.5 },
          { metadataId: meta.id, timestamp: 1700000099, value: 20.0 },
        ],
        [],
      );
      const samples = await store.queryRawSamples(meta.id, 1700000000, 1700000200);
      expect(samples).toEqual([
        { metadataId: meta.id, timestamp: 1700000099, value: 20.0 },
        { metadataId: meta.id, timestamp: 1700000100, value: 22.5 },
      ]);

      await store.insertEndpointHistory([
        { endpointId: 'ep_dup', tsMs: 5000, stateJson: JSON.stringify({ state: 'on', level: 1 }) },
        { endpointId: 'ep_dup', tsMs: 5000, stateJson: JSON.stringify({ state: 'on', level: 2 }) },
      ]);
      const hist = await store.queryEndpointHistory(['ep_dup'], 4000, 6000);
      expect(hist['ep_dup']).toEqual([{ tsMs: 5000, state: { state: 'on', level: 2 } }]);
    } finally {
      await store.close();
    }

    // Verify Postgres-branch scheduleDataSourceOperation does not fork an unhandledRejection.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const fakePgSource = {
        options: { type: 'postgres' },
        isInitialized: true,
      } as unknown as Parameters<typeof scheduleDataSourceOperation>[0];
      await expect(
        scheduleDataSourceOperation(fakePgSource, async () => {
          throw new Error('simulated_pg_failure');
        }),
      ).rejects.toThrow('simulated_pg_failure');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('persists >300 transitions across 60 days into endpoint_history_events and queries baseline + range', async () => {
    const source = await openStatsSource(':memory:');
    const store = new StatsStore(source);
    try {
      const tracker = new HomeStatsTracker({
        listDevices: () => [],
        persistence: {
          save: () => Promise.resolve(),
          remove: () => Promise.resolve(),
        },
        getCollector: () => undefined,
        getStatsStore: () => store,
      });

      const baseMs = Date.now() - 60 * 86_400_000;
      for (let i = 0; i < 320; i += 1) {
        tracker.recordUpdate(
          'ep_lamp',
          { state: i % 2 === 0 ? 'on' : 'off', brightness: i },
          { brightness: i },
          undefined,
          undefined,
          undefined,
          baseMs + i * 60_000,
        );
      }
      await tracker.flushEventHistory();

      // In-memory ring is capped at 256, but async query reads all 320 transitions from StatsStore!
      const memOnly = tracker.query(['ep_lamp'], baseMs, baseMs + 400 * 60_000);
      expect(memOnly['ep_lamp']!.length).toBeLessThanOrEqual(256);

      const full = await tracker.queryAsync(
        ['ep_lamp'],
        baseMs + 10 * 60_000,
        baseMs + 319 * 60_000,
      );
      // Includes 1 baseline (i=9) + 310 in-range entries (i=10..319) = 311!
      expect(full['ep_lamp']!.length).toBe(311);
      expect(full['ep_lamp']![0]!.state.brightness).toBe(9);
      expect(full['ep_lamp']!.at(-1)!.state.brightness).toBe(319);
    } finally {
      await store.close();
    }
  });
});

describe.skipIf(!PG_CATALOG_URL || !PG_STATS_URL)(
  'Real PostgreSQL integration (Catalog + Recording + Stats + SQLite->PG Migrator)',
  () => {
    it('runs full catalog, recordings, stats, portable snapshot, and SQLite->PG migration parity on PostgreSQL', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'haus-pg-test-'));
      cleanupDirs.push(dir);
      const sqliteCatalogPath = join(dir, 'haus.sqlite');
      const sqliteStatsPath = join(dir, 'hub-stats.sqlite');
      const snapshotOutPath = join(dir, 'portable-snapshot.sqlite');

      // 1. Populate source SQLite catalog & stats databases with realistic mixed types
      const sqCat = await openCatalog(sqliteCatalogPath);
      const sqTx = new Transactions(sqCat);
      const sqRec = new RecordingStore(sqCat, join(dir, 'media'), sqTx);
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      try {
        await sqTx.run(async (m) => {
          await m.upsert(
            StandaloneHomeEntryEntity,
            [
              {
                kind: 'room',
                entryId: 'room-pg',
                value: JSON.stringify({ id: 'room-pg', name: 'Office' }),
                updatedAt: nowMs,
              },
              {
                kind: 'endpoint_history',
                entryId: 'ep_pg_light',
                value: JSON.stringify([
                  { tsMs: nowMs - 10_000, state: { state: 'on', brightness: 100 } },
                  { tsMs: nowMs - 5_000, state: { state: 'off', brightness: 0 } },
                ]),
                updatedAt: nowMs,
              },
            ],
            ['kind', 'entryId'],
          );
          await m.upsert(
            MqttRetainedEntity,
            {
              topic: 'haus/test/binary',
              payload: Buffer.from([0, 1, 2, 255, 42]),
              qos: 1,
              revision: 7,
              discovery: null,
              discoveryRevision: null,
              discoveryClaims: '[]',
            },
            ['topic'],
          );
        });
        const ev = await sqRec.create('cam-1', 'person', nowMs - 5000, nowMs, 'sensor-1');
        await sqRec.finish(ev.id, { status: 'ready', duration: 5.25, bytes: 1_048_576 });
        await sqRec.setPlayback(ev.id, 524_288, 2, {
          originalCompatible: true,
          originalPolicyVersion: 3,
        });
      } finally {
        await sqRec.close();
        await sqCat.destroy();
      }

      const sqStatsSrc = await openStatsSource(sqliteStatsPath);
      const sqStats = new StatsStore(sqStatsSrc);
      try {
        const meta = await sqStats.registerMetadata({
          statisticId: 'device.ep_pg_light.power',
          source: 'device',
          unit: 'W',
          kind: 'gauge',
          displayName: 'Desk Lamp Power',
          hasMean: true,
          hasSum: false,
        });
        await sqStats.insertRawSamples([
          { metadataId: meta.id, timestamp: nowSec - 60, value: 11.5 },
          { metadataId: meta.id, timestamp: nowSec, value: 14.25 },
        ]);
      } finally {
        await sqStats.close();
      }

      // 2. Run zero-data-loss SQLite -> PostgreSQL migration with parity check!
      const report = await migrateSqliteToPostgres({
        catalogSqlitePath: sqliteCatalogPath,
        catalogPgUrl: PG_CATALOG_URL!,
        statsSqlitePath: sqliteStatsPath,
        statsPgUrl: PG_STATS_URL!,
        replaceTarget: true,
      });
      expect(report.expandedHistoryEvents).toBe(2);
      expect(report.catalog.find((t) => t.table === 'mqtt_retained')?.targetRows).toBe(1);
      expect(report.catalog.find((t) => t.table === 'events')?.targetRows).toBe(1);
      expect(report.stats.find((t) => t.table === 'stats_raw')?.targetRows).toBe(2);

      // 3. Open live PostgreSQL catalog + RecordingStore and test every PG-specific path!
      const pgCat = await openCatalog(PG_CATALOG_URL!);
      const pgTx = new Transactions(pgCat);
      const pgRec = new RecordingStore(pgCat, join(dir, 'pg-media'), pgTx);
      try {
        const [room, mqtt, listByKind, totals, localMedia] = await Promise.all([
          pgTx.read((m) =>
            m.findOneBy(StandaloneHomeEntryEntity, { kind: 'room', entryId: 'room-pg' }),
          ),
          pgTx.read((m) => m.findOneBy(MqttRetainedEntity, { topic: 'haus/test/binary' })),
          pgRec.list({ kind: 'person', status: 'ready' }),
          pgRec.totals(),
          pgRec.listLocalMedia('', 50),
        ]);
        expect(room?.updatedAt).toBe(nowMs);
        expect(Buffer.from(mqtt!.payload)).toEqual(Buffer.from([0, 1, 2, 255, 42]));
        expect(listByKind.events).toHaveLength(1);
        expect(totals.count).toBe(1);
        expect(totals.bytes).toBe(1_048_576 + 524_288);
        expect(localMedia).toHaveLength(1);

        // Archive cursor + JSONB playback_info candidate query on PostgreSQL
        const evId = listByKind.events[0]!.id;
        await pgRec.archive.saveDescriptor({
          eventId: evId,
          variant: 'prepared',
          digest: 'a'.repeat(64),
          bytes: 524_288,
          version: 2,
        });
        await pgRec.archive.saveLocation({
          eventId: evId,
          variant: 'prepared',
          nodeId: 'node-1',
          digest: 'a'.repeat(64),
          bytes: 524_288,
          version: 2,
          verifiedAt: nowMs,
        });
        const candidates = await pgRec.archive.pendingCandidates({
          nodeIds: ['node-1', 'node-2'],
          copies: 2,
          playbackVersion: 2,
          originalPolicyVersion: 3,
        });
        expect(candidates.map((c) => c.id)).toEqual([evId]);
        const metaPage = await pgRec.archive.metadataPage(0, 10);
        expect(metaPage).toHaveLength(1);
        expect(metaPage[0]!.cursor).toBeGreaterThan(0);

        // Verify RetentionCatalog & ActivityCatalog JSONB/boolean queries on PostgreSQL!
        const retention = new RetentionCatalog(pgTx);
        await retention.prunePreparations(2, 3);
        expect(await retention.pendingPreparations(2, 3, nowMs)).toEqual([]);
        expect((await retention.evictionCandidates()).map((c) => c.id)).toEqual([evId]);
        const activity = new ActivityCatalog(pgTx);
        await activity.initialize();
        await activity.savePolicy({
          policyId: 'pol-pg-1',
          cameraId: 'cam-1',
          nodeId: 'node-1',
          createdAt: nowMs,
          expiresAt: nowMs + 60_000,
          revokedAt: null,
        });
        await activity.retire('pol-pg-1', nowMs + 1000);

        // Export portable SQLite backup snapshot directly from PostgreSQL!
        await pgTx.snapshotDatabase(snapshotOutPath);
        const verifySnap = await openCatalog(snapshotOutPath);
        try {
          const snapRoom = await verifySnap.manager.findOneBy(StandaloneHomeEntryEntity, {
            kind: 'room',
            entryId: 'room-pg',
          });
          expect(snapRoom?.entryId).toBe('room-pg');
        } finally {
          await verifySnap.destroy();
        }
      } finally {
        await pgRec.close();
        await pgCat.destroy();
      }

      // 4. Open live PostgreSQL StatsStore and verify DISTINCT ON history + ctid purge + raw queries!
      const pgStatsSrc = await openStatsSource(PG_STATS_URL!);
      const pgStats = new StatsStore(pgStatsSrc);
      try {
        expect(pgStats.isPostgres).toBe(true);
        const meta = await pgStats.getMetadata('device.ep_pg_light.power');
        expect(meta).toBeTruthy();
        const raw = await pgStats.queryRawSamples(meta!.id, nowSec - 120, nowSec + 10);
        expect(raw).toHaveLength(2);
        expect(raw[0]!.metadataId).toBe(meta!.id);

        const hist = await pgStats.queryEndpointHistory(['ep_pg_light'], nowMs - 6_000, nowMs);
        expect(hist['ep_pg_light']).toHaveLength(2); // baseline (-10s) + in-range (-5s)
        expect(hist['ep_pg_light']![0]!.state.brightness).toBe(100);
        expect(hist['ep_pg_light']![1]!.state.brightness).toBe(0);

        const purged = await pgStats.purgeOldRawSamples(30, nowSec);
        expect(purged).toBe(1);
      } finally {
        await pgStats.close();
      }
    }, 30_000);
  },
);
