/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DataSource, type DataSourceOptions } from 'typeorm';
import {
  configurePgTypeParsers,
  createPostgresPoolExtra,
  isPostgresUrl,
} from '../storage/dialect.js';
import {
  EndpointHistoryEventEntity,
  RawStatisticSampleEntity,
  Statistic1hRollupEntity,
  Statistic5mRollupEntity,
  StatisticMetadataEntity,
} from './stats.schema.js';
import { EndpointHistory1795300100000, Statistics1793952000000 } from './stats.migration.js';

export async function openStatsSource(database: string): Promise<DataSource> {
  const isPg = isPostgresUrl(database);
  if (isPg) configurePgTypeParsers();
  const entities = [
    StatisticMetadataEntity,
    RawStatisticSampleEntity,
    Statistic5mRollupEntity,
    Statistic1hRollupEntity,
    EndpointHistoryEventEntity,
  ];
  const migrations = [Statistics1793952000000, EndpointHistory1795300100000];
  const options: DataSourceOptions = isPg
    ? {
        type: 'postgres',
        url: database,
        synchronize: false,
        logging: false,
        migrationsRun: false,
        migrationsTableName: 'haus_stats_migrations',
        extra: createPostgresPoolExtra('stats'),
        entities,
        migrations,
      }
    : {
        type: 'better-sqlite3',
        database,
        enableWAL: true,
        timeout: 5000,
        synchronize: false,
        logging: false,
        migrationsRun: false,
        migrationsTableName: 'haus_stats_migrations',
        entities,
        migrations,
      };
  const source = new DataSource(options);

  await source.initialize();
  try {
    if (!isPg) {
      await source.query('PRAGMA synchronous = NORMAL');
      await source.query('PRAGMA temp_store = MEMORY');
      await source.query('PRAGMA cache_size = -16000');
      await source.query('PRAGMA wal_autocheckpoint = 1000');
    }
    await source.runMigrations({ transaction: 'all' });
    return source;
  } catch (error) {
    await source.destroy();
    throw error;
  }
}
