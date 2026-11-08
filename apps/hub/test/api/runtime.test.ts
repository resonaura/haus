/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { listen, port, closeServer } from '../support/http.js';
import { test, onTestFinished } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeHaRuntime, HaRuntimeAdapter, type HaClientLike } from '@haus/ha/runtime';
import { ServiceCatalog } from '@haus/hub/servers';
import { Servers } from '@haus/hub/servers';
import { openTestRecordingStore } from '../support/recording.js';
import { createApi } from '@haus/hub/runtime';
import { openTestCatalog } from '../support/catalog.js';

async function setupStore() {
  const root = await mkdtemp(join(tmpdir(), 'haus-hub-runtime-'));
  const media = join(root, 'media');
  await mkdir(media);
  const store = await openTestRecordingStore(join(root, 'haus.sqlite'), media);
  const catalogOwner = await openTestCatalog(join(root, 'haus.sqlite'));
  const serviceCatalog = new ServiceCatalog(catalogOwner.transactions);
  await serviceCatalog.initialize();
  return {
    root,
    store,
    serviceCatalog,
    cleanup: async () => {
      await catalogOwner.close();
      await store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('Servers reflects injected HaRuntime connected state', async () => {
  const { store, serviceCatalog, cleanup } = await setupStore();
  onTestFinished(cleanup);

  const runtime = new FakeHaRuntime({ connected: true, status: { version: '2026.3.0' } });
  const config = { max_storage_gb: 0, retention_days: 7 };
  const servers = new Servers({ config, runtime, store, catalog: serviceCatalog });

  assert.equal(servers.isOnline(), true);
  const initial = await servers.status();
  assert.equal(initial.servers[0].online, true);

  // Transition runtime to disconnected
  runtime.setConnected(false);
  assert.equal(servers.isOnline(), false);
  const disconnected = await servers.status();
  assert.equal(disconnected.servers[0].online, false);
});

test('createApi exposes runtime connected status seamlessly with FakeHaRuntime', async () => {
  const { store, serviceCatalog, cleanup } = await setupStore();
  onTestFinished(cleanup);

  const runtime = new FakeHaRuntime({ connected: true, status: { version: '2026.3.0' } });
  const config = {
    apiToken: 'test-token',
    standalone: true,
    recording_enabled: false,
    max_storage_gb: 0,
    retention_days: 7,
  };

  const server = createApi({
    config,
    runtime,
    store,
    serviceCatalog,
    recorder: { status: () => [] },
  });

  await listen(server);
  const base = `http://127.0.0.1:${port(server)}`;

  onTestFinished(async () => {
    server.closeAllConnections();
    await closeServer(server);
  });

  const res = await fetch(`${base}/api/status`, {
    headers: { authorization: 'Bearer test-token' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.connected, true);

  runtime.setConnected(false);
  const res2 = await fetch(`${base}/api/status`, {
    headers: { authorization: 'Bearer test-token' },
  });
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.connected, false);
});

test('Servers polymorphically accepts both FakeHaRuntime and HaRuntimeAdapter', async () => {
  const { store, serviceCatalog, cleanup } = await setupStore();
  onTestFinished(cleanup);

  const mockClient: HaClientLike & { connected: boolean; stopped: boolean } = {
    connected: true,
    stopped: false,
    async request<T = unknown>() {
      return { version: '2026.4.0' } as T;
    },
    stop() {
      this.stopped = true;
      this.connected = false;
    },
  };

  const adapter = new HaRuntimeAdapter({
    client: mockClient,
    config: { base: 'http://127.0.0.1:8123', ws: 'ws://127.0.0.1:8123/api/websocket' },
  });
  const fake = new FakeHaRuntime({ connected: true });
  const config = { max_storage_gb: 0, retention_days: 7 };

  const serversWithAdapter = new Servers({
    config,
    runtime: adapter,
    store,
    catalog: serviceCatalog,
  });
  const serversWithFake = new Servers({ config, runtime: fake, store, catalog: serviceCatalog });

  assert.equal(serversWithAdapter.isOnline(), true);
  assert.equal(serversWithFake.isOnline(), true);

  const adapterStatus = await serversWithAdapter.status();
  const fakeStatus = await serversWithFake.status();

  assert.equal(adapterStatus.servers[0].online, true);
  assert.equal(fakeStatus.servers[0].online, true);

  // Stop client in adapter
  mockClient.stop();
  assert.equal(serversWithAdapter.isOnline(), false);

  // Disconnect fake
  fake.setConnected(false);
  assert.equal(serversWithFake.isOnline(), false);
});
