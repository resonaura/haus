/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HausDevice } from '@haus/core/device';
import {
  DiscoveryTopics,
  HausMqttClient,
  hausDiscoveryNodeId,
  projectMqttEndpoint,
  type MqttMessage,
  type RetainedPacket,
  type RetainedStore,
} from '@haus/mqtt';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { MqttService } from '../../src/mqtt/service.js';
import { DefaultPreferencesService } from '../../src/preferences/preferences.service.js';
import { Transactions } from '../../src/storage/transactions.js';
import { openCatalog } from '../../src/storage/source.js';
import { OrmMqttRetention } from '../../src/storage/mqtt/retention.js';

const localDevice: HausDevice = {
  id: 'local-temperature',
  source: { instanceId: 'haus-matter', externalId: 'matter-temperature' },
  name: 'Workshop temperature',
  category: 'environmental_sensors',
  connectivity: { protocol: 'matter' },
  availability: 'online',
  endpoints: [
    {
      id: 'workshop-temperature',
      name: 'Temperature',
      capabilities: [
        {
          id: 'temperature',
          kind: 'temperature',
          readable: true,
          operations: [],
          unit: '°C',
          displayPrecision: 1,
        },
      ],
      readings: { temperature: { value: 21.5, freshness: 'live' } },
    },
  ],
  sourceRefs: [{ protocol: 'matter', externalId: 'matter-temperature' }],
};

const localSwitch: HausDevice = {
  id: 'local-switch',
  source: { instanceId: 'haus-matter', externalId: 'matter-switch' },
  name: 'Workshop switch',
  category: 'power',
  connectivity: { protocol: 'matter' },
  availability: 'online',
  endpoints: [
    {
      id: 'workshop-switch',
      name: 'Power',
      capabilities: [
        {
          id: 'on_off',
          kind: 'on_off',
          readable: true,
          operations: ['turn_on', 'turn_off', 'toggle'],
        },
      ],
      readings: { on_off: { value: false, freshness: 'live' } },
    },
  ],
  sourceRefs: [{ protocol: 'matter', externalId: 'matter-switch' }],
};

it('publishes opted-in read-only exports, refreshes live state, and tombstones them on deselection', async () => {
  const home = new StandaloneHomeService();
  await home.onModuleInit();
  home.registerDevice(localDevice);
  const preferences = new DefaultPreferencesService();
  const service = new MqttService(
    home,
    { host: '127.0.0.1', port: 0, allowAnonymous: true },
    undefined,
    undefined,
    preferences,
  );
  let client: HausMqttClient | undefined;
  const received: MqttMessage[] = [];
  const publications = vi.spyOn(service.broker, 'publish');
  try {
    await service.onApplicationBootstrap();
    client = new HausMqttClient({
      host: '127.0.0.1',
      port: service.broker.port,
      allowAnonymous: true,
    });
    await client.connect({ reconnectPeriod: 0 });
    await client.subscribe('homeassistant/#', (message) => {
      received.push(message);
    });
    await client.subscribe('haus/#', (message) => {
      received.push(message);
    });

    const current = await preferences.get();
    await preferences.patch(current.revision, { mqttExportDevices: [localDevice.id] });
    await vi.waitFor(() => {
      expect(received.some((message) => message.topic.endsWith('/config'))).toBe(true);
      expect(received.some((message) => message.payload === '21.5')).toBe(true);
      expect(received.some((message) => message.payload === 'online')).toBe(true);
    });

    await home.updateEndpointState('workshop-temperature', { temperature: 22.25 });
    await vi.waitFor(() => {
      expect(publications).toHaveBeenCalledWith(expect.objectContaining({ payload: '22.25' }));
    });
    await vi.waitFor(() => expect(received.some((message) => message.payload === '22.25')).toBe(true));

    const selected = await preferences.get();
    await preferences.patch(selected.revision, { mqttExportDevices: [] });
    await vi.waitFor(() => {
      expect(received.some((message) => message.topic.endsWith('/config') && !message.payload)).toBe(
        true,
      );
    });

    const deselected = await preferences.get();
    await preferences.patch(deselected.revision, { mqttExportDevices: [localDevice.id] });
    await vi.waitFor(() =>
      expect(
        received.some((message) => message.topic.endsWith('/config') && message.payload),
      ).toBe(true),
    );
    home.removeDevice(localDevice.id);
    await vi.waitFor(() =>
      expect(
        received.some((message) => message.topic.includes('/state/') && !message.payload),
      ).toBe(true),
    );
  } finally {
    await client?.close();
    await service.onApplicationShutdown();
    vi.restoreAllMocks();
  }
});

