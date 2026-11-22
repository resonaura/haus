/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Table, TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  boolCol,
  boolDefault,
  floatCol,
  int64Col,
  isPostgresSource,
  sqlParams,
} from '../storage/dialect.js';

function getEventColumns(isPg: boolean) {
  const int64 = int64Col(isPg);
  const bool = boolCol(isPg);
  const defTrue = boolDefault(isPg, true);
  return [
    { name: 'media_start_at', type: int64, isNullable: true },
    { name: 'playback_version', type: 'integer', default: 0 },
    { name: 'playback_bytes', type: int64, default: 0 },
    { name: 'playback_info', type: 'text', isNullable: true },
    { name: 'media_revision', type: 'integer', default: 0 },
    { name: 'local_original', type: bool, default: defTrue },
    { name: 'local_playback', type: bool, default: defTrue },
  ];
}

const eventIndexes = [
  new TableIndex({ name: 'events_camera_time', columnNames: ['camera_id', 'start_at', 'id'] }),
  new TableIndex({
    name: 'events_camera_status_time',
    columnNames: ['camera_id', 'status', 'start_at', 'id'],
  }),
];

/** Adopts the existing recorder SQLite schema without replacing events or archive rows. */
export class Recording1793953000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const pg = isPostgresSource(runner);
    await this.createBaseTables(runner, pg);
    await this.addEventColumns(runner, pg);
    await this.ensureIndexes(runner, pg);
    await runner.query(
      'INSERT INTO event_archive_state (id,generation) VALUES (1,0) ON CONFLICT (id) DO NOTHING',
    );
    await this.migrateRecordingPolicy(runner, pg);
    if (!pg) {
      const versions: unknown = await runner.query('PRAGMA user_version');
      const version = Array.isArray(versions) ? Number(versions[0]?.user_version ?? 0) : 0;
      if (version < 6) await runner.query('PRAGMA user_version=6');
    }
  }

  async down(): Promise<void> {
    throw Error('recording_schema_rollback_requires_explicit_data_migration');
  }

  private async createBaseTables(runner: QueryRunner, pg: boolean): Promise<void> {
    const int64 = int64Col(pg);
    const flt = floatCol(pg);
    const tables = [
      new Table({
        name: 'settings',
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'value', type: 'text' },
        ],
      }),
      new Table({
        name: 'events',
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'camera_id', type: 'text' },
          { name: 'start_at', type: int64 },
          { name: 'end_at', type: int64 },
          { name: 'status', type: 'text' },
          { name: 'kinds', type: 'text' },
          { name: 'detections', type: 'text' },
          { name: 'duration', type: flt, default: 0 },
          { name: 'bytes', type: int64, default: 0 },
          { name: 'error', type: 'text', isNullable: true },
        ],
      }),
      new Table({
        name: 'camera_availability',
        columns: [
          { name: 'camera_id', type: 'text', isPrimary: true },
          { name: 'start_at', type: int64, isPrimary: true },
          { name: 'end_at', type: int64 },
          { name: 'state', type: 'text' },
        ],
      }),
      new Table({
        name: 'event_archive',
        columns: [
          { name: 'event_id', type: 'text', isPrimary: true },
          { name: 'variant', type: 'text', isPrimary: true },
          { name: 'digest', type: 'text' },
          { name: 'bytes', type: int64 },
          { name: 'version', type: 'integer' },
        ],
      }),
      new Table({
        name: 'event_archive_locations',
        columns: [
          { name: 'event_id', type: 'text', isPrimary: true },
          { name: 'variant', type: 'text', isPrimary: true },
          { name: 'node_id', type: 'text', isPrimary: true },
          { name: 'digest', type: 'text' },
          { name: 'bytes', type: int64 },
          { name: 'version', type: 'integer' },
          { name: 'verified_at', type: int64 },
        ],
      }),
      new Table({
        name: 'event_archive_state',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'generation', type: 'integer' },
        ],
      }),
      new Table({
        name: 'migrations',
        columns: [{ name: 'id', type: 'text', isPrimary: true }],
      }),
    ];

    for (const table of tables) {
      if (!(await runner.hasTable(table.name))) await runner.createTable(table);
    }
    if (pg) {
      await runner.query(
        'ALTER TABLE event_archive_locations ADD COLUMN IF NOT EXISTS archive_cursor BIGSERIAL',
      );
    }
  }

  private async addEventColumns(runner: QueryRunner, pg: boolean): Promise<void> {
    const table = await runner.getTable('events');
    if (!table) throw Error('recording_events_table_missing');
    for (const column of getEventColumns(pg)) {
      if (!table.columns.some((existing) => existing.name === column.name)) {
        await runner.addColumn('events', new TableColumn(column));
      }
    }
  }

  private async ensureIndexes(runner: QueryRunner, pg: boolean): Promise<void> {
    for (const index of eventIndexes) {
      const table = await runner.getTable('events');
      const hasAllColumns = index.columnNames.every((col) =>
        table?.columns.some((existing) => existing.name === col),
      );
      if (hasAllColumns && !table?.indices.some((existing) => existing.name === index.name)) {
        await runner.createIndex('events', index);
      }
    }
    const availability = await runner.getTable('camera_availability');
    if (!availability?.indices.some((index) => index.name === 'camera_availability_time')) {
      await runner.createIndex(
        'camera_availability',
        new TableIndex({ name: 'camera_availability_time', columnNames: ['camera_id', 'end_at'] }),
      );
    }
    if (pg) {
      await runner.query(
        'CREATE INDEX IF NOT EXISTS idx_event_archive_locations_cursor ON event_archive_locations (archive_cursor)',
      );
    }
  }

  private async migrateRecordingPolicy(runner: QueryRunner, pg: boolean): Promise<void> {
    const previous: unknown = await runner.query(
      sqlParams(pg, 'SELECT id FROM migrations WHERE id=?'),
      ['explicit-recording-policy'],
    );
    if (Array.isArray(previous) && previous.length > 0) return;

    const known: unknown = await runner.query(
      'SELECT DISTINCT camera_id FROM camera_availability UNION SELECT DISTINCT camera_id FROM events',
    );
    if (!Array.isArray(known)) throw Error('recording_camera_migration_invalid');
    for (const candidate of known) {
      if (typeof candidate !== 'object' || candidate === null || !('camera_id' in candidate))
        throw Error('recording_camera_migration_invalid');
      const id = String(candidate.camera_id);
      const rows: unknown = await runner.query(
        sqlParams(pg, 'SELECT value FROM settings WHERE id=?'),
        [id],
      );
      const value = Array.isArray(rows) ? rows[0]?.value : undefined;
      const previousSettings =
        typeof value === 'string' ? (JSON.parse(value) as Record<string, unknown>) : {};
      if (previousSettings.enabled === undefined) {
        await runner.query(
          sqlParams(
            pg,
            'INSERT INTO settings (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
          ),
          [id, JSON.stringify({ ...previousSettings, enabled: true })],
        );
      }
    }
    await runner.query(sqlParams(pg, 'INSERT INTO migrations (id) VALUES (?)'), [
      'explicit-recording-policy',
    ]);
  }
}
