/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Preserves credentials while switching the vault schema to SQL snake_case names. */
export class VaultSnake1793952000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await renameTable(runner, 'haus-vault-lock', 'haus_vault_lock');
    await renameTable(runner, 'haus-vault-credentials', 'haus_vault_credentials');
    const oldAttempt = await runner.hasColumn('haus_vault_credentials', 'attempt-id');
    const attempt = await runner.hasColumn('haus_vault_credentials', 'attempt_id');
    if (oldAttempt && attempt) throw Error('vault_column_name_conflict');
    if (oldAttempt) await runner.renameColumn('haus_vault_credentials', 'attempt-id', 'attempt_id');
    else if (!attempt) throw Error('vault_column_missing');
  }

  async down(): Promise<void> {
    throw Error('vault_snake_case_rollback_requires_explicit_credential_recovery');
  }
}

async function renameTable(runner: QueryRunner, previous: string, current: string): Promise<void> {
  const hasPrevious = await runner.hasTable(previous);
  const hasCurrent = await runner.hasTable(current);
  if (hasPrevious && hasCurrent) throw Error('vault_table_name_conflict');
  if (hasPrevious) await runner.renameTable(previous, current);
  else if (!hasCurrent) throw Error('vault_table_missing');
}
