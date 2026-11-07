/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DataSource } from 'typeorm';
import {
  CameraActivityEventEntity,
  CameraActivityRequestEntity,
  CameraRecordingOutboxEntity,
  RecordingIndexEntity,
} from './entities.js';
import { NvrRecordings1793950000000 } from './migration.js';

/** Opens the existing NVR catalog in place and applies additive ORM migrations. */
export async function openRecordings(database: string): Promise<DataSource> {
  const source = new DataSource({
    type: 'better-sqlite3',
    database,
    enableWAL: true,
    timeout: 5000,
    synchronize: false,
    logging: false,
    migrationsRun: false,
    migrationsTableName: 'haus_nvr_migrations',
    entities: [
      RecordingIndexEntity,
      CameraRecordingOutboxEntity,
      CameraActivityEventEntity,
      CameraActivityRequestEntity,
    ],
    migrations: [NvrRecordings1793950000000],
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
