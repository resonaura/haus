/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { listen, port, closeServer } from '../support/http.js';
import { test, onTestFinished } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Servers, type ServersOptions } from '@haus/hub/servers';
import { openTestRecordingStore } from '../support/recording.js';
import { createApi } from '@haus/hub/runtime';
import { ServiceCatalog } from '@haus/hub/servers';
import { openTestCatalog } from '../support/catalog.js';
import type { HostTelemetrySnapshot } from '@haus/ha/node/host-telemetry';

const meminfo = 'MemTotal: 8000 kB\nMemAvailable: 3000 kB\nSwapTotal: 2000 kB\nSwapFree: 1500 kB\n';

function memoryDevice(size: number) {
  const raw = Buffer.alloc(32);
  raw[0] = 17;
  raw[1] = raw.length;
  raw.writeUInt16LE(size, 12);
  return raw;
}

async function fixture(standalone = false) {
  const root = await mkdtemp(join(tmpdir(), 'haus-servers-'));
  const media = join(root, 'media');
  await mkdir(media);
  const store = await openTestRecordingStore(join(root, 'haus.sqlite'), media);
  const catalogOwner = await openTestCatalog(join(root, 'haus.sqlite'));
  const catalog = new ServiceCatalog(catalogOwner.transactions);
  await catalog.initialize();
  const config = {
    standalone,
    token: 'private-supervisor-token',
    apiToken: 'fixture-api',
    max_storage_gb: 0,
    retention_days: 7,
    media,
  };
  let cpu = 100,
    idle = 100,
    at = 10000,
    changed = 0;
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const payloads: Record<string, unknown> = {
    '/host/info': {
      hostname: 'homeassistant',
      operating_system: 'Home Assistant OS',
      kernel: 'Linux',
      disk_total: 100,
      disk_free: 60,
      disk_used: 40,
      serial: 'do-not-leak',
    },
    '/core/info': { image: 'ha/core', arch: 'aarch64', secret: 'do-not-leak' },
    '/core/stats?one_shot=true': {
      cpu_percent: 12,
      memory_usage: 1000000,
      memory_limit: 2000000,
    },
    '/addons': {
      addons: [
        {
          slug: 'fixture',
          name: 'Fixture service',
          state: 'started',
          options: { password: 'private-option' },
        },
      ],
    },
    '/addons/fixture/stats?one_shot=true': {
      cpu_percent: 5,
      memory_usage: 2000,
      memory_limit: 8000,
    },
    '/host/disks': {
      disks: [
        {
          id: 'disk1',
          model: 'SSD',
          size: 1000,
          serial: 'private-serial',
          partitions: [{ uuid: 'vol1', label: 'Data', filesystem: 'ext4', size: 900 }],
        },
      ],
    },
  };
  const options: ServersOptions = {
    config,
    ha: { connected: true },
    store,
    catalog,
    cluster: {
      status: () => ({
        nodes: [
          {
            id: 'remote',
            name: 'Node',
            key: 'private-node-key',
            enabled: true,
            online: true,
            roles: ['storage'],
            remote: {
              settings: { storageLimitBytes: null, source: 'default' },
              host: {
                scope: 'container',
                disks: [
                  { id: 'disk-a', kind: 'disk', type: 'disk', physical: true },
                  {
                    id: 'volume-a',
                    kind: 'volume',
                    type: 'container',
                    physical: false,
                    parentIds: ['disk-a'],
                  },
                ],
              },
              storage: { availableBytes: 900 },
            },
          },
        ],
      }),
    },
    backups: { markChanged: () => { changed++; } },
    now: () => at,
    list: async (path: string) => (path === '/sys/firmware/dmi/entries' ? ['17-0', '17-1'] : []),
    read: async (path: string) =>
      path.endsWith('/17-0/raw')
        ? memoryDevice(8192)
        : path.endsWith('/17-1/raw')
          ? memoryDevice(8192)
          : path.endsWith('meminfo')
            ? meminfo
            : path.endsWith('uptime')
              ? '100 0'
              : path.endsWith('stat')
                ? `cpu ${cpu} 0 0 ${idle} 0 0 0 0\ncpu0 1\n`
                : path.endsWith('cpuinfo')
                  ? 'model name : Fixture CPU\n'
                  : '0.1 0.2 0.3 1/100 1',
    filesystem: async () => ({
      blocks: 100000000,
      bavail: 50000000,
      bsize: 4096,
    }),
    fetcher: async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
      const path = parsed.pathname + parsed.search;
      calls.push({ path, init });
      return new Response(JSON.stringify({ result: 'ok', data: payloads[path] ?? {} }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  const servers = new Servers(options);
  onTestFinished(async () => {
    await catalogOwner.close();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    servers,
    options,
    store,
    config,
    calls,
    changed: () => changed,
    advance: (ms = 5001) => {
      at += ms;
      cpu += 30;
      idle += 70;
    },
  };
}

test('aggregates real HA host and managed container samples, preserves unknown values and redacts options/keys', async () => {
  const f = await fixture();
  const first = await f.servers.status(),
    primary = first.servers[0]!,
    primaryHost = primary.host as HostTelemetrySnapshot,
    remoteHost = first.servers[1]!.host as Partial<HostTelemetrySnapshot>;
  assert.equal(primary.settings.storageLimitBytes, null);
  assert.equal(primaryHost.memory.totalBytes, 8000 * 1024);
  assert.equal(primaryHost.memory.installedBytes, 16 * 1024 ** 3);
  assert.equal(primaryHost.cpu.usage, null);
  assert.equal(
    (primaryHost.docker.containers as Array<{ id: string; memoryUsedBytes?: number }>).find(
      (x) => x.id === 'home-assistant-core',
    )?.memoryUsedBytes,
    1000000,
  );
  assert.equal(primaryHost.disks.find((x) => x.id === 'vol1')?.parentId, 'disk1');
  assert.equal(primaryHost.pm2.available, false);
  assert.equal(remoteHost.scope, 'container');
  assert.deepEqual(remoteHost.disks, [
    { id: 'disk-a', kind: 'disk', type: 'disk', physical: true },
    {
      id: 'volume-a',
      kind: 'volume',
      type: 'container',
      physical: false,
      parentIds: ['disk-a'],
    },
  ]);
  assert.equal(JSON.stringify(first).includes('private'), false);
  const count = f.calls.length;
  await f.servers.status();
  assert.equal(f.calls.length, count, 'hot polls use cached bounded sample');
  f.advance();
  const updatedHost = (await f.servers.status()).servers[0]!.host as HostTelemetrySnapshot;
  assert.ok(Math.abs((updatedHost.cpu.usage ?? 0) - 0.3) < 0.0001);
  assert.ok(f.calls.every((x) => x.init?.method === undefined && !x.path.includes('/host/stats')));
});

test('primary quota is unlimited by default, persists independently and never erases preferences', async () => {
  const f = await fixture();
  await f.store.setCamera('camera.fixture', { enabled: true });
  await f.servers.update({ storageLimitBytes: 50 * 1024 ** 3 });
  assert.equal(f.config.max_storage_gb, 50);
  assert.equal(new Servers(f.options).policy.storageLimitBytes, 50 * 1024 ** 3);
  assert.equal(f.changed(), 1);
  assert.deepEqual((await f.store.overrides())['camera.fixture'], { enabled: true });
  for (const patch of [
    {},
    { storageLimitBytes: -1 },
    { storageLimitBytes: '20' },
    { storageLimitBytes: Number.MAX_SAFE_INTEGER + 1 },
    { storageLimitBytes: null, enabled: true },
  ])
    await assert.rejects(() => f.servers.update(patch), /invalid_storage_limit/);
  await f.servers.update({ storageLimitBytes: null });
  assert.equal(f.config.max_storage_gb, 0);
  assert.equal(new Servers(f.options).policy.storageLimitBytes, null);
});

test('unavailable supervisor and standalone never mislabel local container stats as remote HA host metrics', async () => {
  const f = await fixture(true);
  const primary = (await f.servers.status()).servers[0]!,
    primaryHost = primary.host as HostTelemetrySnapshot;
  assert.equal(f.calls.length, 0);
  assert.equal(primaryHost.memory.totalBytes, null);
  assert.equal(primaryHost.cpu.usage, null);
  assert.equal(primaryHost.docker.available, false);
});

test('a failed durable policy write does not change the live quota or mark a backup dirty', async () => {
  const f = await fixture();
  const servers = new Servers({
    ...f.options,
    catalog: {
      policy: (id) => f.options.catalog.policy(id),
      savePolicy: async () => {
        throw new Error('fixture_storage_unavailable');
      },
    },
  });
  await assert.rejects(
    servers.update({ storageLimitBytes: 1024 ** 3 }),
    /fixture_storage_unavailable/,
  );
  assert.equal(servers.policy.storageLimitBytes, null);
  assert.equal(f.config.max_storage_gb, 0);
  assert.equal(f.changed(), 0);
});

test('server API is authenticated and HA quota writes require client JSON', async () => {
  const f = await fixture(true);
  const api = createApi({
    config: f.config,
    ha: f.options.ha,
    store: f.store,
    servers: f.servers,
    recorder: { status: () => [] },
    getRegistry: () => ({ cameras: [], states: [] }),
  });
  await listen(api);
  onTestFinished(async () => {
    api.closeAllConnections();
    await closeServer(api);
  });
  const url = `http://127.0.0.1:${port(api)}/api/servers`;
  assert.equal((await fetch(url)).status, 401);
  const headers = { Authorization: 'Bearer fixture-api' };
  assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal(
    (
      await fetch(`${url}/home-assistant`, {
        method: 'PATCH',
        headers,
        body: '{}',
      })
    ).status,
    400,
  );
  const response = await fetch(`${url}/home-assistant`, {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-Haus-Client': '1',
    },
    body: JSON.stringify({ storageLimitBytes: null }),
  });
  assert.equal(response.status, 200);
});

test(
  'slow app statistics share a strict collection budget and concurrent clients share one sample',
  { timeout: 7000 },
  async () => {
    const f = await fixture();
    let statsCalls = 0;
    const servers = new Servers({
      ...f.options,
      fetcher: async (url, init) => {
        const parsed = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
        const path = parsed.pathname;
        if (path === '/addons')
          return new Response(
            JSON.stringify({
              result: 'ok',
              data: {
                addons: Array.from({ length: 64 }, (_, i) => ({
                  slug: `service_${i}`,
                  name: `Service ${i}`,
                  state: 'started',
                })),
              },
            }),
          );
        if (path.startsWith('/addons/')) {
          statsCalls++;
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve(new Response('{}')), 5000);
            init?.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(init.signal?.reason);
              },
              { once: true },
            );
          });
        }
        return new Response(JSON.stringify({ result: 'ok', data: {} }));
      },
    });
    const started = performance.now();
    const [a, b] = await Promise.all([servers.status(), servers.status()]);
    assert.equal(a.servers[0]!.lastSeen, b.servers[0]!.lastSeen);
    assert.ok(
      performance.now() - started < 4000,
      'a dashboard read must not wait for 64 stalled app endpoints',
    );
    assert.ok(statsCalls <= 16);
    assert.equal(
      ((a.servers[0]!.host as HostTelemetrySnapshot).docker.containers as unknown[]).length,
      65,
      'a sampling deadline cannot hide installed containers',
    );
    const calls = statsCalls;
    await servers.status();
    assert.equal(statsCalls, calls);
  },
);

