/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Table } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Add only Haus platform tables; existing NVR tables and user_version remain unchanged. */
export class Identity1793793227000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.createTable(
      new Table({
        name: 'haus-platform-lock',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'version', type: 'integer' },
        ],
      }),
    );
    await runner.query('INSERT INTO "haus-platform-lock" (id,version) VALUES(1,1)');
    await runner.createTable(
      new Table({
        name: 'haus-identity-ids',
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          { name: 'home', type: 'text' },
          { name: 'kind', type: 'text' },
          { name: 'source', type: 'text' },
          { name: 'external', type: 'text' },
        ],
      }),
    );
    await runner.createTable(
      new Table({
        name: 'haus-identity-refs',
        columns: [
          { name: 'home', type: 'text', isPrimary: true },
          { name: 'kind', type: 'text', isPrimary: true },
          { name: 'source', type: 'text', isPrimary: true },
          { name: 'external', type: 'text', isPrimary: true },
          { name: 'identity-id', type: 'text' },
        ],
        foreignKeys: [
          {
            columnNames: ['identity-id'],
            referencedTableName: 'haus-identity-ids',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await runner.createTable(
      new Table({
        name: 'haus-addresses',
        columns: [
          { name: 'home', type: 'text', isPrimary: true },
          { name: 'address', type: 'text', isPrimary: true },
          { name: 'identity-id', type: 'text' },
        ],
        foreignKeys: [
          {
            columnNames: ['identity-id'],
            referencedTableName: 'haus-identity-ids',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await runner.createTable(
      new Table({
        name: 'haus-primary-addresses',
        columns: [
          { name: 'home', type: 'text', isPrimary: true },
          { name: 'identity-id', type: 'text', isPrimary: true },
          { name: 'address', type: 'text' },
        ],
        foreignKeys: [
          {
            columnNames: ['home', 'address'],
            referencedTableName: 'haus-addresses',
            referencedColumnNames: ['home', 'address'],
          },
        ],
      }),
    );
  }

  async down(): Promise<void> {
    throw Error('platform_identity_rollback_requires_explicit_data_migration');
  }
}
