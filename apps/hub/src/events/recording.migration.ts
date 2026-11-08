/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Table, TableColumn, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

const eventColumns = [
  { name: 'media_start_at', type: 'integer', isNullable: true },
  { name: 'playback_version', type: 'integer', default: 0 },
  { name: 'playback_bytes', type: 'integer', default: 0 },
  { name: 'playback_info', type: 'text', isNullable: true },
  { name: 'media_revision', type: 'integer', default: 0 },
  { name: 'local_original', type: 'integer', default: 1 },
  { name: 'local_playback', type: 'integer', default: 1 },
] as const;

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
    await this.createBaseTables(runner);
    await this.addEventColumns(runner);
    await this.ensureIndexes(runner);
    await runner.query('INSERT OR IGNORE INTO event_archive_state (id,generation) VALUES (1,0)');
    await this.migrateRecordingPolicy(runner);
    const versions: unknown = await runner.query('PRAGMA user_version');
    const version = Array.isArray(versions) ? Number(versions[0]?.user_version ?? 0) : 0;
    if (version < 6) await runner.query('PRAGMA user_version=6');
  }

  async down(): Promise<void> {
    throw Error('recording_schema_rollback_requires_explicit_data_migration');
  }

  private async createBaseTables(runner: QueryRunner): Promise<void> {
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
          { name: 'start_at', type: 'integer' },
          { name: 'end_at', type: 'integer' },
          { name: 'status', type: 'text' },
          { name: 'kinds', type: 'text' },
          { name: 'detections', type: 'text' },
          { name: 'duration', type: 'real', default: 0 },
          { name: 'bytes', type: 'integer', default: 0 },
          { name: 'error', type: 'text', isNullable: true },
        ],
      }),
      new Table({
        name: 'camera_availability',
        columns: [
          { name: 'camera_id', type: 'text', isPrimary: true },
          { name: 'start_at', type: 'integer', isPrimary: true },
          { name: 'end_at', type: 'integer' },
          { name: 'state', type: 'text' },
        ],
      }),
      new Table({
        name: 'event_archive',
        columns: [
          { name: 'event_id', type: 'text', isPrimary: true },
          { name: 'variant', type: 'text', isPrimary: true },
          { name: 'digest', type: 'text' },
          { name: 'bytes', type: 'integer' },
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
          { name: 'bytes', type: 'integer' },
          { name: 'version', type: 'integer' },
          { name: 'verified_at', type: 'integer' },
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
  }

  private async addEventColumns(runner: QueryRunner): Promise<void> {
    const table = await runner.getTable('events');
    if (!table) throw Error('recording_events_table_missing');
    for (const column of eventColumns) {
      if (!table.columns.some((existing) => existing.name === column.name)) {
        await runner.addColumn('events', new TableColumn(column));
      }
    }
  }

  private async ensureIndexes(runner: QueryRunner): Promise<void> {
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
  }

  private async migrateRecordingPolicy(runner: QueryRunner): Promise<void> {
    const previous: unknown = await runner.query('SELECT id FROM migrations WHERE id=?', [
      'explicit-recording-policy',
    ]);
    if (Array.isArray(previous) && previous.length > 0) return;

    const known: unknown = await runner.query(
      'SELECT DISTINCT camera_id FROM camera_availability UNION SELECT DISTINCT camera_id FROM events',
    );
    if (!Array.isArray(known)) throw Error('recording_camera_migration_invalid');
    for (const candidate of known) {
      if (typeof candidate !== 'object' || candidate === null || !('camera_id' in candidate))
        throw Error('recording_camera_migration_invalid');
      const id = String(candidate.camera_id);
      const rows: unknown = await runner.query('SELECT value FROM settings WHERE id=?', [id]);
      const value = Array.isArray(rows) ? rows[0]?.value : undefined;
      const previousSettings =
        typeof value === 'string' ? (JSON.parse(value) as Record<string, unknown>) : {};
      if (previousSettings.enabled === undefined) {
        await runner.query(
          'INSERT INTO settings (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
          [id, JSON.stringify({ ...previousSettings, enabled: true })],
        );
      }
    }
    await runner.query('INSERT INTO migrations (id) VALUES (?)', ['explicit-recording-policy']);
  }
}
