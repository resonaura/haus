/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Table } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { VaultLock } from './entities.js';

export class Vault1793799000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.createTable(
      new Table({
        name: 'haus-vault-lock',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'version', type: 'integer' },
        ],
      }),
    );
    await runner.manager.insert(VaultLock, { id: 1, version: 1 });
    await runner.createTable(
      new Table({
        name: 'haus-vault-credentials',
        columns: [
          { name: 'home', type: 'text', isPrimary: true },
          { name: 'integration', type: 'text', isPrimary: true },
          { name: 'hub', type: 'text' },
          { name: 'process', type: 'text' },
          { name: 'generation', type: 'integer' },
          { name: 'state', type: 'text' },
          { name: 'attempt-id', type: 'text', isNullable: true },
          { name: 'iv', type: 'blob' },
          { name: 'ciphertext', type: 'blob' },
          { name: 'tag', type: 'blob' },
        ],
      }),
    );
  }

  async down(): Promise<void> {
    throw Error('vault_rollback_requires_explicit_credential_recovery');
  }
}
