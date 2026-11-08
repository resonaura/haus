/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { listen, port, closeServer } from '../support/http.js';
import { test, onTestFinished } from 'vitest';
import { createServer, type RequestListener, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Servers, ServiceCatalog } from '@haus/hub/servers';
import type { ClusterBackups, ClusterNodeRemoteHost } from '@haus/hub/cluster';
import { openTestRecordingStore } from '../support/recording.js';
import { openTestCluster } from '../support/catalog.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function fixture(handle: RequestListener) {
  const root = await mkdtemp(join(tmpdir(), 'haus-cluster-health-'));
  const media = join(root, 'media');
  await mkdir(media);
  const store = await openTestRecordingStore(join(root, 'haus.sqlite'), media);
  const server = createServer(handle);
  await listen(server);
  let at = 0;
  const backups: Partial<ClusterBackups> & Pick<ClusterBackups, 'list' | 'markChanged'> = {
    list: () => [],
    markChanged() {},
  };
  const opened = await openTestCluster(store, join(root, 'haus.sqlite'), backups, {
    now: () => at,
  });
  const { cluster } = opened;
  const serviceCatalog = new ServiceCatalog(opened.catalogOwner.transactions);
  await serviceCatalog.initialize();
  const add = async (id = 'fixture-node') => {
    const node = {
      id,
      name: id,
      instanceId: 'fixture-instance',
      enabled: true,
      roles: ['storage'],
      url: `http://127.0.0.1:${port(server)}`,
      allowHttp: true,
      key: 'fixture-node-key-'.repeat(3),
    };
    await cluster.catalog.saveNode({ id: node.id, value: JSON.stringify(node) });
    cluster.invalidateHealth();
    return node;
  };
  onTestFinished(async () => {
    await cluster.stop();
    await opened.catalogOwner.close();
    await store.close();
    server.closeAllConnections();
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  });
  return {
    store,
    cluster,
    backups,
    serviceCatalog,
    media,
    add,
    advance: (ms = 5000) => (at += ms),
    now: () => at,
  };
}
const reply = (res: ServerResponse, usage = 0.1) =>
  res.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      protocol: 1,
      instanceId: 'fixture-instance',
      host: {
        sampledAt: new Date().toISOString(),
        cpu: { usage },
        docker: {
          available: true,
          containers: [{ id: 'fixture-container', cpuPercent: usage * 100 }],
        },
      },
      storage: { usedBytes: 10, maxBytes: 100 },
      streams: { active: 0, max: 1 },
    }),
  );

test('health refreshes coalesce, cache completed attempts and retry after the bounded interval', async () => {
  const gate = deferred();
  let requests = 0;
  const f = await fixture(async (_req, res) => {
    requests++;
    await gate.promise;
    reply(res);
  });
  await f.add();
  const first = f.cluster.refreshHealth();
  assert.equal(f.cluster.refreshHealth(), first);
  gate.resolve();
  await first;
  assert.equal(requests, 1);
  await f.cluster.refreshHealth();
  f.advance(249);
  await f.cluster.refreshHealth();
  assert.equal(requests, 1);
  f.advance(746);
  await f.cluster.refreshHealth();
  assert.equal(requests, 2);
  const forced = f.cluster.refreshHealth({ force: true });
  assert.equal(f.cluster.refreshHealth({ force: true }), forced);
  await forced;
  assert.equal(requests, 3, 'copy boundaries bypass the TTL without overlapping requests');
});

test('server reads receive fresh process/resource reports while replication is still running', async () => {
  let usage = 0.1,
    requests = 0;
  const f = await fixture((_req, res) => {
    requests++;
    reply(res, usage);
  });
  await f.add();
  const copying = deferred(),
    finishCopy = deferred();
  f.cluster.backups.list = () => [{ digest: 'a'.repeat(64), kind: 'config', createdAt: 0, bytes: 0 }];
  f.cluster.backups.path = () => '/unused-fixture-backup';
  f.cluster.replicate = async () => {
    copying.resolve();
    await finishCopy.promise;
  };
  f.cluster.abort.signal.addEventListener('abort', () => finishCopy.resolve(), {
    once: true,
  });
  const distribution = f.cluster.tick();
  await copying.promise;
  assert.equal(f.cluster.busy, true);
  assert.equal(requests, 1);
  const servers = new Servers({
    catalog: f.serviceCatalog,
    store: f.store,
    cluster: f.cluster,
    backups: f.backups,
    ha: { connected: true },
    config: { standalone: true, max_storage_gb: 0, media: f.media },
    now: f.now,
    filesystem: async () => ({ blocks: 1000, bsize: 4096, bavail: 500 }),
  });
  usage = 0.8;
  f.advance();
  await Promise.all([servers.status(), servers.status()]);
  await f.cluster.healthRefresh;
  const reports = await Promise.all([servers.status(), servers.status()]);
  assert.equal(requests, 2);
  const firstHost = reports[0].servers[1]!.host as ClusterNodeRemoteHost;
  const secondHost = reports[1].servers[1]!.host as ClusterNodeRemoteHost;
  assert.equal(firstHost.cpu!.usage, 0.8);
  assert.equal(firstHost.docker!.containers![0]!.cpuPercent, 80);
  assert.equal(secondHost.cpu!.usage, 0.8);
  assert.equal(f.cluster.busy, true, 'the archive has not finished');
  finishCopy.resolve();
  await distribution;
  assert.equal(requests, 4, 'both archive synchronization boundaries force a fresh report');
});

