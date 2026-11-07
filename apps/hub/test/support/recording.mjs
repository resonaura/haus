/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { openCatalog, Transactions } from '@haus/hub/storage';
import { DataSource } from 'typeorm';
import { RecordingStore } from '@haus/hub/events';

export async function openTestRecordingStore(database, media, legacySql) {
  if (legacySql) {
    const legacy = new DataSource({ type: "better-sqlite3", database, synchronize: false });
    await legacy.initialize();
    try { await executeStatements(legacy, legacySql); } finally { await legacy.destroy(); }
  }
  const source = await openCatalog(database);
  const store = new RecordingStore(source, media, new Transactions(source));
  const close = store.close.bind(store);
  store.close = async () => { await close(); if (source.isInitialized) await source.destroy(); };
  return store;
}
export function queryRows(store, sql, ...parameters) {
  const source = store.source ?? store;
  if (!parameters.length && sql.includes(';')) return executeStatements(source, sql);
  return source.manager.query(sql, parameters);
}
export async function queryOne(store, sql, ...parameters) {
  return (await queryRows(store, sql, ...parameters))[0];
}

async function executeStatements(source, sql) {
  let result = [];
  for (const statement of sql.split(';').filter(value => value.trim())) result = await source.manager.query(statement);
  return result;
}
