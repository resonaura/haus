/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HausMqttClient } from '@haus/mqtt';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { StandaloneHomePersistence } from '../../src/home/home.persistence.js';
import { MqttService } from '../../src/mqtt/service.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function fixture(home = new StandaloneHomeService()) {
  const service = new MqttService(home, { host: '127.0.0.1', port: 0, allowAnonymous: true });
  await service.onApplicationBootstrap();
  expect(service.broker.listening).toBe(true);
  cleanups.push(() => service.onApplicationShutdown());
  const client = new HausMqttClient({
    host: '127.0.0.1',
    port: service.broker.port,
    allowAnonymous: true,
  });
  await client.connect();
  cleanups.push(() => client.close());
  const publish = (topic: string, payload: string | Record<string, unknown>) =>
    client.publish({
      topic,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      qos: 1,
      retain: true,
    });
  const config = (id: string, stateTopic = 'fixture/state') => ({
    unique_id: id,
    name: id,
    state_topic: stateTopic,
    command_topic: 'fixture/set',
    device: { identifiers: ['fixture-hardware'], name: 'Workshop relay' },
  });
  return { home, client, publish, config };
}

it('removes only the tombstoned endpoint, its graph/state/commands, and then the unreferenced device', async () => {
  const f = await fixture();
  await f.publish('homeassistant/switch/main/config', f.config('main'));
  await f.publish(
    'homeassistant/sensor/temperature/config',
    f.config('temperature', 'fixture/temperature'),
  );
  await vi.waitFor(() =>
    expect(f.home.getDevice('mqtt_fixture-hardware')?.endpoints).toHaveLength(2),
  );
  await f.publish('fixture/temperature', '24');
  await vi.waitFor(() => expect(f.home.getEndpointState('ep_mqtt_temperature').value).toBe(24));
  await f.publish('homeassistant/switch/main/config', '');
  await vi.waitFor(() =>
    expect(f.home.getDevice('mqtt_fixture-hardware')?.endpoints).toHaveLength(1),
  );
  expect(f.home.getDevice('mqtt_fixture-hardware')?.endpoints?.[0]?.id).toBe('ep_mqtt_temperature');
  expect(f.home.listEndpointStates()).not.toHaveProperty('ep_mqtt_main');
  expect(f.home.getEndpointState('ep_mqtt_temperature').value).toBe(24);
  expect(f.home.getDevice('mqtt_fixture-hardware')?.services?.map((service) => service.id)).toEqual(
    ['service_ep_mqtt_temperature'],
  );
  await expect(f.home.executeDeviceCommand('ep_mqtt_main', 'power', 'turn_on')).rejects.toThrow(
    'endpoint_not_found',
  );
  await f.publish('fixture/state', 'ON');
  await f.home.actionQueue.run('ep_mqtt_main', async () => {});
  expect(f.home.listEndpointStates()).not.toHaveProperty('ep_mqtt_main');
  await f.publish('homeassistant/sensor/temperature/config', '');
  await vi.waitFor(() => expect(f.home.getDevice('mqtt_fixture-hardware')).toBeUndefined());
});

it('replaces stale state bindings without resetting current state or changing IDs', async () => {
  const f = await fixture();
  const topic = 'homeassistant/switch/main/config';
  await f.publish(topic, f.config('main', 'fixture/old'));
  await f.publish('fixture/old', 'ON');
  await vi.waitFor(() => expect(f.home.getEndpointState('ep_mqtt_main').on_off).toBe(true));
  await f.publish(topic, f.config('main', 'fixture/new'));
  expect(f.home.getEndpointState('ep_mqtt_main').on_off).toBe(true);
  await f.publish('fixture/old', 'OFF');
  await f.publish('fixture/new', 'ON');
  await f.home.actionQueue.run('ep_mqtt_main', async () => {});
  expect(f.home.getEndpointState('ep_mqtt_main').on_off).toBe(true);
  await f.publish('fixture/new', 'OFF');
  await vi.waitFor(() => expect(f.home.getEndpointState('ep_mqtt_main').on_off).toBe(false));
  await f.publish('fixture/old', 'ON');
  await f.home.actionQueue.run('ep_mqtt_main', async () => {});
  expect(f.home.getEndpointState('ep_mqtt_main').on_off).toBe(false);
});

it('honors bundled platform abbreviations and explicit platform-only component removal', async () => {
  const f = await fixture();
  const topic = 'homeassistant/device/relay/config';
  const shared = {
    dev: { ids: ['fixture-bundle'], name: 'Workshop panel' },
    o: { name: 'fixture' },
  };
  await f.publish(topic, {
    ...shared,
    cmps: {
      relay: {
        p: 'switch',
        unique_id: 'relay',
        command_topic: 'fixture/set',
        state_topic: 'fixture/state',
      },
      temperature: { p: 'sensor', unique_id: 'temperature', state_topic: 'fixture/temperature' },
    },
  });
  await vi.waitFor(() =>
    expect(f.home.getDevice('mqtt_fixture-bundle')?.endpoints).toHaveLength(2),
  );
  expect(
    f.home
      .getDevice('mqtt_fixture-bundle')
      ?.endpoints?.find((e) => e.id === 'ep_relay')
      ?.capabilities.some((c) => c.id === 'on_off'),
  ).toBe(true);
  await f.publish(topic, { ...shared, cmps: { relay: { p: 'switch' } } });
  await vi.waitFor(() =>
    expect(f.home.getDevice('mqtt_fixture-bundle')?.endpoints).toHaveLength(1),
  );
  expect(f.home.getDevice('mqtt_fixture-bundle')?.endpoints?.[0]?.id).toBe('ep_temperature');
  expect(f.home.listEndpointStates()).not.toHaveProperty('ep_relay');
  await f.publish(topic, '');
  await vi.waitFor(() => expect(f.home.getDevice('mqtt_fixture-bundle')).toBeUndefined());
});

