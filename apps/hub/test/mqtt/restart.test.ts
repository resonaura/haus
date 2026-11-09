/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HausMqttClient, type MqttMessage } from '@haus/mqtt';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { MqttService } from '../../src/mqtt/service.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';
import { OrmMqttRetention } from '../../src/storage/mqtt/retention.js';
import { StandaloneHomeEntryEntity } from '../../src/storage/standalone/entities.js';
import { CatalogLifetime } from '../../src/storage/lifetime.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function database() {
  const directory = await mkdtemp(join(tmpdir(), 'haus-mqtt-restart-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'catalog.sqlite');
}

async function boot(path: string) {
  const source = await openCatalog(path);
  const transactions = new Transactions(source);
  const lifetime = new CatalogLifetime(source, transactions);
  const home = new StandaloneHomeService(undefined, transactions);
  await home.onModuleInit();
  const updates = vi.spyOn(home, 'updateEndpointState');
  const service = new MqttService(
    home,
    { host: '127.0.0.1', port: 0, allowAnonymous: true },
    transactions,
    lifetime,
  );
  await service.onApplicationBootstrap();
  const client = new HausMqttClient({
    host: '127.0.0.1',
    port: service.broker.port,
    allowAnonymous: true,
  });
  await client.connect({ reconnectPeriod: 0 });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await client.close();
    await lifetime.close();
    expect(service.broker.listening).toBe(false);
  };
  cleanups.push(close);
  const publish = (topic: string, payload: string | object) =>
    client.publish({
      topic,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      retain: true,
      qos: 1,
    });
  return {
    home,
    service,
    client,
    close,
    publish,
    updates,
    store: new OrmMqttRetention(transactions),
  };
}

it('restores bindings and retained state before accepting clients without replaying an automation event', async () => {
  const path = await database();
  const first = await boot(path);
  const topic = 'homeassistant/switch/main/config';
  const config = {
    unique_id: 'restart-main',
    state_topic: 'fixture/state',
    command_topic: 'fixture/set',
    device: { identifiers: ['restart-device'], name: 'Workshop relay' },
  };
  // The state may have been retained before the config was ever announced.
  await first.publish('fixture/state', 'ON');
  await first.publish(topic, config);
  await first.close();
  const second = await boot(path);
  expect(second.home.getDevice('mqtt_restart-device')?.endpoints[0]?.id).toBe(
    'ep_mqtt_restart-main',
  );
  expect(second.home.getEndpointState('ep_mqtt_restart-main').on_off).toBe(true);
  expect(second.updates.mock.calls.every((call) => call[2] === false)).toBe(true);
  const commands: string[] = [];
  await second.client.subscribe('fixture/set', (message) => {
    commands.push(message.payload);
  });
  await second.home.executeDeviceCommand('ep_mqtt_restart-main', 'power', 'turn_off');
  await vi.waitFor(() => expect(commands).toEqual(['OFF']));
  const retained: MqttMessage[] = [];
  await second.client.subscribe(topic, (message) => {
    retained.push(message);
  });
  await vi.waitFor(() => expect(retained).toHaveLength(1));
  expect(JSON.parse(retained[0]?.payload ?? '')).toEqual(config);
  expect(retained[0]?.retained).toBe(true);
  await second.publish(topic, '');
  await vi.waitFor(() => expect(second.home.getDevice('mqtt_restart-device')).toBeUndefined());
  await second.close();
  const third = await boot(path);
  expect(third.home.getDevice('mqtt_restart-device')).toBeUndefined();
  expect(third.home.listEndpointStates()).not.toHaveProperty('ep_mqtt_restart-main');
  await expect(
    third.home.executeDeviceCommand('ep_mqtt_restart-main', 'power', 'turn_on'),
  ).rejects.toThrow('endpoint_not_found');
});

