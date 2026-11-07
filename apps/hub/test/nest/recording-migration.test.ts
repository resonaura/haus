/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordingStore } from '../../src/events/recording.store.js';
import { EventArchiveEntity } from '../../src/events/recording.entities.js';
import { openTestRecordingStore } from './recording-test-store.js';

describe('Event recording TypeORM migration', () => {
  let tempDir: string | undefined;
  let store: RecordingStore | undefined;

  afterEach(async () => {
    await store?.close();
    store = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('adopts legacy events, settings, availability and archive rows in place', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-events-upgrade-'));
    const database = join(tempDir, 'hub-events.sqlite');
    const media = join(tempDir, 'media');
    const legacy = new DatabaseSync(database);
    legacy.exec(`
      CREATE TABLE settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE events (
        id TEXT PRIMARY KEY, camera_id TEXT NOT NULL, start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL, status TEXT NOT NULL, kinds TEXT NOT NULL,
        detections TEXT NOT NULL, duration REAL DEFAULT 0, bytes INTEGER DEFAULT 0, error TEXT
      );
      CREATE TABLE camera_availability (
        camera_id TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL,
        state TEXT NOT NULL, PRIMARY KEY(camera_id,start_at)
      );
      CREATE TABLE event_archive (
        event_id TEXT NOT NULL, variant TEXT NOT NULL, digest TEXT NOT NULL, bytes INTEGER NOT NULL,
        version INTEGER NOT NULL, PRIMARY KEY(event_id,variant)
      );
      CREATE TABLE event_archive_locations (
        event_id TEXT NOT NULL, variant TEXT NOT NULL, node_id TEXT NOT NULL,
        digest TEXT NOT NULL, bytes INTEGER NOT NULL, version INTEGER NOT NULL,
        verified_at INTEGER NOT NULL, PRIMARY KEY(event_id,variant,node_id)
      );
      CREATE TABLE event_archive_state (id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL);
      INSERT INTO event_archive_state VALUES (1,9);
      CREATE TABLE migrations (id TEXT PRIMARY KEY);
      INSERT INTO settings VALUES ('camera.garage','{"nightVision":true}');
      INSERT INTO events VALUES (
        'legacy-event','camera.garage',1000,2000,'ready','["motion"]',
        '[{"kind":"motion","at":1000}]',8,512,NULL
      );
      INSERT INTO camera_availability VALUES ('camera.garage',500,999,'online');
      INSERT INTO event_archive VALUES ('legacy-event','original','digest-value',512,1);
      INSERT INTO event_archive_locations VALUES ('legacy-event','original','node-a','digest-value',512,1,1500);
      PRAGMA user_version=2;
    `);
    legacy.close();

    store = await openTestRecordingStore(database, media);
    const event = await store.get('legacy-event');
    expect(event).toMatchObject({
      id: 'legacy-event',
      cameraId: 'camera.garage',
      duration: 8,
      bytes: 512,
      playbackVersion: 0,
      mediaRevision: 0,
      localOriginal: true,
    });
    expect((await store.availability({ cameraId: 'camera.garage', from: 0, to: 3000 }))[0]).toMatchObject({
      startAt: 500,
      endAt: 999,
      state: 'online',
    });
    expect(await store.archiveGeneration()).toBe(9);
    expect((await store.overrides())['camera.garage']).toEqual({ nightVision: true, enabled: true });
    expect(await store.source.manager.count(EventArchiveEntity)).toBe(1);

    const tables = await store.source.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ) as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toContain('haus_events_migrations');
    expect(tables.map(({ name }) => name)).toContain('event_archive_locations');
    expect(tables.some(({ name }) => name.includes('-'))).toBe(false);

    await store.close();
    store = await openTestRecordingStore(database, media);
    expect((await store.get('legacy-event'))?.bytes).toBe(512);
    expect(await store.archiveGeneration()).toBe(9);
  });
});
