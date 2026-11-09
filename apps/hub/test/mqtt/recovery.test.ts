/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mqttFixture } from './fixture.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';
import { OrmMqttRetention } from '../../src/storage/mqtt/retention.js';
import { StandaloneHomePersistence } from '../../src/home/home.persistence.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'haus-mqtt-recovery-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'catalog.sqlite');
  const first = await mqttFixture(path);
  cleanups.push(() => first.close());
  return {
    path,
    first,
    async acknowledged(topic: string, payload: string | object, removeDevice?: string) {
      await first.close();
      // Reproduce the exact window: retained commit succeeded, Home still has its previous snapshot.
      const source = await openCatalog(path);
      const tx = new Transactions(source);
      try {
        await new OrmMqttRetention(tx).save({
          topic,
          payload: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)),
          qos: 1,
        });
        if (removeDevice) await new StandaloneHomePersistence(tx).remove('device', removeDevice);
        await tx.drain();
      } finally {
        await source.destroy();
      }
      const restored = await mqttFixture(path);
      cleanups.push(() => restored.close());
      return restored;
    },
  };
}
const topic = 'homeassistant/device/panel/config';
const shared = { dev: { ids: ['panel'], name: 'Workshop panel' } };
const bundle = {
  ...shared,
  cmps: {
    main: {
      p: 'switch',
      unique_id: 'relay',
      stat_t: 'fixture/relay/state',
      cmd_t: 'fixture/relay/set',
    },
    temperature: { p: 'sensor', unique_id: 'temperature', stat_t: 'fixture/temperature' },
  },
};
async function seed(f: Awaited<ReturnType<typeof fixture>>) {
  await f.first.publish(topic, bundle);
  await f.first.publish('fixture/temperature', '24');
  await vi.waitFor(() => expect(f.first.home.getEndpointState('ep_temperature').value).toBe(24));
}

it('recovers an acknowledged tombstone even when the previous Home device is still persisted', async () => {
  const f = await fixture();
  await seed(f);
  const restored = await f.acknowledged(topic, '');
  expect(restored.home.listDevices()).toHaveLength(0);
  expect(restored.home.listEndpointStates()).toEqual({});
  await expect(restored.home.executeDeviceCommand('ep_relay', 'power', 'turn_on')).rejects.toThrow(
    'endpoint_not_found',
  );
});

it('recovers an acknowledged component removal without changing its sibling ID or state', async () => {
  const f = await fixture();
  await seed(f);
  const restored = await f.acknowledged(topic, { ...shared, cmps: { main: { p: 'switch' } } });
  expect(restored.home.listDevices()[0]?.endpoints.map((endpoint) => endpoint.id)).toEqual([
    'ep_temperature',
  ]);
  expect(restored.home.getEndpointState('ep_temperature').value).toBe(24);
  expect(restored.home.listEndpointStates()).not.toHaveProperty('ep_relay');
});

it('removes a replaced component left in the old snapshot and routes only the replacement', async () => {
  const f = await fixture();
  await seed(f);
  const restored = await f.acknowledged(topic, {
    ...shared,
    cmps: {
      main: { p: 'switch', unique_id: 'replacement', cmd_t: 'fixture/new/set' },
    },
  });
  expect(
    restored.home
      .listDevices()[0]
      ?.endpoints.map((endpoint) => endpoint.id)
      .sort(),
  ).toEqual(['ep_replacement', 'ep_temperature']);
  expect(restored.home.listEndpointStates()).not.toHaveProperty('ep_relay');
  const commands: string[] = [];
  await restored.client.subscribe('fixture/new/set', (message) => {
    commands.push(message.payload);
  });
  await restored.home.executeDeviceCommand('ep_replacement', 'power', 'turn_on');
  await vi.waitFor(() => expect(commands).toEqual(['ON']));
});

it('clears owned orphan readings if the device row was removed before its state rows', async () => {
  const f = await fixture();
  await seed(f);
  const restored = await f.acknowledged(topic, '', 'mqtt_panel');
  expect(restored.home.listDevices()).toHaveLength(0);
  expect(restored.home.listEndpointStates()).toEqual({});
});
