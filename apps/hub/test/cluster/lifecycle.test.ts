/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it, vi } from 'vitest';
import type { ServerResponse } from 'node:http';
import type { EntityManager } from 'typeorm';
import { ClusterNodeEntity } from '../../src/storage/entities/domains.js';
import { CatalogLifetime } from '../../src/storage/lifetime.js';
import { openCatalog } from '../../src/storage/index.js';
import { deferred } from '../runtime/support.js';
import { fixture, sshServerId } from './fixture.js';

it('publishes a single stop before synchronous abort reentry and does not repeat cleanup', async (t) => {
  const f = await fixture(t);
  let nested: Promise<void> | undefined;
  f.cluster.abort.signal.addEventListener(
    'abort',
    () => {
      nested = f.cluster.stop();
    },
    { once: true },
  );
  const stopping = f.cluster.stop();
  expect(f.cluster.stop()).toBe(stopping);
  await stopping;
  expect(nested).toBe(stopping);
  expect(f.cluster.stop()).toBe(stopping);
});

for (const kind of ['update', 'remove'])
  it(`rejects ${kind} after stop without changing the catalog`, async (t) => {
    const f = await fixture(t);
    const node = await f.cluster.add(f.input(await f.addPeer()));
    const before = await f.source.manager.find(ClusterNodeEntity);
    const changed = f.changed.mock.calls.length;
    const requests = f.requests.length;
    await f.cluster.stop();
    const result =
      kind === 'update'
        ? f.cluster.update(node.pairedNodeId, { sshServerId })
        : f.cluster.remove(node.pairedNodeId);
    await expect(result).rejects.toThrow('cluster_stopped');
    expect(await f.source.manager.find(ClusterNodeEntity)).toEqual(before);
    expect(f.changed).toHaveBeenCalledTimes(changed);
    expect(f.requests).toHaveLength(requests);
  });

it('rejects enrollment after stop before contacting a peer or publishing state', async (t) => {
  const f = await fixture(t);
  const url = await f.addPeer();
  await f.cluster.stop();
  await expect(f.cluster.add(f.input(url))).rejects.toThrow('cluster_stopped');
  expect(f.requests).toEqual([]);
  expect(await f.source.manager.count(ClusterNodeEntity)).toBe(0);
  expect(f.changed).not.toHaveBeenCalled();
});

