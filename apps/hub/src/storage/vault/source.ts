/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { DataSource } from 'typeorm';
import { VaultEntity, VaultLock } from './entities.js';
import { Vault1793799000000 } from './migration.js';
import { VaultSnake1793952000000 } from './snake.js';

/** The composition root supplies a private local path, separate from the replicable catalog. */
export async function openVault(database: string): Promise<DataSource> {
  const source = new DataSource({
    type: 'better-sqlite3',
    database,
    enableWAL: true,
    timeout: 5000,
    synchronize: false,
    logging: false,
    migrationsRun: false,
    migrationsTableName: 'haus_vault_migrations',
    entities: [VaultEntity, VaultLock],
    migrations: [Vault1793799000000, VaultSnake1793952000000],
  });
  await source.initialize();
  try {
    const runner = source.createQueryRunner();
    try {
      if (
        (await runner.hasTable('haus-platform-lock')) ||
        (await runner.hasTable('haus_platform_lock'))
      )
        throw Error('vault_requires_separate_database');
      const oldMigrationLedger = await runner.hasTable('haus-vault-migrations');
      const migrationLedger = await runner.hasTable('haus_vault_migrations');
      if (oldMigrationLedger && migrationLedger) throw Error('vault_migration_ledger_conflict');
      if (oldMigrationLedger)
        await runner.renameTable('haus-vault-migrations', 'haus_vault_migrations');
    } finally {
      await runner.release();
    }
    await source.runMigrations({ transaction: 'all' });
    if ((await source.manager.findOneBy(VaultLock, { id: 1 }))?.version !== 1)
      throw Error('unsupported_vault_storage_version');
    return source;
  } catch (error) {
    await source.destroy();
    throw error;
  }
}
