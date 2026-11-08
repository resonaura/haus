/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { openCatalog, Transactions } from '@haus/hub/storage';
import { DataSource } from 'typeorm';
import { RecordingStore } from '@haus/hub/events';

export async function openTestRecordingStore(
  database: string,
  media: string,
  legacySql?: string,
): Promise<RecordingStore> {
  if (legacySql) {
    const legacy = new DataSource({ type: 'better-sqlite3', database, synchronize: false });
    await legacy.initialize();
    try {
      await executeStatements(legacy, legacySql);
    } finally {
      await legacy.destroy();
    }
  }
  const source = await openCatalog(database);
  const store = new RecordingStore(source, media, new Transactions(source));
  const close = store.close.bind(store);
  store.close = async () => {
    await close();
    if (source.isInitialized) await source.destroy();
  };
  return store;
}

export function queryRows<T = Record<string, unknown>>(
  store: RecordingStore | DataSource,
  sql: string,
  ...parameters: unknown[]
): Promise<T[]> {
  const source = store instanceof DataSource ? store : store.source;
  if (!parameters.length && sql.includes(';')) return executeStatements(source, sql) as Promise<T[]>;
  return source.manager.query(sql, parameters) as Promise<T[]>;
}

export async function queryOne<T = Record<string, unknown>>(
  store: RecordingStore | DataSource,
  sql: string,
  ...parameters: unknown[]
): Promise<T | undefined> {
  return (await queryRows<T>(store, sql, ...parameters))[0];
}

async function executeStatements(
  source: DataSource,
  sql: string,
): Promise<Record<string, unknown>[]> {
  let result: Record<string, unknown>[] = [];
  for (const statement of sql.split(';').filter((value) => value.trim()))
    result = (await source.manager.query(statement)) as Record<string, unknown>[];
  return result;
}