test('slightly early one-second polls refresh CPU/memory instead of returning a second cached sample', async () => {
  const f = await fixture();
  const first = await f.servers.status();
  const firstHost = first.servers[0]!.host as HostTelemetrySnapshot;
  assert.equal(firstHost.docker.cpuPercentBasis, 'host');
  const inventoryCalls = f.calls.length;
  f.advance(995);
  const second = await f.servers.status();
  const secondHost = second.servers[0]!.host as HostTelemetrySnapshot;
  assert.notEqual(secondHost.sampledAt, firstHost.sampledAt);
  assert.ok(Math.abs((secondHost.cpu.usage ?? 0) - 0.3) < 0.0001);
  assert.equal(secondHost.memory.totalBytes, firstHost.memory.totalBytes);
  assert.equal(f.calls.length, inventoryCalls);
  assert.deepEqual(secondHost.disks, firstHost.disks);
});

test('slow Supervisor metadata cannot hold the resource API behind its inventory refresh', async () => {
  const f = await fixture();
  await f.servers.status();
  const original = f.servers.telemetry.fetcher;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.servers.telemetry.fetcher = async (...args) => {
    await gate;
    return original(...args);
  };
  f.advance(10000);
  const live = await f.servers.status();
  const liveHost = live.servers[0]!.host as HostTelemetrySnapshot;
  assert.ok(f.servers.telemetry.inventoryRefresh);
  assert.ok(Math.abs((liveHost.cpu.usage ?? 0) - 0.3) < 0.0001);
  const sampledAt = liveHost.sampledAt;
  release();
  await f.servers.telemetry.inventoryRefresh;
  assert.equal(f.servers.telemetry.value?.sampledAt, sampledAt);
});
