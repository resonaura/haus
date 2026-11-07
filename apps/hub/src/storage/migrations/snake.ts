/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { MigrationInterface, QueryRunner } from 'typeorm';

const tables = [
  ['haus-platform-lock', 'haus_platform_lock'],
  ['haus-identity-ids', 'haus_identity_ids'],
  ['haus-identity-refs', 'haus_identity_refs'],
  ['haus-addresses', 'haus_addresses'],
  ['haus-primary-addresses', 'haus_primary_addresses'],
  ['haus-sessions', 'haus_sessions'],
  ['haus-receipts', 'haus_receipts'],
] as const;

const columns = [
  ['haus_identity_refs', 'identity-id', 'identity_id'],
  ['haus_addresses', 'identity-id', 'identity_id'],
  ['haus_primary_addresses', 'identity-id', 'identity_id'],
  ['haus_receipts', 'idempotency-key', 'idempotency_key'],
  ['haus_receipts', 'command-id', 'command_id'],
  ['haus_receipts', 'correlation-id', 'correlation_id'],
  ['haus_receipts', 'owner-generation', 'owner_generation'],
] as const;

/** Renames the original platform schema in place; SQLite updates its foreign-key references. */
export class StorageSnake1793951000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    for (const [previous, current] of tables) await renameTable(runner, previous, current);
    for (const [table, previous, current] of columns)
      await renameColumn(runner, table, previous, current);
  }

  async down(): Promise<void> {
    throw Error('platform_snake_case_rollback_requires_explicit_data_migration');
  }
}

async function renameTable(runner: QueryRunner, previous: string, current: string): Promise<void> {
  const hasPrevious = await runner.hasTable(previous);
  const hasCurrent = await runner.hasTable(current);
  if (hasPrevious && hasCurrent) throw Error('storage_table_name_conflict');
  if (hasPrevious) await runner.renameTable(previous, current);
  else if (!hasCurrent) throw Error('storage_table_missing');
}

async function renameColumn(
  runner: QueryRunner,
  table: string,
  previous: string,
  current: string,
): Promise<void> {
  const hasPrevious = await runner.hasColumn(table, previous);
  const hasCurrent = await runner.hasColumn(table, current);
  if (hasPrevious && hasCurrent) throw Error('storage_column_name_conflict');
  if (hasPrevious) await runner.renameColumn(table, previous, current);
  else if (!hasCurrent) throw Error('storage_column_missing');
}
