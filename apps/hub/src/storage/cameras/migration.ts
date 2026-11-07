/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { cameraEntities } from './entities.js';

/** Explicitly adopts legacy schemas; stored IDs, credentials and ownership history stay in place. */
export class CameraCatalog1793957000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    for (const schema of cameraEntities) {
      const metadata = runner.connection.getMetadata(schema);
      const name = metadata.tableName;
      if (!(await runner.hasTable(name))) {
        await runner.createTable(
          new Table({
            name,
            columns: metadata.columns.map((column) => ({
              name: column.databaseName,
              type: String(column.type),
              isPrimary: column.isPrimary,
              isNullable: column.isNullable,
              isUnique: metadata.uniques.some(
                (unique) => unique.columns.length === 1 && unique.columns[0] === column,
              ),
            })),
          }),
        );
      } else {
        for (const column of metadata.columns) {
          if (!(await runner.hasColumn(name, column.databaseName)))
            throw Error(`camera_catalog_column_missing:${name}:${column.databaseName}`);
        }
      }
    }
    const policies = await runner.getTable('nvr_activity_policies');
    if (!policies?.indices.some((index) => index.name === 'nvr_activity_camera')) {
      await runner.createIndex(
        'nvr_activity_policies',
        new TableIndex({ name: 'nvr_activity_camera', columnNames: ['camera_id', 'revoked_at'] }),
      );
    }
  }
  async down(): Promise<void> {
    throw Error('camera_catalog_rollback_requires_explicit_data_migration');
  }
}
