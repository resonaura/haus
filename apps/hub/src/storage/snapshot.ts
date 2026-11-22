/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { DataSource } from 'typeorm';
import { configurePgTypeParsers, isPostgresUrl } from './dialect.js';
import { exportPostgresCatalogToSqlite } from './portable-snapshot.js';

/** Backup hooks open an existing catalog read-only and never run upgrade migrations. */
export async function snapshotCatalog(database: string, destination: string): Promise<void> {
  if (isPostgresUrl(database)) {
    configurePgTypeParsers();
    const source = new DataSource({
      type: 'postgres',
      url: database,
      synchronize: false,
      migrationsRun: false,
      logging: false,
    });
    await source.initialize();
    try {
      const { openCatalog } = await import('./source.js');
      await exportPostgresCatalogToSqlite(source, destination, openCatalog);
    } finally {
      await source.destroy();
    }
    return;
  }
  const source = new DataSource({
    type: 'better-sqlite3',
    database,
    readonly: true,
    fileMustExist: true,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    timeout: 5000,
  });
  await source.initialize();
  try {
    await source.query('VACUUM INTO ?', [destination]);
  } finally {
    await source.destroy();
  }
}
