/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

/** Adopts policy and installed plugin rows without rewriting their payloads. */
export class ServicePolicy1793956000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const tables = [
      new Table({
        name: 'service_policy',
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'value', type: 'text' },
        ],
      }),
      new Table({
        name: 'kitsune_plugins',
        columns: [
          { name: 'vendor', type: 'text', isPrimary: true },
          { name: 'version', type: 'text', isNullable: true },
        ],
      }),
    ];
    for (const table of tables) {
      if (!(await runner.hasTable(table.name))) await runner.createTable(table);
      const existing = await runner.getTable(table.name);
      for (const column of table.columns) {
        if (!existing?.columns.some((value) => value.name === column.name))
          throw Error(`service_catalog_column_missing:${table.name}.${column.name}`);
      }
    }
  }

  async down(): Promise<void> {
    throw Error('service_policy_rollback_requires_explicit_data_migration');
  }
}
