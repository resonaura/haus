/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { openCatalog, Transactions } from '../../../src/storage/index.js';
import { RecordingStore } from '../../../src/events/recording.store.js';
import { BackupCatalog } from '../../../src/backup/catalog.js';
import { ClusterCatalog } from '../../../src/cluster/catalog.js';
import { records } from './legacy.js';

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

export async function queryOne(
  store: RecordingStore,
  sql: string,
  ...parameters: unknown[]
): Promise<Record<string, unknown> | undefined> {
  const result: unknown = await store.source.manager.query(sql, parameters);
  return records(result)[0];
}
