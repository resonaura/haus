/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { floatCol, int64Col, isPostgresSource } from '../storage/dialect.js';

const renamedTables = [
  ['stats-metadata', 'stats_metadata'],
  ['stats-raw', 'stats_raw'],
  ['stats-5m', 'stats_5m'],
  ['stats-1h', 'stats_1h'],
] as const;

const renamedColumns = [
  ['stats_metadata', 'statistic-id', 'statistic_id'],
  ['stats_metadata', 'display-name', 'display_name'],
  ['stats_metadata', 'has-mean', 'has_mean'],
  ['stats_metadata', 'has-sum', 'has_sum'],
  ['stats_metadata', 'created-at', 'created_at'],
  ['stats_raw', 'metadata-id', 'metadata_id'],
  ['stats_5m', 'metadata-id', 'metadata_id'],
  ['stats_5m', 'start-ts', 'start_ts'],
  ['stats_1h', 'metadata-id', 'metadata_id'],
  ['stats_1h', 'start-ts', 'start_ts'],
] as const;

async function renameLegacyTables(runner: QueryRunner): Promise<void> {
  for (const [legacy, current] of renamedTables) {
    const hasLegacy = await runner.hasTable(legacy);
    const hasCurrent = await runner.hasTable(current);
    if (hasLegacy && hasCurrent) throw Error('stats_schema_name_conflict');
    if (hasLegacy) await runner.renameTable(legacy, current);
  }

  for (const [tableName, legacy, current] of renamedColumns) {
    if (!(await runner.hasTable(tableName))) continue;
    const table = await runner.getTable(tableName);
    const hasLegacy = table?.columns.some((column) => column.name === legacy) ?? false;
    const hasCurrent = table?.columns.some((column) => column.name === current) ?? false;
    if (hasLegacy && hasCurrent) throw Error('stats_schema_name_conflict');
    if (hasLegacy) await runner.renameColumn(tableName, legacy, current);
  }
}

export class Statistics1793952000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await renameLegacyTables(runner);
    await this.createTables(runner);
  }

  async down(): Promise<void> {
    throw Error('statistics_schema_rollback_requires_explicit_data_migration');
  }

  private async createTables(runner: QueryRunner): Promise<void> {
    const pg = isPostgresSource(runner);
    const int64 = int64Col(pg);
    const flt = floatCol(pg);
    const tables = [
      new Table({
        name: 'stats_metadata',
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'statistic_id', type: 'text' },
          { name: 'source', type: 'text' },
          { name: 'unit', type: 'text', isNullable: true },
          { name: 'kind', type: 'text' },
          { name: 'display_name', type: 'text', isNullable: true },
          { name: 'has_mean', type: 'boolean' },
          { name: 'has_sum', type: 'boolean' },
          { name: 'created_at', type: int64 },
        ],
        indices: [
          new TableIndex({
            name: 'idx_stats_metadata_statistic_id',
            columnNames: ['statistic_id'],
            isUnique: true,
          }),
          new TableIndex({ name: 'idx_stats_metadata_source', columnNames: ['source'] }),
        ],
      }),
      new Table({
        name: 'stats_raw',
        columns: [
          { name: 'metadata_id', type: 'text', isPrimary: true },
          { name: 'timestamp', type: int64, isPrimary: true },
          { name: 'value', type: flt },
        ],
        indices: [
          new TableIndex({ name: 'idx_stats_raw_time', columnNames: ['metadata_id', 'timestamp'] }),
        ],
      }),
      this.rollupTable('stats_5m', 'idx_stats_5m_time', int64, flt),
      this.rollupTable('stats_1h', 'idx_stats_1h_time', int64, flt),
    ];

    for (const table of tables) {
      if (!(await runner.hasTable(table.name))) await runner.createTable(table);
    }
  }

  private rollupTable(name: string, index: string, int64: string, flt: string): Table {
    return new Table({
      name,
      columns: [
        { name: 'metadata_id', type: 'text', isPrimary: true },
        { name: 'start_ts', type: int64, isPrimary: true },
        { name: 'min', type: flt },
        { name: 'max', type: flt },
        { name: 'mean', type: flt, isNullable: true },
        { name: 'first', type: flt },
        { name: 'last', type: flt },
        { name: 'sum', type: flt, isNullable: true },
        { name: 'count', type: 'integer' },
      ],
      indices: [new TableIndex({ name: index, columnNames: ['metadata_id', 'start_ts'] })],
    });
  }
}

/**
 * Adds long-term unbounded device state transition storage (`endpoint_history_events`)
 * plus time-axis indexes (BRIN on PostgreSQL, B-tree on SQLite) for fast range scans & delta sync.
 */
export class EndpointHistory1795300100000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const pg = isPostgresSource(runner);
    const int64 = int64Col(pg);
    if (!(await runner.hasTable('endpoint_history_events'))) {
      await runner.createTable(
        new Table({
          name: 'endpoint_history_events',
          columns: [
            { name: 'endpoint_id', type: 'text', isPrimary: true },
            { name: 'ts_ms', type: int64, isPrimary: true },
            { name: 'state_json', type: 'text' },
          ],
        }),
      );
    }
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_endpoint_history_ep_ts ON endpoint_history_events (endpoint_id, ts_ms DESC)',
    );
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_endpoint_history_ts ON endpoint_history_events (ts_ms)',
    );
    await runner.query('CREATE INDEX IF NOT EXISTS idx_stats_raw_ts ON stats_raw (timestamp)');
    await runner.query('CREATE INDEX IF NOT EXISTS idx_stats_5m_ts ON stats_5m (start_ts)');
    await runner.query('CREATE INDEX IF NOT EXISTS idx_stats_1h_ts ON stats_1h (start_ts)');
    if (pg) {
      await runner.query(
        'CREATE INDEX IF NOT EXISTS brin_stats_raw_ts ON stats_raw USING BRIN (timestamp) WITH (pages_per_range = 32)',
      );
      await runner.query(
        'CREATE INDEX IF NOT EXISTS brin_stats_5m_ts ON stats_5m USING BRIN (start_ts) WITH (pages_per_range = 32)',
      );
      await runner.query(
        'CREATE INDEX IF NOT EXISTS brin_stats_1h_ts ON stats_1h USING BRIN (start_ts) WITH (pages_per_range = 32)',
      );
      await runner.query(
        'CREATE INDEX IF NOT EXISTS brin_endpoint_history_ts ON endpoint_history_events USING BRIN (ts_ms) WITH (pages_per_range = 32)',
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX IF EXISTS brin_endpoint_history_ts');
    await runner.query('DROP INDEX IF EXISTS brin_stats_1h_ts');
    await runner.query('DROP INDEX IF EXISTS brin_stats_5m_ts');
    await runner.query('DROP INDEX IF EXISTS brin_stats_raw_ts');
    await runner.query('DROP INDEX IF EXISTS idx_stats_1h_ts');
    await runner.query('DROP INDEX IF EXISTS idx_stats_5m_ts');
    await runner.query('DROP INDEX IF EXISTS idx_stats_raw_ts');
    await runner.query('DROP INDEX IF EXISTS idx_endpoint_history_ts');
    await runner.query('DROP INDEX IF EXISTS idx_endpoint_history_ep_ts');
    if (await runner.hasTable('endpoint_history_events')) {
      await runner.dropTable('endpoint_history_events');
    }
  }
}
