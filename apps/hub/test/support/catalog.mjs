/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { openCatalog, Transactions } from '@haus/hub/storage';
import { CameraCatalog } from '@haus/hub/storage';
import { ClusterCatalog } from '../../dist/cluster/catalog.js';
import { Cluster } from '../../lib/cluster/cluster.mjs';

export async function openTestCatalog(database) {
  const source = await openCatalog(database);
  const transactions = new Transactions(source);
  return {
    source,
    transactions,
    close: async () => {
      await transactions.drain();
      if (source.isInitialized) await source.destroy();
    },
  };
}

export async function openTestCameraCatalog(database) {
  const owner = await openTestCatalog(database);
  const cameraCatalog = new CameraCatalog(owner.transactions);
  await cameraCatalog.initialize();
  return { ...owner, cameraCatalog };
}

export async function openTestCluster(store, database, backups, options = {}) {
  const { catalogOwner: suppliedOwner, ...clusterOptions } = options;
  const owner = suppliedOwner ?? await openTestCatalog(database);
  const catalog = new ClusterCatalog(owner.transactions);
  const cluster = new Cluster(store, backups, { ...clusterOptions, catalog });
  await cluster.initialize();
  return {
    cluster,
    catalogOwner: owner,
    close: async () => {
      await cluster.stop();
      await owner.close();
    },
  };
}

export async function openTestHaCatalog(database = ':memory:') {
  const owner = await openTestCatalog(database);
  const { HaCatalog } = await import('@haus/hub/storage');
  const haCatalog = new HaCatalog(owner.transactions);
  await haCatalog.initialize();
  return { ...owner, haCatalog };
}