it('restores retained opt-in exports after a broker restart and persists deselection tombstones', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-mqtt-export-'));
  const source = await openCatalog(join(directory, 'haus.sqlite'));
  const transactions = new Transactions(source);
  const home = new StandaloneHomeService(undefined, transactions);
  await home.onModuleInit();
  home.registerDevice(localDevice);
  const firstPreferences = new DefaultPreferencesService(transactions);
  const firstSettings = await firstPreferences.get();
  await firstPreferences.patch(firstSettings.revision, {
    mqttExportDevices: [localDevice.id],
  });
  const firstService = new MqttService(
    home,
    { host: '127.0.0.1', port: 0, allowAnonymous: true },
    transactions,
    undefined,
    firstPreferences,
  );
  let firstClient: HausMqttClient | undefined;
  let secondClient: HausMqttClient | undefined;
  let secondService: MqttService | undefined;
  try {
    await firstService.onApplicationBootstrap();
    firstClient = new HausMqttClient({
      host: '127.0.0.1',
      port: firstService.broker.port,
      allowAnonymous: true,
    });
    await firstClient.connect({ reconnectPeriod: 0 });
    const firstMessages: MqttMessage[] = [];
    await firstClient.subscribe('homeassistant/#', (message) => {
      firstMessages.push(message);
    });
    await firstClient.subscribe('haus/#', (message) => {
      firstMessages.push(message);
    });
    await vi.waitFor(() => expect(firstMessages.some((message) => message.payload === '21.5')).toBe(true));
    await firstClient.close();
    firstClient = undefined;
    await firstService.onApplicationShutdown();

    const secondPreferences = new DefaultPreferencesService(transactions);
    secondService = new MqttService(
      home,
      { host: '127.0.0.1', port: 0, allowAnonymous: true },
      transactions,
      undefined,
      secondPreferences,
    );
    await secondService.onApplicationBootstrap();
    secondClient = new HausMqttClient({
      host: '127.0.0.1',
      port: secondService.broker.port,
      allowAnonymous: true,
    });
    await secondClient.connect({ reconnectPeriod: 0 });
    const restored: MqttMessage[] = [];
    await secondClient.subscribe('homeassistant/#', (message) => {
      restored.push(message);
    });
    await secondClient.subscribe('haus/#', (message) => {
      restored.push(message);
    });
    await vi.waitFor(() => {
      expect(restored.some((message) => message.topic.endsWith('/config'))).toBe(true);
      expect(restored.some((message) => message.payload === '21.5')).toBe(true);
      expect(restored.some((message) => message.payload === 'online')).toBe(true);
    });

    const current = await secondPreferences.get();
    await secondPreferences.patch(current.revision, { mqttExportDevices: [] });
    await vi.waitFor(() => {
      expect(restored.some((message) => message.topic.endsWith('/config') && !message.payload)).toBe(
        true,
      );
    });
    const nodeId = hausDiscoveryNodeId('home-default');
    const retained = await new OrmMqttRetention(
      transactions,
      new DiscoveryTopics(),
      nodeId,
    ).load();
    expect(retained.some((packet) => packet.topic.endsWith('/config') && packet.payload.length === 0)).toBe(
      true,
    );
  } finally {
    await firstClient?.close();
    await firstService.onApplicationShutdown();
    await secondClient?.close();
    await secondService?.onApplicationShutdown();
    await transactions.drain();
    if (source.isInitialized) await source.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});

