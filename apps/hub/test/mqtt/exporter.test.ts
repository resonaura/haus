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
  type MqttMessage,
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