for (const kind of ['add', 'update', 'remove'])
  it(`keeps the catalog alive until an admitted ${kind} transaction completes`, async (t) => {
    const f = await fixture(t);
    const node = kind === 'add' ? undefined : await f.cluster.add(f.input(await f.addPeer()));
    const peer = kind === 'add' ? await f.addPeer() : '';
    const entered = deferred(),
      release = deferred();
    const blocker = f.transactions.run(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    let submitted = 0;
    const run = f.transactions.run.bind(f.transactions);
    vi.spyOn(f.transactions, 'run').mockImplementation(
      <T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> => {
        submitted++;
        return run(operation);
      },
    );
    const lifetime = new CatalogLifetime(f.source, f.transactions);
    const stopped = vi.fn();
    let failure: unknown;
    const mutation =
      kind === 'add'
        ? f.cluster.add(f.input(peer))
        : kind === 'update'
          ? f.cluster.update(node?.pairedNodeId ?? '', { livePriority: 42 })
          : f.cluster.remove(node?.pairedNodeId ?? '');
    const result = mutation.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    let closing: Promise<void> | undefined;
    try {
      await vi.waitFor(() => expect(submitted).toBe(1));
      lifetime.defer(() => f.cluster.stop().then(stopped));
      lifetime.deferStore(() => f.store.close());
      closing = lifetime.close();
      await vi.waitFor(() => expect(f.cluster.stopped).toBe(true));
      // Joining an unrelated admitted transaction must not stand in for draining the owner.
      await Promise.resolve();
      expect(stopped).not.toHaveBeenCalled();
      expect(f.source.isInitialized).toBe(true);
    } finally {
      release.resolve();
      await blocker;
      failure = await result;
      await closing;
    }
    expect(failure).not.toHaveProperty('error');
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(f.source.isInitialized).toBe(false);
    const reopened = await openCatalog(f.file);
    try {
      const rows = await reopened.manager.find(ClusterNodeEntity);
      if (kind === 'remove') expect(rows).toEqual([]);
      else {
        expect(rows).toHaveLength(1);
        const row = rows[0];
        if (!row) throw Error('missing committed fixture peer');
        if (kind === 'update') expect(JSON.parse(row.value)).toMatchObject({ livePriority: 42 });
        else expect(failure).toMatchObject({ value: { pairedNodeId: row.id } });
      }
    } finally {
      await reopened.destroy();
    }
  });

it('keeps storage alive before a mutation enters SQL, then preserves its commit failure without replay', async (t) => {
  const f = await fixture(t);
  const node = await f.cluster.add(f.input(await f.addPeer()));
  const before = await f.source.manager.findOneByOrFail(ClusterNodeEntity, {
    id: node.pairedNodeId,
  });
  const changes = f.changed.mock.calls.length;
  const entered = deferred(),
    release = deferred();
  const patch = f.cluster.catalog.patchNode.bind(f.cluster.catalog);
  vi.spyOn(f.cluster.catalog, 'patchNode').mockImplementation(async (id, update) => {
    entered.resolve();
    await release.promise;
    return patch(id, update);
  });
  const failure = Error('fixture_commit_failure');
  const commit = vi
    .spyOn(f.source.createQueryRunner(), 'commitTransaction')
    .mockRejectedValueOnce(failure);
  const lifetime = new CatalogLifetime(f.source, f.transactions);
  lifetime.defer(() => f.cluster.stop());
  lifetime.deferStore(() => f.store.close());
  const mutation = f.cluster.update(node.pairedNodeId, { livePriority: 42 });
  const outcome = mutation.then(
    () => ({ ok: true }),
    (error: unknown) => ({ error }),
  );
  let closing: Promise<void> | undefined;
  try {
    await entered.promise;
    closing = lifetime.close();
    await vi.waitFor(() => expect(f.cluster.stopped).toBe(true));
    expect(f.source.isInitialized).toBe(true);
    expect(lifetime.state).toBe('closing');
  } finally {
    release.resolve();
    await outcome;
    await closing;
  }
  expect(await outcome).toEqual({ error: failure });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(f.changed).toHaveBeenCalledTimes(changes);
  expect(lifetime.state).toBe('closed');
  await f.cluster.stop();
  expect(commit).toHaveBeenCalledTimes(1);
  const reopened = await openCatalog(f.file);
  try {
    expect(await reopened.manager.find(ClusterNodeEntity)).toEqual([before]);
  } finally {
    await reopened.destroy();
  }
});

it('cancels an admitted enrollment before contacting the peer', async (t) => {
  const f = await fixture(t);
  const peer = await f.addPeer();
  const mutation = f.cluster.add(f.input(peer));
  const rejected = expect(mutation).rejects.toMatchObject({ name: 'AbortError' });
  const stopping = f.cluster.stop();
  await Promise.all([rejected, stopping]);
  expect(f.requests).toEqual([]);
  expect(f.changed).not.toHaveBeenCalled();
  expect(await f.source.manager.count(ClusterNodeEntity)).toBe(0);
});

it('settles an aborted remote settings request before stop and never retries the uncertain mutation', async (t) => {
  const f = await fixture(t);
  const entered = deferred(),
    closed = deferred();
  let patches = 0;
  const url = await f.addPeer({}, (req, res) => {
    if (req.url !== '/v1/settings' || req.method !== 'PATCH') {
      res.writeHead(500).end();
      return;
    }
    patches++;
    req.resume();
    res.once('close', closed.resolve);
    entered.resolve();
  });
  const node = await f.cluster.add(f.input(url));
  let settled = false;
  const mutation = f.cluster.update(node.pairedNodeId, { storageLimitBytes: null });
  const outcome = mutation.then(
    () => {
      settled = true;
      return { ok: true };
    },
    (error: unknown) => {
      settled = true;
      return { error };
    },
  );
  await entered.promise;
  await f.cluster.stop();
  expect(settled).toBe(true);
  expect(await outcome).toHaveProperty('error');
  await closed.promise;
  await f.cluster.stop();
  await expect(f.cluster.update(node.pairedNodeId, { storageLimitBytes: null })).rejects.toThrow(
    'cluster_stopped',
  );
  expect(patches).toBe(1);
});

it('captures enrollment input before the caller can mutate the original payload', async (t) => {
  const f = await fixture(t);
  const original = await f.addPeer(),
    replacement = await f.addPeer();
  const input = f.input(original);
  const mutation = f.cluster.add(input);
  input.url = replacement;
  input.name = 'Changed after submission';
  const result = await mutation;
  expect(f.cluster.nodes()).toContainEqual(
    expect.objectContaining({
      id: result.pairedNodeId,
      url: original,
      name: 'Monitoring fixture',
    }),
  );
});

it('captures a configuration patch before the caller changes it after submission', async (t) => {
  const f = await fixture(t);
  const node = await f.cluster.add(f.input(await f.addPeer()));
  const patch = { livePriority: 42 };
  const mutation = f.cluster.update(node.pairedNodeId, patch);
  patch.livePriority = 90;
  await mutation;
  expect(f.cluster.nodes().find((item) => item.id === node.pairedNodeId)?.livePriority).toBe(42);
});

it('compares a remote settings acknowledgement to the submitted payload even if the caller changes its object', async (t) => {
  const f = await fixture(t);
  const entered = deferred();
  let reply: ServerResponse | undefined,
    body = '';
  const url = await f.addPeer({}, (req, res) => {
    if (req.url !== '/v1/settings' || req.method !== 'PATCH') {
      res.writeHead(500).end();
      return;
    }
    reply = res;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.once('end', entered.resolve);
  });
  const node = await f.cluster.add(f.input(url));
  const patch = { storageLimitBytes: 1024 ** 2 };
  const mutation = f.cluster.update(node.pairedNodeId, patch);
  const result = mutation.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await entered.promise;
  expect(JSON.parse(body)).toEqual({ storageLimitBytes: 1024 ** 2 });
  patch.storageLimitBytes = 2 * 1024 ** 2;
  if (!reply) throw Error('missing fixture acknowledgement');
  reply
    .writeHead(200, { 'content-type': 'application/json' })
    .end(JSON.stringify({ storageLimitBytes: 1024 ** 2 }));
  expect(await result).not.toHaveProperty('error');
  expect(f.cluster.health.get(node.pairedNodeId)?.remote?.settings?.storageLimitBytes).toBe(
    1024 ** 2,
  );
});