it('restores incremental bundles and explicit removals while retaining the exact original wire payload', async () => {
  const path = await database();
  const first = await boot(path);
  const topic = 'homeassistant/device/panel/config';
  const dev = { ids: ['restart-panel'], name: 'Workshop panel' };
  await first.publish(topic, {
    dev,
    cmps: {
      relay: { p: 'switch', unique_id: 'relay', stat_t: 'fixture/relay', cmd_t: 'fixture/set' },
      temperature: { p: 'sensor', unique_id: 'temperature', stat_t: 'fixture/temperature' },
    },
  });
  const partial = {
    dev,
    cmps: {
      relay: { p: 'switch', unique_id: 'relay', stat_t: 'fixture/new', cmd_t: 'fixture/new/set' },
    },
  };
  await first.publish(topic, partial);
  await first.close();
  const second = await boot(path);
  const states: MqttMessage[] = [];
  await second.client.subscribe(topic, (message) => {
    states.push(message);
  });
  await vi.waitFor(() => expect(states).toHaveLength(1));
  expect(JSON.parse(states[0]?.payload ?? '')).toEqual(partial);
  await second.publish('fixture/temperature', '24');
  await second.publish('fixture/new', 'ON');
  await vi.waitFor(() => expect(second.home.getEndpointState('ep_temperature').value).toBe(24));
  await vi.waitFor(() => expect(second.home.getEndpointState('ep_relay').on_off).toBe(true));
  await second.publish(topic, { dev, cmps: { relay: { p: 'switch' } } });
  await vi.waitFor(() =>
    expect(second.home.getDevice('mqtt_restart-panel')?.endpoints).toHaveLength(1),
  );
  await second.close();
  const third = await boot(path);
  expect(
    third.home.getDevice('mqtt_restart-panel')?.endpoints.map((endpoint) => endpoint.id),
  ).toEqual(['ep_temperature']);
  expect(third.home.getEndpointState('ep_temperature').value).toBe(24);
  await third.publish(topic, '');
  await vi.waitFor(() => expect(third.home.getDevice('mqtt_restart-panel')).toBeUndefined());
});

it('migrates the prior catalog without losing home entries and refuses destructive rollback', async () => {
  const path = await database();
  const old = await openCatalog(path);
  const transactions = new Transactions(old);
  await transactions.run((manager) =>
    manager.save(StandaloneHomeEntryEntity, {
      kind: 'scene',
      entryId: 'fixture-scene',
      value: JSON.stringify({ id: 'fixture-scene', members: [] }),
      updatedAt: 1,
    }),
  );
  await old.undoLastMigration({ transaction: 'all' });
  await old.destroy();
  const current = await openCatalog(path);
  cleanups.push(() => current.destroy());
  const tx = new Transactions(current);
  expect(
    await tx.read((manager) =>
      manager.findOneBy(StandaloneHomeEntryEntity, { entryId: 'fixture-scene' }),
    ),
  ).toBeDefined();
  const store = new OrmMqttRetention(tx);
  const binary = Buffer.from([0xff, 0x00, 0x80, 0x21]);
  await store.save({ topic: 'fixture/binary', payload: binary, qos: 1 });
  expect((await store.load())[0]?.payload).toEqual(binary);
  await expect(current.undoLastMigration({ transaction: 'all' })).rejects.toThrow(
    'mqtt_retention_rollback_requires_data_export',
  );
  expect((await store.load())[0]?.payload).toEqual(binary);
});

it('does not listen or advertise a successful start if retained storage cannot be read', async () => {
  const service = new MqttService(new StandaloneHomeService(), {
    host: '127.0.0.1',
    port: 0,
    retainedStore: {
      load: async () => {
        throw Error('private_storage_details');
      },
      save: async () => {},
    },
  });
  await expect(service.onApplicationBootstrap()).rejects.toThrow('mqtt_start_failed');
  expect(service.broker.listening).toBe(false);
});

it('does not promote an old duplicate reference when its later retained packet is invalid', async () => {
  const path = await database();
  const first = await boot(path);
  const config = { unique_id: 'shared', device: { identifiers: ['shared-relay'] } };
  await first.publish('homeassistant/switch/shared/config', {
    ...config,
    state_topic: 'fixture/old',
    command_topic: 'fixture/old/set',
  });
  await first.publish('haus/switch/shared/config', {
    ...config,
    state_topic: 'fixture/current',
    command_topic: 'fixture/current/set',
  });
  await first.publish('homeassistant/switch/shared/config', '{invalid');
  await first.close();
  const second = await boot(path);
  const commands: string[] = [];
  await second.client.subscribe('fixture/current/set', (message) => {
    commands.push(message.payload);
  });
  await second.home.executeDeviceCommand('ep_mqtt_shared', 'power', 'turn_off');
  await vi.waitFor(() => expect(commands).toEqual(['OFF']));
  await second.publish('haus/switch/shared/config', '');
  const oldCommands: string[] = [];
  await second.client.subscribe('fixture/old/set', (message) => {
    oldCommands.push(message.payload);
  });
  await second.home.executeDeviceCommand('ep_mqtt_shared', 'power', 'turn_on');
  await vi.waitFor(() => expect(oldCommands).toEqual(['ON']));
});
