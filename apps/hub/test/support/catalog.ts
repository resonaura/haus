/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { CameraCatalog, HaCatalog, openCatalog, Transactions } from '@haus/hub/storage';
import { Cluster, ClusterCatalog } from '@haus/hub/cluster';
import type { DataSource } from 'typeorm';

export interface TestCatalog {
  source: DataSource;
  transactions: Transactions;
  close(): Promise<void>;
}

export async function openTestCatalog(database: string): Promise<TestCatalog> {
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

export async function openTestCameraCatalog(
  database: string,
): Promise<TestCatalog & { cameraCatalog: CameraCatalog }> {
  const owner = await openTestCatalog(database);
  const cameraCatalog = new CameraCatalog(owner.transactions);
  await cameraCatalog.initialize();
  return { ...owner, cameraCatalog };
}

type ClusterArguments = ConstructorParameters<typeof Cluster>;

export interface TestClusterOptions {
  catalogOwner?: TestCatalog;
  now?: () => number;
}

export async function openTestCluster(
  store: ClusterArguments[0],
  database: string,
  backups: Partial<ClusterArguments[1]> & Pick<ClusterArguments[1], 'list'>,
  options: TestClusterOptions = {},
): Promise<{ cluster: Cluster; catalogOwner: TestCatalog; close(): Promise<void> }> {
  const { catalogOwner: suppliedOwner, ...clusterOptions } = options;
  const owner = suppliedOwner ?? (await openTestCatalog(database));
  const catalog = new ClusterCatalog(owner.transactions);
  const fallbackMethods: Omit<ClusterArguments[1], 'list'> = {
    path: () => '/unused',
    markChanged: () => {},
    retry: () => null,
    canSnapshot: () => false,
    snapshot: async () => null,
  };
  const record = backups as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(fallbackMethods)) {
    if (typeof record[key] !== 'function') {
      record[key] = fallback;
    }
  }
  const fullBackups = backups as ClusterArguments[1];
  const cluster = new Cluster(store, fullBackups, { ...clusterOptions, catalog });
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

export async function openTestHaCatalog(
  database = ':memory:',
): Promise<TestCatalog & { haCatalog: HaCatalog }> {
  const owner = await openTestCatalog(database);
  const haCatalog = new HaCatalog(owner.transactions);
  await haCatalog.initialize();
  return { ...owner, haCatalog };
}
