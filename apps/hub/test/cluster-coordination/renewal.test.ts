/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { openCatalog, Transactions } from '../../src/storage/index.js';
import { ClusterStateStore } from '../../src/cluster/coordination/state.js';
import {
  ClusterWorkloadEntity,
  type ClusterWorkloadRow,
} from '../../src/storage/cluster/entities.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function workload(id: string, ownerHubId = 'local', state = 'active'): ClusterWorkloadRow {
  return {
    workloadId: id, kind: 'integration', name: id, ownerHubId, state,
    standbyHubIdsJson: '[]', generation: 2, epoch: 1, leaseExpiresAt: 10,
    configRevision: 1, credentialRevision: 1, cacheRevision: 1,
    requirementsJson: '{}', preferredHubId: null, updatedAt: 1,
  };
}

async function fixture(): Promise<{
  source: DataSource;
  transactions: Transactions;
  store: ClusterStateStore;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'haus-renewal-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const source = await openCatalog(join(dir, 'catalog.sqlite'));
  cleanup.push(() => source.destroy());
  const transactions = new Transactions(source);
  const store = new ClusterStateStore(transactions, dir);
  await store.ensureInitialized({ hubId: 'local', homeId: 'home' });
  await store.saveState({ coordinatorEpoch: 3 });
  return { source, transactions, store };
}

describe('durable lease heartbeat', () => {
  it('commits the full local/online-peer heartbeat together and preserves ownership', async () => {
    const { source, transactions, store } = await fixture();
    const rows = Array.from({ length: 43 }, (_, i) => workload(`local-${i}`));
    rows.push(workload('online', 'peer'), workload('offline', 'absent'), workload('stopped', 'local', 'stopped'));
    for (const row of rows) await store.saveWorkload(row);
    const run = vi.spyOn(transactions, 'run');
    expect(await store.renewWorkloadLeases(1000, 60000, new Set(['peer']))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    const durable = await source.manager.find(ClusterWorkloadEntity);
    for (const original of rows) {
      const expected = original.state === 'active' && original.ownerHubId !== 'absent'
        ? { ...original, epoch: 3, leaseExpiresAt: 61000, updatedAt: 1000 }
        : original;
      expect(durable.find(row => row.workloadId === original.workloadId)).toEqual(expected);
      expect(store.getWorkloadSync(original.workloadId)).toEqual(expected);
    }
  });

  it('rolls back the entire heartbeat and leaves the execution cache unchanged on storage failure', async () => {
    const { source, store } = await fixture();
    const rows = [workload('first'), workload('second')];
    for (const row of rows) await store.saveWorkload(row);
    await source.query(`CREATE TRIGGER reject_renewal BEFORE UPDATE ON cluster_workloads
      WHEN NEW.workload_id = 'second' BEGIN SELECT RAISE(ABORT, 'storage_failure'); END`);
    await expect(store.renewWorkloadLeases(1000, 60000)).rejects.toThrow('storage_failure');
    expect(await source.manager.find(ClusterWorkloadEntity)).toEqual(rows);
    expect(store.listWorkloadsSync()).toEqual(rows);
  });

  it.each(['node', 'fenced'] as const)('denies renewal from a %s even if its cache was previously local', async role => {
    const { source, store } = await fixture();
    const row = workload('owned');
    await store.saveWorkload(row);
    await store.saveState({ role, fenced: role === 'fenced' });
    expect(await store.renewWorkloadLeases(1000, 60000, new Set(['peer']))).toBe(false);
    expect(await source.manager.find(ClusterWorkloadEntity)).toEqual([row]);
    expect(store.getWorkloadSync(row.workloadId)).toEqual(row);
  });
});
