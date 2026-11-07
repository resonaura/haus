/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Table, TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adopts the legacy backup catalogs without changing rows or retry deadlines. */
export class BackupCatalog1793955000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!(await runner.hasTable('haus_backups'))) {
      await runner.createTable(
        new Table({
          name: 'haus_backups',
          columns: [
            { name: 'digest', type: 'text', isPrimary: true },
            { name: 'kind', type: 'text' },
            { name: 'created_at', type: 'integer' },
            { name: 'bytes', type: 'integer' },
            { name: 'ha_slug', type: 'text', isNullable: true },
            { name: 'archive_generation', type: 'integer', isNullable: true },
          ],
        }),
      );
    }

    const backups = await runner.getTable('haus_backups');
    if (!backups) throw Error('haus_backups_table_missing');
    for (const name of ['digest', 'kind', 'created_at', 'bytes', 'ha_slug']) {
      if (!backups.columns.some((column) => column.name === name)) {
        throw Error(`haus_backups_column_missing:${name}`);
      }
    }
    if (!backups.columns.some((column) => column.name === 'archive_generation')) {
      await runner.addColumn(
        'haus_backups',
        new TableColumn({ name: 'archive_generation', type: 'integer', isNullable: true }),
      );
    }

    if (!(await runner.hasTable('haus_backup_retries'))) {
      await runner.createTable(
        new Table({
          name: 'haus_backup_retries',
          columns: [
            { name: 'kind', type: 'text', isPrimary: true },
            { name: 'next_at', type: 'integer' },
            { name: 'failures', type: 'integer' },
          ],
        }),
      );
    }
    const retries = await runner.getTable('haus_backup_retries');
    if (!retries?.columns.some((column) => column.name === 'kind')) {
      throw Error('haus_backup_retries_kind_missing');
    }
    for (const name of ['next_at', 'failures']) {
      if (!retries.columns.some((column) => column.name === name)) {
        throw Error(`haus_backup_retries_column_missing:${name}`);
      }
    }
  }

  async down(): Promise<void> {
    throw Error('backup_catalog_rollback_requires_explicit_data_migration');
  }
}
