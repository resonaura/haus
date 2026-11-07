/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Table, TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { haEntities } from './entities.js';

/** Adopt existing grants, ownership and recovery journals without rewriting identities. */
export class HaCatalog1793959000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    for (const schema of haEntities) {
      const metadata = runner.connection.getMetadata(schema);
      const name = metadata.tableName;
      const columns = metadata.columns.map((column) => ({
        name: column.databaseName,
        type: String(column.type === Boolean ? 'boolean' : column.type),
        isPrimary: column.isPrimary,
        isNullable: column.isNullable,
        default: column.default,
      }));
      if (!(await runner.hasTable(name))) await runner.createTable(new Table({ name, columns }));
      else
        for (const column of columns) {
          if (await runner.hasColumn(name, column.name)) continue;
          if (name === 'ha_camera_clients' && column.name === 'native_entities')
            await runner.addColumn(name, new TableColumn(column));
          else throw Error(`ha_catalog_column_missing:${name}:${column.name}`);
        }
    }
  }
  async down(): Promise<void> {
    throw Error('ha_catalog_rollback_requires_explicit_data_migration');
  }
}
