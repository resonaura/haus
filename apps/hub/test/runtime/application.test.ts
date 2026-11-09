/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createHubService } from '../../src/runtime/application.js';
import { runtimeConfig } from '../../src/runtime/config.js';
import { NvrRuntime } from '../../src/runtime/nvr.js';
import { RecordingIndex } from '../../src/nvr/recording-index.js';
import { sign } from '../../src/nvr/auth.js';
import { createNestApp } from '../../src/nest.js';
import { RecordingStore } from '../../src/events/recording.store.js';
import { CATALOG_SOURCE } from '../../src/storage/storage.module.js';
import type { DataSource } from 'typeorm';
import { dependencies, environment, key, deferred } from './support.js';

it('preserves HAUS_MEDIA through the actual Hub/Nest composition without opening another recording catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-media-'));
  const directory = join(root, 'configured-footage');
  const stores: RecordingStore[] = [];
  const service = createHubService({
    env: { HAUS_DATA_DIR: root, HAUS_MEDIA: directory, PORT: '0', HAUS_BIND_ADDRESS: '127.0.0.1', HAUS_MDNS_ADVERTISE: '0' },
    createApp: async (options) => {
      const app = await createNestApp(options);
      const store = app.get(RecordingStore);
      expect(store.source).toBe(app.get(CATALOG_SOURCE));
      stores.push(store);
      return app;
    },
  });
  try {
    await service.start();
    const store = stores.at(0);
    if (!store) throw Error('missing recording store');
    expect(store.media).toBe(directory);
    expect(await readdir(directory)).toEqual([]);
    await service.stop();
    expect(store.source.isInitialized).toBe(false);
  } finally {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('composes monitoring and Hub on one listener, drains incomplete uploads, and closes each owner once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-app-'));
  const ports = dependencies();
  let port = 0;
  const service = createHubService({
    env: { ...environment(root), HAUS_ROLES: 'storage' },
    nvr: ports.ports,
    ready: (_config, value) => {
      port = value;
    },
  });
  try {
    await service.start();
    expect(service.state).toBe('running');
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(base + '/health')).status).toBe(200);
    const status = await fetch(base + '/v1/status', {
      headers: { ...sign(key, 'GET', '/v1/status') },
    }).then((value) => value.json());
    expect(status.roles).toEqual(['storage']);
    expect(ports.spawn).not.toHaveBeenCalled();
    expect(await readdir(root)).not.toContain('camera-runtime');
    expect(await readdir(root)).toEqual(
      expect.arrayContaining(['haus.sqlite', 'hub-stats.sqlite', 'recordings.sqlite']),
    );
    const hash = createHash('sha256').update('unfinished').digest('hex');
    const path = '/v1/blobs/' + hash;
    const upload = request(base + path, {
      method: 'PUT',
      headers: { ...sign(key, 'PUT', path, hash), 'content-length': '100000' },
    });
    upload.on('error', () => {});
    upload.flushHeaders();
    upload.write('unfinished');
    const closed = new Promise<void>((resolve) => upload.once('close', resolve));
    await Promise.all([service.stop(), service.stop(), closed]);
    expect(service.state).toBe('closed');
    expect(ports.hostStop).toHaveBeenCalledTimes(1);
    expect(ports.capacityStop).toHaveBeenCalledTimes(1);
    await expect(fetch(base + '/health')).rejects.toThrow();
    expect(await readdir(join(root, 'blobs'))).toEqual([]);
  } finally {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('cleans an opened recording database and initialized capacity when telemetry startup fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-failure-'));
  const ports = dependencies();
  ports.initialize.mockRejectedValue(Error('fixture_initialization_failed'));
  const close = vi.spyOn(RecordingIndex.prototype, 'close');
  const service = createHubService({ env: environment(root), nvr: ports.ports });
  try {
    await expect(service.start()).rejects.toThrow('fixture_initialization_failed');
    expect(ports.hostStop).toHaveBeenCalledTimes(1);
    expect(ports.capacityStop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    const instance = close.mock.contexts[0];
    expect(instance).toBeInstanceOf(RecordingIndex);
    if (!(instance instanceof RecordingIndex)) throw Error('missing_recording_owner');
    expect(instance.source.isInitialized).toBe(false);
  } finally {
    close.mockRestore();
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('cancels pending startup and joins cleanup before stop resolves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-cancel-'));
  const ports = dependencies();
  const entered = deferred(),
    release = deferred();
  ports.initialize.mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return ports.host;
  });
  const createApp = vi.fn();
  const service = createHubService({ env: environment(root), nvr: ports.ports, createApp });
  try {
    const starting = service.start();
    const rejected = expect(starting).rejects.toThrow();
    await entered.promise;
    const stopping = service.stop();
    release.resolve();
    await Promise.all([rejected, stopping]);
    expect(createApp).not.toHaveBeenCalled();
    expect(ports.hostStop).toHaveBeenCalledTimes(1);
    expect(ports.capacityStop).toHaveBeenCalledTimes(1);
    expect(service.state).toBe('closed');
  } finally {
    release.resolve();
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('releases all NVR resources when the Nest listener cannot bind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-bind-'));
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const address = occupied.address();
  if (!address || typeof address === 'string') throw Error('missing_fixture_port');
  const ports = dependencies();
  const service = createHubService({
    env: { ...environment(root), PORT: String(address.port) },
    nvr: ports.ports,
  });
  try {
    await expect(service.start()).rejects.toThrow();
    expect(ports.hostStop).toHaveBeenCalledTimes(1);
    expect(ports.capacityStop).toHaveBeenCalledTimes(1);
  } finally {
    await service.stop();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

it('exposes corrupt optional camera policy as unavailable and stops the remaining media runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-media-'));
  const ports = dependencies();
  for (const file of ['camera-access.enc', 'camera-continuity.enc', 'camera-activity.enc'])
    await writeFile(join(root, file), 'invalid encrypted state');
  const config = await runtimeConfig({ ...environment(root), HAUS_ROLES: 'stream' });
  if (!config.nvr) throw Error('missing_fixture_config');
  const runtime = await NvrRuntime.open(config.nvr, new AbortController().signal, ports.ports);
  try {
    expect(runtime.options.cameraAccess).toBeUndefined();
    expect(runtime.options.continuity).toBeUndefined();
    expect(runtime.options.cameraActivity).toBeUndefined();
    expect(ports.diagnostic.mock.calls.map((value) => value[0])).toEqual([
      'camera_access_unavailable',
      'camera_continuity_unavailable',
      'camera_activity_unavailable',
    ]);
    expect(ports.spawn).not.toHaveBeenCalled();
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
  expect(ports.hostStop).toHaveBeenCalledTimes(1);
});

it('attempts remaining media and Nest cleanup after an owned resource fails to stop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-stop-failure-'));
  const ports = dependencies();
  ports.hostStop.mockImplementation(() => {
    throw Error('fixture_stop_failure');
  });
  let port = 0;
  let source: DataSource | undefined;
  const service = createHubService({
    env: environment(root),
    nvr: ports.ports,
    ready: (_config, value) => {
      port = value;
    },
    createApp: async (options) => {
      const app = await createNestApp(options);
      source = app.get<DataSource>(CATALOG_SOURCE);
      return app;
    },
  });
  try {
    await service.start();
    await expect(service.stop()).rejects.toThrow('service_cleanup_failed');
    expect(source?.isInitialized).toBe(false);
    expect(ports.hostStop).toHaveBeenCalledTimes(1);
    expect(ports.capacityStop).toHaveBeenCalledTimes(1);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
