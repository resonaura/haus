/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Table } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { LockEntity } from '../entities/lock.js';

export class Control1793798000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const lock = await runner.manager.update(LockEntity, { id: 1, version: 1 }, { version: 2 });
    if (lock.affected !== 1) throw Error('unsupported_platform_storage_version');
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
