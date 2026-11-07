/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

/** Adopts existing retry deadlines without resetting preparation ordering. */
export class Retention1793958000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!(await runner.hasTable('background_preparation_attempts'))) {
      await runner.createTable(
        new Table({
          name: 'background_preparation_attempts',
          columns: [
            { name: 'event_id', type: 'text', isPrimary: true },
            { name: 'next_at', type: 'integer' },
          ],
        }),
      );
    }
    const table = await runner.getTable('background_preparation_attempts');
    for (const name of ['event_id', 'next_at']) {
      if (!table?.columns.some((column) => column.name === name))
        throw Error(`preparation_attempts_column_missing:${name}`);
    }
  }

  async down(): Promise<void> {
    throw Error('retention_rollback_requires_explicit_data_migration');
  }
}
