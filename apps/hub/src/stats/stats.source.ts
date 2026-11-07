/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DataSource } from 'typeorm';
import {
  RawStatisticSampleEntity,
  Statistic1hRollupEntity,
  Statistic5mRollupEntity,
  StatisticMetadataEntity,
} from './stats.schema.js';
import { Statistics1793952000000 } from './stats.migration.js';

export async function openStatsSource(database: string): Promise<DataSource> {
  const source = new DataSource({
    type: 'better-sqlite3',
    database,
    enableWAL: true,
    timeout: 5000,
    synchronize: false,
    logging: false,
    migrationsRun: false,
    migrationsTableName: 'haus_stats_migrations',
    entities: [
      StatisticMetadataEntity,
      RawStatisticSampleEntity,
      Statistic5mRollupEntity,
      Statistic1hRollupEntity,
    ],
    migrations: [Statistics1793952000000],
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