it('routes only authenticated, fresh on/off exports through Haus command handling', async () => {
  const projected = projectMqttEndpoint({
    device: localSwitch,
    endpointId: 'workshop-switch',
    capabilityId: 'on_off',
    selectedDeviceIds: new Set([localSwitch.id]),
    allowCommands: true,
    homeId: 'home-default',
  });
  expect(projected.kind, JSON.stringify(projected)).toBe('projected');
  const home = new StandaloneHomeService();
  await home.onModuleInit();
  home.registerDevice(localSwitch);
  const execute = vi.fn(async (_endpointId: string, _capability: string, command: string) => {
    if (command === 'turn_off') throw Error('simulated_uncertain_device_ack');
  });
  home.registerCommandHandler('matter', execute);
  const preferences = new DefaultPreferencesService();
  const current = await preferences.get();
  await preferences.patch(current.revision, { mqttExportDevices: [localSwitch.id] });
  const service = new MqttService(
    home,
    {
      host: '127.0.0.1',
      port: 0,
      allowAnonymous: false,
      username: 'fixture-user',
      password: 'fixture-password',
    },
    undefined,
    undefined,
    preferences,
  );
  let client: HausMqttClient | undefined;
  try {
    await service.onApplicationBootstrap();
    client = new HausMqttClient({
      host: '127.0.0.1',
      port: service.broker.port,
      allowAnonymous: false,
      username: 'fixture-user',
      password: 'fixture-password',
    });
    await client.connect({ reconnectPeriod: 0 });
    const discoveries: MqttMessage[] = [];
    await client.subscribe('homeassistant/#', (message) => {
      discoveries.push(message);
    });
    let commandTopic = '';
    let stateTopic = '';
    await vi.waitFor(() => {
      const config = discoveries.find((message) => message.topic.endsWith('/config'));
      expect(config).toBeDefined();
      const payload = JSON.parse(config?.payload ?? '{}') as {
        command_topic?: string;
        state_topic?: string;
      };
      expect(payload.command_topic).toMatch(/^haus\/.+\/command\/[a-f0-9]{24}$/);
      commandTopic = payload.command_topic ?? '';
      stateTopic = payload.state_topic ?? '';
    });
    const states: MqttMessage[] = [];
    await client.subscribe(stateTopic, (message) => {
      states.push(message);
    });
    await vi.waitFor(() => expect(states.at(-1)?.payload).toBe('OFF'));

    await client.publish({ topic: commandTopic, payload: 'ON', qos: 1 });
    await service.drain();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenLastCalledWith('workshop-switch', 'on_off', 'turn_on', undefined);
    expect(states.at(-1)?.payload).toBe('OFF');

    await home.updateEndpointState('workshop-switch', { on_off: true });
    await vi.waitFor(() => expect(states.at(-1)?.payload).toBe('ON'));

    await service.publish({ topic: commandTopic, payload: 'ON', qos: 1 });
    service.broker.emit('message', {
      topic: commandTopic,
      payload: 'OFF',
      authenticated: false,
    } satisfies MqttMessage);
    service.broker.emit('message', {
      topic: commandTopic,
      payload: 'ON',
      authenticated: true,
      duplicate: true,
    } satisfies MqttMessage);
    await client.publish({ topic: commandTopic, payload: 'toggle', qos: 1 });
    await service.drain();
    expect(execute).toHaveBeenCalledTimes(1);

    await client.publish({ topic: commandTopic, payload: 'OFF', qos: 1, retain: true });
    await service.drain();
    expect(execute).toHaveBeenCalledTimes(1);

    await client.publish({ topic: commandTopic, payload: 'OFF', qos: 1 });
    await service.drain();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.payload).toBe('ON');

    await client.close();
    await client.connect({ reconnectPeriod: 0 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await service.drain();
    expect(execute).toHaveBeenCalledTimes(2);
    await client.close();
  } finally {
    await client?.close();
    await service.onApplicationShutdown();
    vi.restoreAllMocks();
  }
});

it('clears retained exported commands before broker restore without executing them', async () => {
  const projected = projectMqttEndpoint({
    device: localSwitch,
    endpointId: 'workshop-switch',
    capabilityId: 'on_off',
    selectedDeviceIds: new Set([localSwitch.id]),
    allowCommands: true,
    homeId: 'home-default',
  });
  if (projected.kind !== 'projected' || !projected.projection.commandTopic)
    throw Error('expected_mqtt_export_projection');

  const retained = new Map<string, RetainedPacket>([
    [
      projected.projection.commandTopic,
      {
        topic: projected.projection.commandTopic,
        payload: Buffer.from('ON'),
        qos: 1,
      },
    ],
  ]);
  const retainedStore: RetainedStore = {
    load: async () => [...retained.values()],
    save: async (packet) => {
      retained.set(packet.topic, packet);
    },
  };
  const home = new StandaloneHomeService();
  await home.onModuleInit();
  home.registerDevice(localSwitch);
  const execute = vi.fn();
  home.registerCommandHandler('matter', execute, { optimistic: false });
  const preferences = new DefaultPreferencesService();
  const current = await preferences.get();
  await preferences.patch(current.revision, { mqttExportDevices: [localSwitch.id] });
  const service = new MqttService(
    home,
    {
      host: '127.0.0.1',
      port: 0,
      allowAnonymous: false,
      username: 'fixture-user',
      password: 'fixture-password',
      retainedStore,
    },
    undefined,
    undefined,
    preferences,
  );

  try {
    await service.onApplicationBootstrap();
    expect(execute).not.toHaveBeenCalled();
    expect(Buffer.from(retained.get(projected.projection.commandTopic)?.payload ?? []).length).toBe(
      0,
    );
  } finally {
    await service.onApplicationShutdown();
  }
});

it('does not optimistically accept observed-only commands without a source handler', async () => {
  const home = new StandaloneHomeService();
  await home.onModuleInit();
  home.registerDevice(localSwitch);

  await expect(
    home.executeObservedDeviceCommand('workshop-switch', 'on_off', 'turn_on'),
  ).rejects.toThrow('device_command_handler_unavailable');
  expect(home.getEndpointState('workshop-switch').on_off).toBe(false);
});
