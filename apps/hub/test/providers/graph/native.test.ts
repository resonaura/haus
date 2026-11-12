/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CameraBridgeProvider } from '@haus/bridge/provider';
import { inventoryRevision, validateCommand, type BridgeInventory } from '@haus/bridge/protocol';
import { mqttFixture } from '../../mqtt/fixture.js';
import { NativeGraph } from '../../../src/providers/graph/service.js';
import { NativeGraphIdentity } from '../../../src/providers/graph/identity.js';
import { OrmIdentities } from '../../../src/storage/identity.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const topic = 'homeassistant/device/camera/config';
const discovery = {
  dev: { ids: ['physical-camera'], name: 'Outdoor Camera' },
  cmps: {
    camera: { p: 'camera', unique_id: 'physical-camera-video', topic: 'fixture/jpeg' },
    status: {
      p: 'switch',
      unique_id: 'physical-camera-status',
      stat_t: 'fixture/status',
      cmd_t: 'fixture/set',
    },
    motion: {
      p: 'binary_sensor',
      unique_id: 'physical-camera-motion',
      stat_t: 'fixture/motion',
      dev_cla: 'motion',
    },
  },
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'haus-native-graph-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const database = join(root, 'catalog.sqlite');
  const mqtt = await mqttFixture(database);
  cleanups.push(() => mqtt.close());
  const bridge = await new CameraBridgeProvider({
    directory: join(root, 'bridge'),
    provider: 'aqara',
    name: 'Fixture',
  }).initialize();
  cleanups.push(() => bridge.stop());
  const client = await bridge.enroll(bridge.openPairing().code, randomUUID());
  const value: BridgeInventory = {
    version: 2,
    bridgeId: bridge.id,
    provider: 'aqara',
    cameras: [
      {
        id: 'camera',
        mqtt: { uniqueId: 'physical-camera-video' },
        name: 'Outdoor Camera',
        manufacturer: 'Aqara',
        model: 'G5',
        identifiers: ['physical-camera'],
        available: true,
        stream: { transport: 'p2p', url: 'rtsp://192.168.1.10:8554/live' },
        snapshotPath: '/api/cameras/camera/snapshot/last-live',
        entities: [
          {
            id: 'status',
            mqtt: { uniqueId: 'physical-camera-status' },
            name: 'Status Light',
            domain: 'switch',
            role: 'indicator',
            writable: true,
            available: true,
            state: false,
            updatedAt: 1000,
          },
          {
            id: 'motion',
            mqtt: { uniqueId: 'physical-camera-motion' },
            name: 'Motion',
            domain: 'binary_sensor',
            role: 'motion',
            deviceClass: 'motion',
            available: true,
            state: true,
            updatedAt: 1000,
          },
        ],
      },
    ],
  };
  bridge.updateInventory(value);
  let reachable = true;
  const current = () => ({
    ...structuredClone(value),
    revision: inventoryRevision(value),
    reachable,
  });
  const providers = {
    connections: () => [
      {
        id: bridge.id,
        connection: {
          bridgeId: bridge.id,
          provider: 'aqara',
          endpoint: { url: 'http://192.168.1.10:8580' },
        },
      },
    ],
    inventory: () => current(),
    refresh: vi.fn(async () => current()),
    confirm: vi.fn(async (_id: string, revision: string, keys: readonly string[]) =>
      bridge.confirmNativeReady(client.clientId, { revision, entities: [...keys] }),
    ),
    command: vi.fn(async (_bridge: string, _camera: string, entityId: string, command: unknown) => {
      const entity = value.cameras[0]?.entities.find((item) => item.id === entityId);
      if (!entity) throw Error('native_entity_not_found');
      const valid = validateCommand(entity, command);
      if (valid.action === 'set' && typeof valid.value === 'boolean') entity.state = valid.value;
      bridge.updateInventory(value);
    }),
  };
  const sourceRows = () =>
    value.cameras.map((camera) => ({
      bridgeId: bridge.id,
      physicalId: camera.id,
      value: { cameraId: `camera.archive_${camera.id}`, aliases: [], physical: camera },
    }));
  const sources = { rows: sourceRows };
  const identity = () => {
    if (!mqtt.tx) throw Error('fixture_transactions_missing');
    return new NativeGraphIdentity(
      new OrmIdentities(mqtt.tx),
      () => mqtt.home.listDevices(),
      'home-default',
    );
  };
  const graph = new NativeGraph(mqtt.home, providers, sources, identity());
  cleanups.push(async () => graph.close());
  return {
    ...mqtt,
    database,
    root,
    graph,
    providers,
    value,
    bridge,
    sources,
    releaseNative: () => bridge.releaseNative(client.clientId),
    offline: () => {
      reachable = false;
    },
  };
}

