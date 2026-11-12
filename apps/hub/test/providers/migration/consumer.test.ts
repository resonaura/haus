/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CameraBridgeProvider } from '@haus/bridge/provider';
import { inventoryRevision } from '@haus/bridge/protocol';
import { mqttFixture } from '../../mqtt/fixture.js';
import { CameraCatalog, OrmIdentities } from '../../../src/storage/index.js';
import { NativeProviders } from '../../../src/providers/native.js';
import { NativeCameraSources } from '../../../src/camera/control/sources.js';
import { NativeGraph } from '../../../src/providers/graph/service.js';
import { NativeGraphIdentity } from '../../../src/providers/graph/identity.js';
import { OrmMqttRetention } from '../../../src/storage/mqtt/retention.js';
import { migrationFixture, canonical, switchId, videoId, cameraId, rawId } from './fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

it('replays unchanged MQTT after migration and imports native media into the same graph/archive IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-camera-migration-consumer-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'catalog.sqlite');
  const f = await migrationFixture(path);
  cleanups.push(() => f.close());
  const bridge = await new CameraBridgeProvider({
    directory: join(root, 'bridge'),
    provider: 'aqara',
    name: 'Fixture',
  }).initialize();
  cleanups.push(() => bridge.stop());
  const evidence = { ...f.evidence, inventory: { ...f.evidence.inventory, bridgeId: bridge.id } };
  const inventory = evidence.inventory;
  bridge.updateInventory(inventory);
  const enrolled = await bridge.enroll(bridge.openPairing().code, randomUUID());
  const config = {
    dev: { ids: [rawId], name: 'Provider label' },
    cmps: {
      camera: { p: 'camera', unique_id: 'camera-one-camera', topic: 'fixture/jpeg' },
      status: {
        p: 'switch',
        unique_id: 'camera-one-status',
        stat_t: 'fixture/status',
        cmd_t: 'fixture/set',
      },
      motion: { p: 'binary_sensor', unique_id: 'motion', stat_t: 'fixture/motion' },
    },
  };
  await new OrmMqttRetention(f.transactions).save({
    topic: 'homeassistant/device/camera/config',
    payload: Buffer.from(JSON.stringify(config)),
    qos: 1,
  });
  await f.migration.apply(await f.migration.plan(evidence));
  await f.close();
  // Retained discovery is present when the real broker/Home composition reopens the catalog.
  const restored = await mqttFixture(path);
  cleanups.push(() => restored.close());
  await restored.publish('homeassistant/device/camera/config', config);
  await restored.publish('fixture/status', 'ON');
  await vi.waitFor(() => expect(restored.home.getEndpointState(switchId).on_off).toBe(true));
  expect(restored.home.listDevices().map((device) => device.id)).toEqual([canonical]);
  expect(restored.home.getDevice(canonical)?.roomId).toBe('workshop');
  expect(
    restored.home.getDevice(canonical)?.endpoints.find((endpoint) => endpoint.id === switchId),
  ).toMatchObject({ address: 'switch::workshop:camera-one:status', roomId: 'workshop' });
  expect(
    restored.home.getDevice(canonical)?.endpoints.find((endpoint) => endpoint.id === videoId)
      ?.mediaId,
  ).toBe(cameraId);
  const tx = restored.tx;
  if (!tx) throw Error('fixture_transactions_missing');
  const catalog = new CameraCatalog(tx);
  await catalog.initialize();
  const connection = {
    bridgeId: bridge.id,
    provider: 'aqara',
    clientId: enrolled.clientId,
    token: enrolled.token,
    endpoint: {
      url: 'http://192.168.1.20:8580',
      address: '192.168.1.20',
      family: 4,
      allowHttp: true,
    },
  };
  await catalog.native.addProvider({
    id: bridge.id,
    createdAt: 1,
    connection: JSON.stringify(connection),
  });
  const providers = new NativeProviders({
    catalog,
    client: () => ({
      connection,
      inventory: async () => ({ ...inventory, revision: inventoryRevision(inventory) }),
      ready: async (revision, entities) =>
        bridge.confirmNativeReady(enrolled.clientId, { revision, entities: [...entities] }),
      revoke: async () => bridge.revoke(enrolled.clientId),
    }),
  });
  await providers.refresh(bridge.id);
  const sources = new NativeCameraSources({ providers, catalog });
  const graph = new NativeGraph(
    restored.home,
    providers,
    sources,
    new NativeGraphIdentity(
      new OrmIdentities(tx),
      () => restored.home.listDevices(),
      evidence.homeId,
    ),
  );
  cleanups.push(() => graph.close());
  expect(sources.preview(bridge.id, graph.registry())[0]?.existingCameraId).toBe(cameraId);
  await sources.import(bridge.id, ['camera-one'], graph.registry());
  await graph.sync(bridge.id);
  expect(bridge.shouldPublishMqtt()).toBe(false);
  expect(restored.home.listDevices().map((device) => device.id)).toEqual([canonical]);
  expect(restored.home.getDevice(canonical)?.endpoints).toHaveLength(3);
  expect(restored.home.listScenes()[0]?.members[0]?.endpointId).toBe(switchId);
  expect(sources.rows()[0]?.value.cameraId).toBe(cameraId);
  await restored.publish('homeassistant/device/camera/config', '');
  await vi.waitFor(() =>
    expect(
      restored.home
        .getDevice(canonical)
        ?.endpoints.every((endpoint) =>
          endpoint.sourceRefs?.every((source) => source.protocol !== 'mqtt'),
        ),
    ).toBe(true),
  );
  expect(
    restored.home
      .getDevice(canonical)
      ?.endpoints.every((endpoint) => endpoint.sourceOwner?.protocol === 'vendor'),
  ).toBe(true);
});
