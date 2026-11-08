/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Table } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { standaloneEntities } from './entities.js';

/** Persist standalone Hub client sessions (hashed) and home domain records across restarts. */
export class StandaloneCatalog1793960000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    for (const schema of standaloneEntities) {
      const metadata = runner.connection.getMetadata(schema);
      const name = metadata.tableName;
      const columns = metadata.columns.map((column) => ({
        name: column.databaseName,
        type: String(column.type === Boolean ? 'boolean' : column.type),
        isPrimary: column.isPrimary,
        isNullable: column.isNullable,
        default: column.default,
      }));
      if (!(await runner.hasTable(name))) {
        await runner.createTable(new Table({ name, columns }));
      } else {
        for (const column of columns) {
          if (await runner.hasColumn(name, column.name)) continue;
          throw Error(`standalone_catalog_column_missing:${name}:${column.name}`);
        }
      }
    }
  }

  async down(): Promise<void> {
    throw Error('standalone_catalog_rollback_requires_explicit_data_migration');
  }
}
