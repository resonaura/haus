/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { ClusterNodeEntity } from '../../src/storage/entities/domains.js';
import { deferred } from '../runtime/support.js';
import { fixture, sshServerId } from './fixture.js';

it('an SSH monitoring connection receives telemetry without camera, backup or storage work', async (t) => {
  const f = await fixture(t);
  const result = await f.cluster.add(f.input(await f.addPeer(), { sshServerId }));
  expect(result.nodes).toHaveLength(1);
  const node = result.nodes[0];
  expect(node?.sshServerId).toBe(sshServerId);
  expect(node?.roles).toEqual([]);
  expect(node?.remote?.host).toMatchObject({ cpu: { usage: 0.2 } });
  expect(result.pairedNodeId).toBe(node?.id);
  expect(node).not.toHaveProperty('key');
  await f.cluster.work();
  expect(f.requests.length).toBeGreaterThan(1);
  expect(f.requests.every((path) => path === '/v1/status')).toBe(true);
});

it('SSH associations are validated and unique across new and existing connections', async (t) => {
  const f = await fixture(t);
  const first = await f.cluster.add(f.input(await f.addPeer(), { sshServerId }));
  const secondUrl = await f.addPeer();
  await expect(f.cluster.add(f.input(secondUrl, { sshServerId }))).rejects.toThrow(
    'invalid_duplicate_ssh_server',
  );
  const second = await f.cluster.add(f.input(secondUrl));
  await expect(f.cluster.update(second.pairedNodeId, { sshServerId })).rejects.toThrow(
    'invalid_duplicate_ssh_server',
  );
  await expect(
    f.cluster.update(second.pairedNodeId, { sshServerId: 'home-assistant' }),
  ).rejects.toThrow('invalid_node');
  await f.cluster.update(first.pairedNodeId, { sshServerId: null });
  await f.cluster.update(second.pairedNodeId, { sshServerId });
  expect(f.cluster.nodes().find((node) => node.id === second.pairedNodeId)?.sshServerId).toBe(
    sshServerId,
  );
});

it('a monitoring-only agent cannot be enrolled for unavailable media roles', async (t) => {
  const f = await fixture(t);
  await expect(f.cluster.add(f.input(await f.addPeer(), { roles: ['storage'] }))).rejects.toThrow(
    'invalid_node_roles',
  );
  expect(f.cluster.nodes()).toHaveLength(0);
});

it('parallel enrollment cannot attach two helpers to the same SSH machine', async (t) => {
  const f = await fixture(t);
  const urls = await Promise.all([f.addPeer(), f.addPeer()]);
  const results = await Promise.allSettled(
    urls.map((url) => f.cluster.add(f.input(url, { sshServerId }))),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(f.cluster.nodes()).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')?.reason).toMatchObject({
    message: 'invalid_duplicate_ssh_server',
  });
});

it('stream-only helpers are not assigned recovery storage copies', async (t) => {
  const f = await fixture(t, ['stream']);
  await f.cluster.add(f.input(await f.addPeer()));
  await f.cluster.work();
  expect(f.requests.every((path) => path === '/v1/status')).toBe(true);
});