it.each(['native-first', 'mqtt-first'])(
  'reconciles %s, routes only native commands and suppresses MQTT after durable projection',
  async (order) => {
    const f = await fixture();
    if (order === 'mqtt-first') {
      await f.publish(topic, discovery);
      await vi.waitFor(() => expect(f.home.listDevices()).toHaveLength(1));
    }
    const old = f.home.listDevices()[0];
    expect(f.bridge.shouldPublishMqtt()).toBe(true);
    await f.graph.sync(f.bridge.id);
    expect(f.bridge.shouldPublishMqtt()).toBe(false);
    const device = f.home.listDevices()[0];
    if (!device) throw Error('fixture_device_missing');
    if (old)
      expect(device.endpoints.map((endpoint) => endpoint.id).sort()).toEqual(
        old.endpoints.map((endpoint) => endpoint.id).sort(),
      );
    expect(device.endpoints).toHaveLength(3);
    expect(device.endpoints.find((endpoint) => endpoint.mediaId)?.mediaId).toBe(
      'camera.archive_camera',
    );
    const status = device.endpoints.find((endpoint) => endpoint.name === 'Status Light');
    if (!status) throw Error('fixture_status_missing');
    await f.publish(topic, discovery);
    await f.publish('fixture/status', 'ON');
    await f.publish('fixture/motion', 'OFF');
    await f.service.drain();
    expect(f.home.listDevices()).toHaveLength(1);
    expect(f.home.getDevice(device.id)?.endpoints).toHaveLength(3);
    expect(f.home.getEndpointState(status.id).on_off).toBe(false);
    await f.home.executeDeviceCommand(status.id, 'on_off', 'turn_on');
    expect(f.providers.command).toHaveBeenCalledTimes(1);
    expect(f.home.getEndpointState(status.id).on_off).toBe(true);
    await f.publish(topic, '');
    await f.service.drain();
    expect(f.home.getDevice(device.id)?.endpoints).toHaveLength(3);
    expect(f.home.getEndpointState(status.id).on_off).toBe(true);
    const stored = await f.home.getPersistence().load();
    expect(stored.devices.find((entry) => entry.id === device.id)?.endpoints).toEqual(
      f.home.getDevice(device.id)?.endpoints,
    );
  },
);

it('keeps native ownership through a provider outage and catalog restart', async () => {
  const f = await fixture();
  await f.graph.sync(f.bridge.id);
  const device = f.home.listDevices()[0];
  const status = device?.endpoints.find((endpoint) => endpoint.name === 'Status Light');
  if (!device || !status) throw Error('fixture_device_missing');
  f.offline();
  await f.graph.sync(f.bridge.id);
  expect(f.home.getDevice(device.id)?.availability).toBe('offline');
  await f.publish(topic, discovery);
  await f.publish('fixture/status', 'ON');
  await f.service.drain();
  expect(f.home.getEndpointState(status.id).on_off).toBe(false);
  await expect(f.home.executeDeviceCommand(status.id, 'on_off', 'turn_on')).rejects.toThrow(
    'native_provider_unavailable',
  );
  await f.graph.close();
  await f.close();
  const restored = await mqttFixture(f.database);
  cleanups.push(() => restored.close());
  expect(
    restored.home.getDevice(device.id)?.endpoints.find((endpoint) => endpoint.id === status.id)
      ?.sourceOwner?.protocol,
  ).toBe('vendor');
  await expect(restored.home.executeDeviceCommand(status.id, 'on_off', 'turn_on')).rejects.toThrow(
    'device_command_handler_unavailable',
  );
});

