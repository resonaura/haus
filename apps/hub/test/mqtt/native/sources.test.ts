/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SourceServiceRef } from '@haus/core';
import { mqttFixture } from '../fixture.js';
import { openCatalog, Transactions } from '../../../src/storage/index.js';
import { OrmMqttRetention } from '../../../src/storage/mqtt/retention.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

const profiles = [
  {
    name: 'single',
    topic: 'homeassistant/switch/status/config',
    endpoint: 'ep_mqtt_camera_status',
    payload: {
      unique_id: 'camera_status',
      state_topic: 'fixture/status',
      command_topic: 'fixture/status/set',
      device: { identifiers: ['physical-camera'], name: 'Camera' },
    },
  },
  {
    name: 'bundle',
    topic: 'homeassistant/device/camera/config',
    endpoint: 'ep_camera_status',
    payload: {
      dev: { ids: ['physical-camera'], name: 'Camera' },
      cmps: {
        status: {
          p: 'switch',
          unique_id: 'camera_status',
          stat_t: 'fixture/status',
          cmd_t: 'fixture/status/set',
        },
      },
    },
  },
] as const;

const native: SourceServiceRef = {
  protocol: 'vendor',
  externalId: 'bridge:physical-camera:status',
  domain: 'switch',
};
const mqtt: SourceServiceRef = {
  protocol: 'mqtt',
  externalId: 'camera_status',
  domain: 'switch',
};

async function fixture(database?: string) {
  const f = await mqttFixture(database);
  cleanups.push(() => f.close());
  return f;
}

function addSource(
  f: Awaited<ReturnType<typeof fixture>>,
  endpointId: string,
  source: SourceServiceRef,
): void {
  const device = f.home.listDevices()[0];
  if (!device) throw Error('fixture_device_missing');
  f.home.registerDevice({
    ...device,
    services: [],
    endpoints: device.endpoints.map((endpoint) =>
      endpoint.id === endpointId
        ? { ...endpoint, sourceRefs: [...(endpoint.sourceRefs ?? []), source] }
        : endpoint,
    ),
  });
}

it.each(profiles)(
  'preserves exact native source and state through $name replay and tombstone',
  async (profile) => {
    const f = await fixture();
    await f.publish(profile.topic, profile.payload);
    await vi.waitFor(() => expect(f.home.listDevices()).toHaveLength(1));
    const deviceId = f.home.listDevices()[0]?.id;
    const endpoint = () =>
      f.home.getDevice(deviceId ?? '')?.endpoints.find((item) => item.id === profile.endpoint);
    expect(endpoint()?.sourceRefs).toEqual([mqtt]);
    expect(
      f.home
        .getDevice(deviceId ?? '')
        ?.services?.find((service) => service.id === `service_${profile.endpoint}`)?.sourceRefs,
    ).toEqual([mqtt]);
    addSource(f, profile.endpoint, native);
    await f.publish('fixture/status', 'ON');
    await vi.waitFor(() => expect(f.home.getEndpointState(profile.endpoint).on_off).toBe(true));
    await f.publish(profile.topic, profile.payload);
    await f.service.drain();
    expect(endpoint()?.sourceRefs).toEqual([mqtt, native]);

    await f.publish(profile.topic, '');
    await vi.waitFor(() => expect(endpoint()?.sourceRefs).toEqual([native]));
    expect(f.home.getDevice(deviceId ?? '')?.endpoints.map((item) => item.id)).toEqual([
      profile.endpoint,
    ]);
    expect(f.home.getEndpointState(profile.endpoint).on_off).toBe(true);
    await f.publish('fixture/status', 'OFF');
    await f.service.drain();
    expect(f.home.getEndpointState(profile.endpoint).on_off).toBe(true);
    await expect(
      f.home.executeDeviceCommand(profile.endpoint, 'power', 'turn_off'),
    ).rejects.toThrow('mqtt_endpoint_unavailable');
  },
);

it('does not treat a compatibility virtual reference as a surviving native projection', async () => {
  const f = await fixture();
  const profile = profiles[0];
  await f.publish(profile.topic, profile.payload);
  await vi.waitFor(() => expect(f.home.listDevices()).toHaveLength(1));
  addSource(f, profile.endpoint, { protocol: 'virtual', externalId: profile.endpoint });
  await f.publish(profile.topic, '');
  await vi.waitFor(() => expect(f.home.listDevices()).toHaveLength(0));
});

it.each(profiles)(
  'recovers an acknowledged $name tombstone without deleting the native projection',
  async (profile) => {
    const root = await mkdtemp(join(tmpdir(), 'haus-mqtt-sources-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const database = join(root, 'catalog.sqlite');
    const first = await fixture(database);
    await first.publish(profile.topic, profile.payload);
    await vi.waitFor(() => expect(first.home.listDevices()).toHaveLength(1));
    const deviceId = first.home.listDevices()[0]?.id;
    addSource(first, profile.endpoint, native);
    await first.publish('fixture/status', 'ON');
    await vi.waitFor(() => expect(first.home.getEndpointState(profile.endpoint).on_off).toBe(true));
    await first.close();

    // Retained removal committed, but the process died before updating the Home snapshot.
    const source = await openCatalog(database);
    try {
      const tx = new Transactions(source);
      await new OrmMqttRetention(tx).save({
        topic: profile.topic,
        payload: Buffer.alloc(0),
        qos: 1,
      });
      await tx.drain();
    } finally {
      await source.destroy();
    }

    const restored = await fixture(database);
    const endpoint = restored.home
      .getDevice(deviceId ?? '')
      ?.endpoints.find((item) => item.id === profile.endpoint);
    expect(endpoint?.sourceRefs).toEqual([native]);
    expect(restored.home.getEndpointState(profile.endpoint).on_off).toBe(true);
    await restored.close();
    const reopened = await fixture(database);
    expect(
      reopened.home
        .getDevice(deviceId ?? '')
        ?.endpoints.find((item) => item.id === profile.endpoint)?.sourceRefs,
    ).toEqual([native]);
    expect(reopened.home.getEndpointState(profile.endpoint).on_off).toBe(true);
  },
);