it('concurrent updates cannot claim the same SSH machine through independent catalog owners', async (t) => {
  const f = await fixture(t);
  const first = await f.cluster.add(f.input(await f.addPeer()));
  const second = await f.cluster.add(f.input(await f.addPeer()));
  const other = await f.independent();
  const results = await Promise.allSettled([
    f.cluster.update(first.pairedNodeId, { sshServerId }),
    other.cluster.update(second.pairedNodeId, { sshServerId }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')?.reason).toMatchObject({
    message: 'invalid_duplicate_ssh_server',
  });
  const rows = await f.source.manager.find(ClusterNodeEntity);
  expect(rows.filter((row) => row.value.includes(sshServerId))).toHaveLength(1);
});

it('an SSH association preserves newer persisted fields and survives reopening the catalog', async (t) => {
  const f = await fixture(t);
  const node = await f.cluster.add(f.input(await f.addPeer()));
  const other = await f.independent();
  await other.cluster.update(node.pairedNodeId, { livePriority: 88 });
  await f.cluster.update(node.pairedNodeId, { sshServerId });
  const reopened = await f.independent();
  expect(reopened.cluster.nodes()).toContainEqual(
    expect.objectContaining({
      id: node.pairedNodeId,
      livePriority: 88,
      sshServerId,
    }),
  );
});

it('a failed database commit rolls back enrollment without publishing a peer or backup change', async (t) => {
  const f = await fixture(t);
  const commit = vi
    .spyOn(f.source.createQueryRunner(), 'commitTransaction')
    .mockRejectedValueOnce(Error('fixture_commit_failed'));
  await expect(f.cluster.add(f.input(await f.addPeer(), { sshServerId }))).rejects.toThrow(
    'fixture_commit_failed',
  );
  commit.mockRestore();
  expect(await f.source.manager.count(ClusterNodeEntity)).toBe(0);
  expect(f.cluster.nodes()).toEqual([]);
  expect(f.cluster.health.size).toBe(0);
  expect(f.changed).not.toHaveBeenCalled();
  const retry = await f.cluster.add(f.input(await f.addPeer(), { sshServerId }));
  expect(retry.nodes).toHaveLength(1);
});

it('a stale configuration update cannot restore an SSH claim after it moved to another peer', async (t) => {
  const f = await fixture(t);
  const first = await f.cluster.add(f.input(await f.addPeer(), { sshServerId }));
  const other = await f.independent();
  await other.cluster.update(first.pairedNodeId, { sshServerId: null });
  const second = await other.cluster.add(f.input(await f.addPeer(), { sshServerId }));
  await f.cluster.update(first.pairedNodeId, { livePriority: 30 });
  const reopened = await f.independent();
  expect(
    reopened.cluster
      .nodes()
      .filter((node) => node.sshServerId === sshServerId)
      .map((node) => node.id),
  ).toEqual([second.pairedNodeId]);
  expect(
    reopened.cluster.nodes().find((node) => node.id === first.pairedNodeId)?.sshServerId,
  ).toBeNull();
});

it('a health identity refresh preserves newer configuration and SSH associations', async (t) => {
  const f = await fixture(t);
  const remote = { instanceId: 'before-restart' };
  const node = await f.cluster.add(f.input(await f.addPeer(remote)));
  const other = await f.independent();
  await other.cluster.update(node.pairedNodeId, { livePriority: 88 });
  await other.cluster.update(node.pairedNodeId, { sshServerId });
  remote.instanceId = 'after-restart';
  await f.cluster.poll();
  const reopened = await f.independent();
  expect(reopened.cluster.nodes()).toContainEqual(
    expect.objectContaining({
      id: node.pairedNodeId,
      livePriority: 88,
      sshServerId,
      instanceId: 'after-restart',
    }),
  );
});

it('a stale update cannot recreate a peer removed by another catalog owner', async (t) => {
  const f = await fixture(t);
  const node = await f.cluster.add(f.input(await f.addPeer()));
  const other = await f.independent();
  await other.cluster.remove(node.pairedNodeId);
  await expect(f.cluster.update(node.pairedNodeId, { enabled: false })).rejects.toThrow(
    'invalid_node',
  );
  await expect(f.cluster.update(node.pairedNodeId, { sshServerId })).rejects.toThrow(
    'invalid_node',
  );
  expect(await f.source.manager.count(ClusterNodeEntity)).toBe(0);
});

it('a failed association commit preserves persisted fields and the published snapshot', async (t) => {
  const f = await fixture(t);
  const node = await f.cluster.add(f.input(await f.addPeer()));
  const before = await f.source.manager.findOneByOrFail(ClusterNodeEntity, {
    id: node.pairedNodeId,
  });
  const snapshot = f.cluster.nodes();
  const changes = f.changed.mock.calls.length;
  const commit = vi
    .spyOn(f.source.createQueryRunner(), 'commitTransaction')
    .mockRejectedValueOnce(Error('fixture_association_commit_failed'));
  await expect(f.cluster.update(node.pairedNodeId, { sshServerId })).rejects.toThrow(
    'fixture_association_commit_failed',
  );
  commit.mockRestore();
  expect(
    await f.source.manager.findOneByOrFail(ClusterNodeEntity, { id: node.pairedNodeId }),
  ).toEqual(before);
  expect(f.cluster.nodes()).toEqual(snapshot);
  expect(f.changed).toHaveBeenCalledTimes(changes);
  await f.cluster.update(node.pairedNodeId, { sshServerId });
  expect(f.cluster.nodes().find((item) => item.id === node.pairedNodeId)?.sshServerId).toBe(
    sshServerId,
  );
});

it('normalizes an installed peer URL when checking a new identity claim without rewriting its stored row', async (t) => {
  const f = await fixture(t);
  const url = await f.addPeer();
  const legacy = {
    id: 'legacy-peer',
    value: JSON.stringify({ ...f.input(url + '/'), enabled: true }),
  };
  await f.cluster.catalog.saveNode(legacy);
  await expect(f.cluster.add(f.input(url))).rejects.toThrow('invalid_duplicate_node');
  expect(await f.source.manager.find(ClusterNodeEntity)).toEqual([legacy]);
  expect(f.changed).not.toHaveBeenCalled();
});

it('an omitted configuration field does not erase existing persisted configuration', async (t) => {
  const f = await fixture(t);
  const node = await f.cluster.add(f.input(await f.addPeer()));
  await f.cluster.update(node.pairedNodeId, { livePriority: 50 });
  const before = await f.source.manager.findOneByOrFail(ClusterNodeEntity, {
    id: node.pairedNodeId,
  });
  await f.cluster.catalog.patchNode(node.pairedNodeId, {
    enabled: undefined,
    livePriority: undefined,
    instanceId: undefined,
  });
  expect(
    await f.source.manager.findOneByOrFail(ClusterNodeEntity, { id: node.pairedNodeId }),
  ).toEqual(before);
});

for (const kind of ['url', 'ssh', 'independent'])
  it(`serializes concurrent ${kind} claims even when both handshakes finish before commit`, async (t) => {
    const f = await fixture(t);
    const other =
      kind === 'independent'
        ? await f.independent()
        : { cluster: f.cluster, transactions: f.transactions };
    const entered = deferred(),
      release = deferred();
    const blocker = f.transactions.run(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    let submitted = 0;
    for (const tx of new Set([f.transactions, other.transactions])) {
      const run = tx.run.bind(tx);
      vi.spyOn(tx, 'run').mockImplementation(
        <T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> => {
          submitted++;
          return run(operation);
        },
      );
    }
    const first = await f.addPeer(),
      second = kind === 'url' ? first + '/' : await f.addPeer();
    const association = kind === 'url' ? {} : { sshServerId };
    const attempts = Promise.allSettled([
      f.cluster.add(f.input(first, association)),
      other.cluster.add(f.input(second, association)),
    ]);
    let results: Awaited<typeof attempts>;
    try {
      await vi.waitFor(() => expect(submitted).toBe(2));
    } finally {
      release.resolve();
      await blocker;
      results = await attempts;
    }
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason).toMatchObject({
      message: kind === 'url' ? 'invalid_duplicate_node' : 'invalid_duplicate_ssh_server',
    });
    expect(await f.source.manager.count(ClusterNodeEntity)).toBe(1);
  });
