/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Table } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function hasVersionOneLock(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const row: unknown = value[0];
  return typeof row === 'object' && row !== null && 'version' in row && row.version === 1;
}

export class Control1793798000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const lock: unknown = await runner.query(
      'SELECT version FROM "haus-platform-lock" WHERE id=?',
      [1],
    );
    if (!hasVersionOneLock(lock)) throw Error('unsupported_platform_storage_version');
    await runner.query('UPDATE "haus-platform-lock" SET version=? WHERE id=?', [2, 1]);
    await runner.createTable(
      new Table({
        name: 'haus-sessions',
        columns: [
          { name: 'home', type: 'text', isPrimary: true },
          { name: 'integration', type: 'text', isPrimary: true },
          { name: 'hub', type: 'text' },
          { name: 'process', type: 'text' },
          { name: 'generation', type: 'integer' },
          { name: 'state', type: 'text' },
        ],
      }),
    );
    await runner.createTable(
      new Table({
        name: 'haus-receipts',
        columns: [
          { name: 'home', type: 'text', isPrimary: true },
          { name: 'actor', type: 'text', isPrimary: true },
          { name: 'idempotency-key', type: 'text', isPrimary: true },
          { name: 'fingerprint', type: 'text' },
          { name: 'command-id', type: 'text' },
          { name: 'correlation-id', type: 'text' },
          { name: 'owner-generation', type: 'integer' },
          { name: 'status', type: 'text' },
          { name: 'reason', type: 'text', isNullable: true },
        ],
      }),
    );
  }

  async down(): Promise<void> {
    throw Error('platform_control_rollback_requires_explicit_data_migration');
  }
}
