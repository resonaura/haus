/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

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
          { name: 'created_at', type: 'integer' },
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
          { name: 'timestamp', type: 'integer', isPrimary: true },
          { name: 'value', type: 'real' },
        ],
        indices: [
          new TableIndex({ name: 'idx_stats_raw_time', columnNames: ['metadata_id', 'timestamp'] }),
        ],
      }),
      this.rollupTable('stats_5m', 'idx_stats_5m_time'),
      this.rollupTable('stats_1h', 'idx_stats_1h_time'),
    ];

    for (const table of tables) {
      if (!(await runner.hasTable(table.name))) await runner.createTable(table);
    }
  }

  private rollupTable(name: string, index: string): Table {
    return new Table({
      name,
      columns: [
        { name: 'metadata_id', type: 'text', isPrimary: true },
        { name: 'start_ts', type: 'integer', isPrimary: true },
        { name: 'min', type: 'real' },
        { name: 'max', type: 'real' },
        { name: 'mean', type: 'real', isNullable: true },
        { name: 'first', type: 'real' },
        { name: 'last', type: 'real' },
        { name: 'sum', type: 'real', isNullable: true },
        { name: 'count', type: 'integer' },
      ],
      indices: [new TableIndex({ name: index, columnNames: ['metadata_id', 'start_ts'] })],
    });
  }
}
