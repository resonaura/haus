/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DataSource } from 'typeorm';
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
  const source = new DataSource({
    type: 'better-sqlite3',
    database,
    enableWAL: true,
    timeout: 5000,
    synchronize: false,
    logging: false,
    migrationsRun: false,
    migrationsTableName: 'haus_events_migrations',
    entities: [
      RecordingSettingEntity,
      RecordingEventEntity,
      CameraAvailabilityEntity,
      EventArchiveEntity,
      EventArchiveLocationEntity,
      EventArchiveStateEntity,
      RecordingMigrationEntity,
    ],
    migrations: [Recording1793953000000],
  });

  await source.initialize();
  try {
    await source.runMigrations({ transaction: 'all' });
    return source;
  } catch (error) {
    await source.destroy();
    throw error;
  }
}
