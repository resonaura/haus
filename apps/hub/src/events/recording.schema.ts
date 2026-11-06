/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { DatabaseSync } from 'node:sqlite';

export function initRecordingSchema(
  db: DatabaseSync,
  overrides: () => Record<string, unknown>,
  setCamera: (id: string, val: Record<string, unknown>) => void,
): void {
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, camera_id TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL, status TEXT NOT NULL, kinds TEXT NOT NULL, detections TEXT NOT NULL, duration REAL DEFAULT 0, bytes INTEGER DEFAULT 0, error TEXT);
  CREATE INDEX IF NOT EXISTS events_camera_time ON events(camera_id,start_at DESC,id DESC);
  CREATE INDEX IF NOT EXISTS events_camera_status_time ON events(camera_id,status,start_at DESC,id DESC);
  CREATE TABLE IF NOT EXISTS camera_availability (camera_id TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY(camera_id,start_at));
  CREATE INDEX IF NOT EXISTS camera_availability_time ON camera_availability(camera_id,end_at);
  PRAGMA user_version=2;`);

  const columns = (db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>).map(
    (row) => row.name,
  );

  if (!columns.includes('playback_version'))
    db.exec('ALTER TABLE events ADD COLUMN playback_version INTEGER DEFAULT 0');
  if (!columns.includes('playback_bytes'))
    db.exec('ALTER TABLE events ADD COLUMN playback_bytes INTEGER DEFAULT 0');
  if (!columns.includes('playback_info'))
    db.exec('ALTER TABLE events ADD COLUMN playback_info TEXT');
  if (!columns.includes('media_start_at'))
    db.exec('ALTER TABLE events ADD COLUMN media_start_at INTEGER');
  if (!columns.includes('media_revision'))
    db.exec('ALTER TABLE events ADD COLUMN media_revision INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('local_original'))
    db.exec('ALTER TABLE events ADD COLUMN local_original INTEGER NOT NULL DEFAULT 1');
  if (!columns.includes('local_playback'))
    db.exec('ALTER TABLE events ADD COLUMN local_playback INTEGER NOT NULL DEFAULT 1');

  db.exec(`CREATE TABLE IF NOT EXISTS event_archive(event_id TEXT NOT NULL,variant TEXT NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(event_id,variant));
    CREATE TABLE IF NOT EXISTS event_archive_locations(event_id TEXT NOT NULL,variant TEXT NOT NULL,node_id TEXT NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL,version INTEGER NOT NULL,verified_at INTEGER NOT NULL,PRIMARY KEY(event_id,variant,node_id));
    CREATE TABLE IF NOT EXISTS event_archive_state(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL);
    INSERT OR IGNORE INTO event_archive_state VALUES(1,0);
    PRAGMA user_version=6;`);
  db.exec('CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY)');

  const hasMigration = db
    .prepare('SELECT id FROM migrations WHERE id=?')
    .get('explicit-recording-policy');
  if (!hasMigration) {
    const known = db
      .prepare(
        'SELECT DISTINCT camera_id FROM camera_availability UNION SELECT DISTINCT camera_id FROM events',
      )
      .all() as Array<{ camera_id: string }>;
    const previousSettings = overrides();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const { camera_id: id } of known) {
        const previous = (previousSettings[id] as Record<string, unknown> | undefined) ?? {};
        if (previous.enabled === undefined) {
          setCamera(id, { ...previous, enabled: true });
        }
      }
      db.prepare('INSERT INTO migrations(id) VALUES(?)').run('explicit-recording-policy');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
