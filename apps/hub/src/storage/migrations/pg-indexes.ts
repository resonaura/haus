/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';
import { isPostgresSource } from '../dialect.js';

async function hasTableAndColumns(
  runner: QueryRunner,
  tableName: string,
  columns: readonly string[],
): Promise<boolean> {
  const table = await runner.getTable(tableName);
  if (!table) return false;
  return columns.every((col) => table.columns.some((existing) => existing.name === col));
}

/** Adds composite indexes for fast catalog reads, cluster sync, auth sessions, and NVR queries. */
export class StorageIndexes1794690000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const pg = isPostgresSource(runner);
    if (await hasTableAndColumns(runner, 'standalone_home_entries', ['kind', 'updated_at'])) {
      await runner.query(
        'CREATE INDEX IF NOT EXISTS idx_standalone_home_kind_updated ON standalone_home_entries (kind, updated_at DESC)',
      );
    }
    if (await hasTableAndColumns(runner, 'events', ['status', 'start_at', 'id'])) {
      await runner.query(
        'CREATE INDEX IF NOT EXISTS idx_events_status_time ON events (status, start_at, id)',
      );
    }
    if (
      await hasTableAndColumns(runner, 'event_archive_locations', [
        'event_id',
        'variant',
        'version',
        'node_id',
      ])
    ) {
      await runner.query(
        'CREATE INDEX IF NOT EXISTS idx_event_archive_locations_lookup ON event_archive_locations (event_id, variant, version, node_id)',
      );
    }
    if (await hasTableAndColumns(runner, 'client_sessions', ['token_hash'])) {
      await runner.query(
        'CREATE INDEX IF NOT EXISTS idx_client_sessions_token_hash ON client_sessions (token_hash)',
      );
    }
    if (pg && (await hasTableAndColumns(runner, 'event_archive_locations', ['archive_cursor']))) {
      await runner.query(
        'CREATE INDEX IF NOT EXISTS idx_event_archive_locations_cursor ON event_archive_locations (archive_cursor)',
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX IF EXISTS idx_event_archive_locations_cursor');
    await runner.query('DROP INDEX IF EXISTS idx_client_sessions_token_hash');
    await runner.query('DROP INDEX IF EXISTS idx_event_archive_locations_lookup');
    await runner.query('DROP INDEX IF EXISTS idx_events_status_time');
    await runner.query('DROP INDEX IF EXISTS idx_standalone_home_kind_updated');
  }
}