test('a forced boundary queues one fresh pass after an older dashboard request', async () => {
  const received = deferred(),
    release = deferred();
  let requests = 0;
  const f = await fixture(async (_req, res) => {
    const current = ++requests;
    if (current === 1) {
      received.resolve();
      await release.promise;
    }
    reply(res, current === 1 ? 0.1 : 0.8);
  });
  const node = await f.add();
  const dashboard = f.cluster.refreshHealth();
  await received.promise;
  const boundary = f.cluster.refreshHealth({ force: true });
  assert.equal(f.cluster.refreshHealth({ force: true }), boundary);
  assert.equal(requests, 1, 'forced work does not overlap the earlier request');
  release.resolve();
  await dashboard;
  await boundary;
  assert.equal(requests, 2);
  assert.equal(f.cluster.health.get(node.id)!.remote!.host!.cpu!.usage, 0.8);
});

test('failed health requests retain the last-known report and are retried after the TTL', async () => {
  let failed = false,
    requests = 0;
  const f = await fixture((_req, res) => {
    requests++;
    if (failed) res.writeHead(503).end();
    else reply(res);
  });
  const node = await f.add();
  await f.cluster.refreshHealth();
  const previous = f.cluster.health.get(node.id)!;
  failed = true;
  f.advance();
  await f.cluster.refreshHealth();
  const unavailable = f.cluster.health.get(node.id)!;
  assert.equal(unavailable.online, false);
  assert.equal(unavailable.remote, previous.remote);
  assert.equal(unavailable.lastSeen, previous.lastSeen);
  await f.cluster.refreshHealth();
  assert.equal(requests, 2, 'failure does not create an immediate retry loop');
  failed = false;
  f.advance();
  await f.cluster.refreshHealth();
  assert.equal(f.cluster.health.get(node.id)!.online, true);
  assert.equal(requests, 3);
});

test('health requests retain the existing four-node concurrency bound', async () => {
  const saturated = deferred(),
    release = deferred();
  let requests = 0,
    active = 0,
    peak = 0;
  const f = await fixture(async (_req, res) => {
    requests++;
    active++;
    peak = Math.max(peak, active);
    if (active === 4) saturated.resolve();
    await release.promise;
    active--;
    reply(res);
  });
  for (let index = 0; index < 6; index++) await f.add(`node-${index}`);
  const refreshing = f.cluster.refreshHealth();
  await saturated.promise;
  assert.equal(requests, 4);
  assert.equal(peak, 4);
  release.resolve();
  await refreshing;
  assert.equal(requests, 6);
  assert.equal(peak, 4);
});

test('shutdown aborts outstanding status requests and settles the health lifecycle', async () => {
  const received = deferred(),
    closed = deferred();
  let requests = 0;
  const f = await fixture((_req, res) => {
    requests++;
    res.once('close', () => closed.resolve());
    received.resolve();
  });
  await f.add();
  const refreshing = f.cluster.refreshHealth();
  await received.promise;
  const forced = f.cluster.refreshHealth({ force: true });
  await f.cluster.stop();
  await refreshing;
  await forced;
  await closed.promise;
  assert.equal(f.cluster.healthRefresh, undefined);
  assert.equal(f.cluster.forcedHealthRefresh, undefined);
  await f.cluster.refreshHealth();
  assert.equal(requests, 1);
});

test(
  'server reads return last-known data without waiting behind a hung peer',
  { timeout: 3000 },
  async () => {
    const received = deferred(),
      release = deferred();
    const f = await fixture(async (_req, res) => {
      received.resolve();
      await release.promise;
      reply(res, 0.8);
    });
    const node = await f.add();
    f.cluster.health.set(node.id, {
      online: true,
      lastSeen: 0,
      remote: {
        host: { sampledAt: new Date(0).toISOString(), cpu: { usage: 0.1 } },
      },
    });
    const refreshing = f.cluster.refreshHealth();
    await received.promise;
    const servers = new Servers({
      catalog: f.serviceCatalog,
      store: f.store,
      cluster: f.cluster,
      backups: f.backups,
      ha: { connected: true },
      config: { standalone: true, max_storage_gb: 0, media: f.media },
      now: f.now,
      filesystem: async () => ({ blocks: 1000, bsize: 4096, bavail: 500 }),
    });
    const before = await servers.status();
    assert.equal((before.servers[1]!.host as ClusterNodeRemoteHost).cpu!.usage, 0.1);
    assert.equal(
      f.cluster.healthRefresh,
      refreshing,
      'status returned while the node is still pending',
    );
    release.resolve();
    await refreshing;
    const after = await servers.status();
    assert.equal((after.servers[1]!.host as ClusterNodeRemoteHost).cpu!.usage, 0.8);
  },
);

test('a rejected background refresh does not reject the server response or leak an unhandled promise', async () => {
  const f = await fixture((_req, res) => reply(res));
  f.cluster.poll = async () => {
    throw new Error('fixture-collection-failure');
  };
  const servers = new Servers({
    catalog: f.serviceCatalog,
    store: f.store,
    cluster: f.cluster,
    backups: f.backups,
    ha: { connected: true },
    config: { standalone: true, max_storage_gb: 0, media: f.media },
    now: f.now,
    filesystem: async () => ({ blocks: 1000, bsize: 4096, bavail: 500 }),
  });
  const status = await servers.status();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status.servers[0]!.id, 'home-assistant');
  assert.equal(f.cluster.healthRefresh, undefined);
});

test('an in-flight response cannot restore a node removed from the home', async () => {
  const received = deferred(),
    release = deferred();
  const f = await fixture(async (_req, res) => {
    received.resolve();
    await release.promise;
    reply(res);
  });
  const node = await f.add();
  const refreshing = f.cluster.refreshHealth();
  await received.promise;
  await f.cluster.remove(node.id);
  release.resolve();
  await refreshing;
  assert.equal(f.cluster.health.has(node.id), false);
  assert.equal(f.cluster.healthSampledAt, undefined);
});