it('does not let an already queued state update resurrect a removed endpoint', async () => {
  const f = await fixture();
  await f.publish('homeassistant/switch/main/config', f.config('main'));
  await vi.waitFor(() => expect(f.home.getDevice('mqtt_fixture-hardware')).toBeDefined());
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = f.home.actionQueue.run('ep_mqtt_main', () => barrier);
  try {
    await f.publish('fixture/state', 'ON');
    await f.publish('homeassistant/switch/main/config', '');
    await vi.waitFor(() => expect(f.home.getDevice('mqtt_fixture-hardware')).toBeUndefined());
  } finally {
    release();
    await pending;
  }
  await f.home.actionQueue.run('ep_mqtt_main', async () => {});
  expect(f.home.listEndpointStates()).not.toHaveProperty('ep_mqtt_main');
});

it('keeps shared discovery references and restores the surviving state/command binding', async () => {
  const f = await fixture();
  const first = 'homeassistant/switch/main/config';
  const second = 'haus/switch/main/config';
  await f.publish(first, f.config('main', 'fixture/first'));
  await f.publish(second, {
    ...f.config('main', 'fixture/second'),
    command_topic: 'fixture/second/set',
  });
  const commands: string[] = [];
  await f.client.subscribe('fixture/set', (message) => {
    commands.push(message.payload);
  });
  await f.publish(second, '');
  expect(f.home.getDevice('mqtt_fixture-hardware')).toBeDefined();
  await f.publish('fixture/first', 'ON');
  await vi.waitFor(() => expect(f.home.getEndpointState('ep_mqtt_main').on_off).toBe(true));
  await f.home.executeDeviceCommand('ep_mqtt_main', 'power', 'turn_off');
  await vi.waitFor(() => expect(commands).toContain('OFF'));
  await f.publish(first, '');
  await vi.waitFor(() => expect(f.home.getDevice('mqtt_fixture-hardware')).toBeUndefined());
});

it('rejects malformed discovery without replacing good config or logging provider bodies', async () => {
  const f = await fixture();
  const topic = 'homeassistant/switch/main/config';
  await f.publish(topic, f.config('main'));
  await vi.waitFor(() => expect(f.home.getDevice('mqtt_fixture-hardware')).toBeDefined());
  const warnings = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  for (const malformed of [
    'null',
    '[]',
    '{',
    { ...f.config('main'), state_topic: 12 },
    { ...f.config('main'), device: 'fixture-private-value' },
  ]) {
    await f.publish(topic, malformed);
  }
  await vi.waitFor(() => expect(warnings).toHaveBeenCalledTimes(5));
  expect(JSON.stringify(warnings.mock.calls)).not.toContain('fixture-private-value');
  await f.publish('fixture/state', 'ON');
  await vi.waitFor(() => expect(f.home.getEndpointState('ep_mqtt_main').on_off).toBe(true));
});

it('rejects an already queued command after discovery removes its endpoint', async () => {
  const f = await fixture();
  await f.publish('homeassistant/switch/main/config', f.config('main'));
  await vi.waitFor(() => expect(f.home.getDevice('mqtt_fixture-hardware')).toBeDefined());
  let release = () => {};
  const pending = f.home.actionQueue.run(
    'ep_mqtt_main',
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const command = expect(
    f.home.executeDeviceCommand('ep_mqtt_main', 'power', 'turn_on'),
  ).rejects.toThrow('endpoint_not_found');
  try {
    await f.publish('homeassistant/switch/main/config', '');
    await vi.waitFor(() => expect(f.home.getDevice('mqtt_fixture-hardware')).toBeUndefined());
  } finally {
    release();
    await pending;
  }
  await command;
  expect(f.home.listEndpointStates()).not.toHaveProperty('ep_mqtt_main');
});

it('persists removal across catalog reopen while preserving the sibling and its state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-mqtt-lifecycle-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const database = join(root, 'catalog.sqlite');
  const source = await openCatalog(database);
  cleanups.push(async () => {
    if (source.isInitialized) await source.destroy();
  });
  const transactions = new Transactions(source);
  const home = new StandaloneHomeService(undefined, transactions);
  await home.onModuleInit();
  const f = await fixture(home);
  await f.publish('homeassistant/switch/main/config', f.config('main'));
  await f.publish(
    'homeassistant/sensor/temperature/config',
    f.config('temperature', 'fixture/temperature'),
  );
  await f.publish('fixture/temperature', '24');
  await vi.waitFor(() => expect(home.getEndpointState('ep_mqtt_temperature').value).toBe(24));
  await f.publish('homeassistant/switch/main/config', '');
  await vi.waitFor(() =>
    expect(home.getDevice('mqtt_fixture-hardware')?.endpoints).toHaveLength(1),
  );
  await new StandaloneHomePersistence(transactions).load();
  await source.destroy();
  const reopened = await openCatalog(database);
  cleanups.push(() => reopened.destroy());
  const restored = new StandaloneHomeService(undefined, new Transactions(reopened));
  await restored.onModuleInit();
  expect(
    restored.getDevice('mqtt_fixture-hardware')?.endpoints.map((endpoint) => endpoint.id),
  ).toEqual(['ep_mqtt_temperature']);
  expect(restored.getEndpointState('ep_mqtt_temperature').value).toBe(24);
  expect(restored.listEndpointStates()).not.toHaveProperty('ep_mqtt_main');
});