it('does not suppress publication when only some cameras were imported', async () => {
  const f = await fixture();
  const first = f.value.cameras[0];
  if (!first) throw Error('fixture_camera_missing');
  f.value.cameras.push({
    ...structuredClone(first),
    id: 'other',
    identifiers: ['other-camera'],
    mqtt: { uniqueId: 'other-video' },
    entities: [],
  });
  f.bridge.updateInventory(f.value);
  if (!f.tx) throw Error('fixture_transactions_missing');
  const partial = new NativeGraph(
    f.home,
    f.providers,
    { rows: () => f.sources.rows().slice(0, 1) },
    new NativeGraphIdentity(new OrmIdentities(f.tx), () => f.home.listDevices(), 'home-default'),
  );
  cleanups.push(async () => partial.close());
  await partial.sync(f.bridge.id);
  expect(f.home.listDevices()).toHaveLength(1);
  expect(f.providers.confirm).not.toHaveBeenCalled();
  expect(f.bridge.shouldPublishMqtt()).toBe(true);
});

it('rejects a queued MQTT observation after native ownership was materialized', async () => {
  const f = await fixture();
  await f.publish(topic, discovery);
  await vi.waitFor(() => expect(f.home.listDevices()).toHaveLength(1));
  const endpoint = f.home
    .listDevices()[0]
    ?.endpoints.find((item) =>
      item.sourceRefs?.some((source) => source.externalId === 'physical-camera-status'),
    );
  if (!endpoint) throw Error('fixture_endpoint_missing');
  let release = () => {};
  const pending = f.home.actionQueue.run(
    endpoint.id,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  try {
    const update = vi.spyOn(f.home, 'updateEndpointState');
    await f.publish('fixture/status', 'ON');
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    await f.graph.sync(f.bridge.id);
  } finally {
    release();
    await pending;
  }
  await f.service.drain();
  expect(f.home.getEndpointState(endpoint.id).on_off).toBe(false);
});

it('reconciles a native camera without an MQTT camera alias using its proven physical device and sole video endpoint', async () => {
  const f = await fixture();
  const camera = f.value.cameras[0];
  if (!camera) throw Error('fixture_camera_missing');
  delete camera.mqtt;
  f.bridge.updateInventory(f.value);
  await f.graph.sync(f.bridge.id);
  const old = f.home.listDevices()[0];
  await f.publish(topic, discovery);
  await f.service.drain();
  expect(f.home.listDevices()).toHaveLength(1);
  expect(
    f.home
      .listDevices()[0]
      ?.endpoints.map((endpoint) => endpoint.id)
      .sort(),
  ).toEqual(old?.endpoints.map((endpoint) => endpoint.id).sort());
  expect(
    f.home
      .listDevices()[0]
      ?.endpoints.filter((endpoint) =>
        endpoint.capabilities.some((capability) => capability.id === 'video'),
      ),
  ).toHaveLength(1);
});

it('refuses an ambiguous legacy control handover and leaves MQTT publication enabled', async () => {
  const f = await fixture();
  await f.publish(topic, discovery);
  await vi.waitFor(() => expect(f.home.listDevices()).toHaveLength(1));
  const camera = f.value.cameras[0];
  if (!camera) throw Error('fixture_camera_missing');
  for (const entity of camera.entities) delete entity.mqtt;
  f.bridge.updateInventory(f.value);
  await expect(f.graph.sync(f.bridge.id)).rejects.toThrow('native_graph_mqtt_alias_required');
  expect(f.providers.confirm).not.toHaveBeenCalled();
  expect(f.bridge.shouldPublishMqtt()).toBe(true);
  expect(f.home.listDevices()[0]?.endpoints).toHaveLength(3);
  expect(f.home.listDevices()[0]?.endpoints.some((endpoint) => endpoint.sourceOwner)).toBe(false);
});

it('supports explicitly enabled parallel MQTT without creating a second camera or overwriting native observations', async () => {
  const f = await fixture();
  f.bridge.setDisableMqttWithHaus(false);
  await f.graph.sync(f.bridge.id);
  expect(f.bridge.shouldPublishMqtt()).toBe(true);
  const old = f.home.listDevices()[0];
  await f.publish(topic, discovery);
  await f.publish('fixture/status', 'ON');
  await f.service.drain();
  expect(f.home.listDevices()).toHaveLength(1);
  expect(f.home.listDevices()[0]?.endpoints).toHaveLength(3);
  expect(f.home.listDevices()[0]?.id).toBe(old?.id);
  const status = old?.endpoints.find((endpoint) => endpoint.name === 'Status Light');
  expect(status && f.home.getEndpointState(status.id).on_off).toBe(false);
});

it('refuses a second native provider until the first owner is explicitly released', async () => {
  const f = await fixture();
  await f.graph.sync(f.bridge.id);
  const camera = f.value.cameras[0];
  if (!f.tx || !camera) throw Error('fixture_camera_missing');
  const identities = new NativeGraphIdentity(
    new OrmIdentities(f.tx),
    () => f.home.listDevices(),
    'home-default',
  );
  await expect(identities.device(randomUUID(), camera)).rejects.toThrow(
    'native_graph_owner_conflict',
  );
  expect(f.home.listDevices()).toHaveLength(1);
});

it('withholds readiness after an incomplete durable snapshot and returns MQTT authority only after explicit release', async () => {
  const f = await fixture();
  const persistence = f.home.getPersistence();
  const load = vi.spyOn(persistence, 'load');
  load.mockResolvedValueOnce({
    devices: [],
    endpointStates: [],
    apps: [],
    automations: [],
    scenes: [],
    scripts: [],
  });
  await expect(f.graph.sync(f.bridge.id)).rejects.toThrow('native_graph_not_durable');
  expect(f.bridge.shouldPublishMqtt()).toBe(true);
  await f.graph.sync(f.bridge.id);
  expect(f.bridge.shouldPublishMqtt()).toBe(false);
  const device = f.home.listDevices()[0];
  const status = device?.endpoints.find((endpoint) => endpoint.name === 'Status Light');
  if (!device || !status) throw Error('fixture_device_missing');
  await f.releaseNative();
  await f.graph.release(f.bridge.id);
  await f.publish(topic, discovery);
  await f.publish('fixture/status', 'ON');
  await vi.waitFor(() => expect(f.home.getEndpointState(status.id).on_off).toBe(true));
  expect(f.home.getDevice(device.id)?.endpoints).toHaveLength(3);
  expect(
    f.home.getDevice(device.id)?.endpoints.find((endpoint) => endpoint.id === status.id)
      ?.sourceOwner,
  ).toBeUndefined();
  expect(f.bridge.shouldPublishMqtt()).toBe(true);
});

it('keeps observed native controls usable while video is unavailable', async () => {
  const f = await fixture();
  const camera = f.value.cameras[0];
  if (!camera) throw Error('fixture_camera_missing');
  camera.available = false;
  f.bridge.updateInventory(f.value);
  await f.graph.sync(f.bridge.id);
  const device = f.home.listDevices()[0];
  const status = device?.endpoints.find((endpoint) => endpoint.name === 'Status Light');
  const video = device?.endpoints.find((endpoint) =>
    endpoint.capabilities.some((c) => c.id === 'video'),
  );
  if (!device || !status || !video) throw Error('fixture_device_missing');
  expect(video.availability).toBe('offline');
  expect(status.availability).toBe('online');
  expect(device.availability).toBe('online');
  await f.home.executeDeviceCommand(status.id, 'on_off', 'turn_on');
  expect(f.providers.command).toHaveBeenCalledTimes(1);
  expect(f.home.getEndpointState(status.id).on_off).toBe(true);
  const entity = camera.entities.find((entity) => entity.id === 'status');
  if (!entity) throw Error('fixture_entity_missing');
  entity.available = false;
  f.bridge.updateInventory(f.value);
  await f.graph.sync(f.bridge.id);
  await expect(f.home.executeDeviceCommand(status.id, 'on_off', 'turn_off')).rejects.toThrow(
    'bridge_entity_unavailable',
  );
  expect(f.providers.command).toHaveBeenCalledTimes(1);
});
