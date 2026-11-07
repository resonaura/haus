/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { DataSource } from 'typeorm';
import { IdentityEntity, AliasEntity } from './entities/identity.js';
import { AddressEntity, PrimaryEntity } from './entities/address.js';
import { LockEntity } from './entities/lock.js';
import { Identity1793793227000 } from './migrations/identity.js';
import { Control1793798000000 } from './migrations/control.js';
import { StorageSnake1793951000000 } from './migrations/snake.js';
import { SessionEntity } from './entities/session.js';
import { ReceiptEntity } from './entities/receipt.js';
import {
  ClusterLocationEntity,
  ClusterMediaEntity,
  ClusterNodeEntity,
  BackupEntity,
  BackupRetryEntity,
  HomeKitIdentityEntity,
  SharedConfigEntity,
} from './entities/domains.js';
import { haEntities } from './ha/entities.js';
import { HaCatalog1793959000000 } from './ha/migration.js';
import { storageVersion } from './version.js';
import { HubDomains1793954000000 } from './migrations/domains.js';
import { BackupCatalog1793955000000 } from './migrations/backups.js';
import { ServicePolicy1793956000000 } from './policy/migration.js';
import { KitsunePluginEntity, ServicePolicyEntity } from './policy/entities.js';
import { PreparationAttemptEntity } from './retention/entities.js';
import { Retention1793958000000 } from './retention/migration.js';
import {
  CameraAvailabilityEntity,
  EventArchiveEntity,
  EventArchiveLocationEntity,
  EventArchiveStateEntity,
  RecordingEventEntity,
  RecordingMigrationEntity,
  RecordingSettingEntity,
} from '../events/recording.entities.js';
import { Recording1793953000000 } from '../events/recording.migration.js';
import { cameraEntities } from './cameras/entities.js';
import { CameraCatalog1793957000000 } from './cameras/migration.js';

export async function openCatalog(database: string): Promise<DataSource> {
  const source = new DataSource({
    type: 'better-sqlite3',
    database,
    enableWAL: true,
    timeout: 5000,
    synchronize: false,
    logging: false,
    migrationsRun: false,
    migrationsTableName: 'haus_platform_migrations',
    entities: [
      IdentityEntity,
      AliasEntity,
      AddressEntity,
      PrimaryEntity,
      LockEntity,
      SessionEntity,
      ReceiptEntity,
      SharedConfigEntity,
      ClusterNodeEntity,
      ClusterLocationEntity,
      ClusterMediaEntity,
      BackupEntity,
      BackupRetryEntity,
      HomeKitIdentityEntity,
      ServicePolicyEntity,
      KitsunePluginEntity,
      PreparationAttemptEntity,
      RecordingSettingEntity,
      RecordingEventEntity,
      CameraAvailabilityEntity,
      EventArchiveEntity,
      EventArchiveLocationEntity,
      EventArchiveStateEntity,
      RecordingMigrationEntity,
      ...cameraEntities,
      ...haEntities,
    ],
    migrations: [
      Identity1793793227000,
      Control1793798000000,
      StorageSnake1793951000000,
      Recording1793953000000,
      HubDomains1793954000000,
      BackupCatalog1793955000000,
      ServicePolicy1793956000000,
      CameraCatalog1793957000000,
      Retention1793958000000,
      HaCatalog1793959000000,
    ],
  });
  await source.initialize();
  try {
    const runner = source.createQueryRunner();
    try {
      if ((await runner.hasTable('haus-vault-lock')) || (await runner.hasTable('haus_vault_lock')))
        throw Error('catalog_requires_separate_database');
      const oldMigrationLedger = await runner.hasTable('haus-platform-migrations');
      const migrationLedger = await runner.hasTable('haus_platform_migrations');
      if (oldMigrationLedger && migrationLedger) throw Error('storage_migration_ledger_conflict');
      if (oldMigrationLedger)
        await runner.renameTable('haus-platform-migrations', 'haus_platform_migrations');
    } finally {
      await runner.release();
    }
    await source.runMigrations({ transaction: 'all' });
    if ((await source.manager.findOneBy(LockEntity, { id: 1 }))?.version !== storageVersion)
      throw Error('unsupported_platform_storage_version');
    return source;
  } catch (error) {
    await source.destroy();
    throw error;
  }
}
