/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { DataSource } from 'typeorm';
import { IdentityEntity, AliasEntity } from './entities/identity.js';
import { AddressEntity, PrimaryEntity } from './entities/address.js';
import { LockEntity } from './entities/lock.js';
import { Identity1793793227000 } from './migrations/identity.js';

export async function openCatalog(database: string): Promise<DataSource> {
  const source = new DataSource({
    type: 'better-sqlite3',
    database,
    enableWAL: true,
    timeout: 5000,
    synchronize: false,
    logging: false,
    migrationsRun: false,
    migrationsTableName: 'haus-platform-migrations',
    entities: [IdentityEntity, AliasEntity, AddressEntity, PrimaryEntity, LockEntity],
    migrations: [Identity1793793227000],
  });
  await source.initialize();
  try {
    await source.runMigrations({ transaction: 'all' });
    if ((await source.manager.findOneBy(LockEntity, { id: 1 }))?.version !== 1)
      throw Error('unsupported_platform_storage_version');
    return source;
  } catch (error) {
    await source.destroy();
    throw error;
  }
}
