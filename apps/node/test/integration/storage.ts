/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { openCatalog, Transactions } from '@haus/hub/storage';
import { RecordingStore } from '@haus/hub/events';
import { BackupCatalog } from '@haus/hub/backup';
import { ClusterCatalog } from '@haus/hub/cluster';

export async function openPersistence(database: string, media: string) {
  const source = await openCatalog(database);
  const transactions = new Transactions(source);
  const store = new RecordingStore(source, media, transactions);
  return {
    store,
    transactions,
    backupCatalog: new BackupCatalog(transactions),
    clusterCatalog: new ClusterCatalog(transactions),
    close: async () => {
      await store.close();
      if (source.isInitialized) await source.destroy();
    },
  };
}

export async function queryRows(
  store: RecordingStore,
  sql: string,
  ...parameters: unknown[]
): Promise<unknown[]> {
  const rows: unknown = await store.source.manager.query(sql, parameters);
  if (!Array.isArray(rows)) throw Error('invalid_fixture_query');
  return rows;
}
export async function queryOne(
  store: RecordingStore,
  sql: string,
  ...parameters: unknown[]
): Promise<unknown> {
  return (await queryRows(store, sql, ...parameters))[0];
}
