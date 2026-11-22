/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DataSource, type DataSourceOptions } from 'typeorm';
import {
  configurePgTypeParsers,
  createPostgresPoolExtra,
  isPostgresUrl,
} from '../storage/dialect.js';
import {
  CameraAvailabilityEntity,
  EventArchiveEntity,
  EventArchiveLocationEntity,
  EventArchiveStateEntity,
  RecordingEventEntity,
  RecordingMigrationEntity,
  RecordingSettingEntity,
} from './recording.entities.js';
import { Recording1793953000000 } from './recording.migration.js';

export async function openRecordingSource(database: string): Promise<DataSource> {
  const isPg = isPostgresUrl(database);
  if (isPg) configurePgTypeParsers();
  const entities = [
    RecordingSettingEntity,
    RecordingEventEntity,
    CameraAvailabilityEntity,
    EventArchiveEntity,
    EventArchiveLocationEntity,
    EventArchiveStateEntity,
    RecordingMigrationEntity,
  ];
  const options: DataSourceOptions = isPg
    ? {
        type: 'postgres',
        url: database,
        synchronize: false,
        logging: false,
        migrationsRun: false,
        migrationsTableName: 'haus_events_migrations',
        extra: createPostgresPoolExtra('catalog'),
        entities,
        migrations: [Recording1793953000000],
      }
    : {
        type: 'better-sqlite3',
        database,
        enableWAL: true,
        timeout: 5000,
        synchronize: false,
        logging: false,
        migrationsRun: false,
        migrationsTableName: 'haus_events_migrations',
        entities,
        migrations: [Recording1793953000000],
      };
  const source = new DataSource(options);

  await source.initialize();
  try {
    await source.runMigrations({ transaction: 'all' });
    return source;
  } catch (error) {
    await source.destroy();
    throw error;
  }
}
