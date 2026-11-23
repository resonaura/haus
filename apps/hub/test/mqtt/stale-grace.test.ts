/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceServiceRef } from '@haus/core';
import {
  DiscoveryTopics,
  HausMqttClient,
  type MqttDiscoveryClaim,
  type RetainedPacket,
  type RetainedStore,
} from '@haus/mqtt';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { MqttService } from '../../src/mqtt/service.js';
import { DiscoveryBindings } from '../../src/mqtt/bindings.js';
import { MqttDiscovery } from '../../src/mqtt/discovery.js';
import { MemoryMqttIdentities, MqttIdentities } from '../../src/mqtt/identity.js';
import { DEFAULT_MQTT_STALE_GRACE_MS, MqttRecovery } from '../../src/mqtt/recovery.js';
import { MemoryMqttStaleStore } from '../../src/mqtt/stale-store.js';
import { computeNextTombstonedClaims } from '../../src/storage/mqtt/retention.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

const silentLogger = { log: () => undefined, warn: () => undefined };

function createDiscoveryHarness(opts: {
  readonly home?: StandaloneHomeService;
  readonly identitiesRepo?: MemoryMqttIdentities;
  readonly staleStore?: MemoryMqttStaleStore;
  readonly staleGraceMs?: number;
  readonly now?: () => number;
}) {
  const home = opts.home ?? new StandaloneHomeService();
  const identitiesRepo = opts.identitiesRepo ?? new MemoryMqttIdentities();
  const staleStore = opts.staleStore ?? new MemoryMqttStaleStore();
  const bindings = new DiscoveryBindings();
  const identities = new MqttIdentities(identitiesRepo, 'home-default', () => home.listDevices());
  const discovery = new MqttDiscovery(
    home,
    bindings,
    new DiscoveryTopics(),
    silentLogger,
    identities,
    {
      staleStore,
      staleGraceMs: opts.staleGraceMs,
      staleSweepIntervalMs: 0,
      now: opts.now,
    },
  );
  return { home, identitiesRepo, staleStore, bindings, identities, discovery };
}

describe('MQTT reboot preservation and stale dead-souls grace period', () => {
  it('defaults the stale dead-souls grace period to 7 days', () => {
    expect(DEFAULT_MQTT_STALE_GRACE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('keeps persisted MQTT devices across reboots when discovery was not retained and preserves firstMissingAt', async () => {
    let clock = 1_000_000;
    const graceMs = 7 * 24 * 60 * 60 * 1000;
    const home = new StandaloneHomeService();
    const identitiesRepo = new MemoryMqttIdentities();
    const staleStore = new MemoryMqttStaleStore();

    // Boot 1: bridge discovers Govee lamp (non-retained) and reports state.
    const boot1 = createDiscoveryHarness({
      home,
      identitiesRepo,
      staleStore,
      staleGraceMs: graceMs,
      now: () => clock,
    });
    await boot1.discovery.handle({
      topic: 'homeassistant/light/gv2mqtt-bed-lamp/config',
      payload: JSON.stringify({
        unique_id: 'gv2mqtt-bed-lamp',
        name: 'Bed Lamp',
        schema: 'json',
        state_topic: 'gv2mqtt/light/bed-lamp/state',
        command_topic: 'gv2mqtt/light/bed-lamp/command',
        device: { identifiers: ['gv2mqtt-bed-lamp'], name: 'Bed Lamp', manufacturer: 'Govee' },
      }),
      retained: false,
    });
    await home.updateEndpointState('ep_mqtt_gv2mqtt-bed-lamp', { state: 'on', on_off: true }, false);
    expect(home.getDevice('mqtt_gv2mqtt-bed-lamp')).toBeDefined();

    // Boot 2 (reboot 1 minute later): retained store has NO claims for this non-retained device.
    clock += 60_000;
    const boot2 = createDiscoveryHarness({
      home,
      identitiesRepo,
      staleStore,
      staleGraceMs: graceMs,
      now: () => clock,
    });
    await boot2.discovery.reconcile([], []);
    expect(home.getDevice('mqtt_gv2mqtt-bed-lamp')).toBeDefined();
    expect(home.getEndpointState('ep_mqtt_gv2mqtt-bed-lamp').on_off).toBe(true);
    expect((await staleStore.load()).get('ep_mqtt_gv2mqtt-bed-lamp')).toBe(1_060_000);

    // Boot 3 (reboot 3 days later): still well within 7-day grace; original timestamp is preserved.
    clock += 3 * 24 * 60 * 60 * 1000;
    const boot3 = createDiscoveryHarness({
      home,
      identitiesRepo,
      staleStore,
      staleGraceMs: graceMs,
      now: () => clock,
    });
    await boot3.discovery.reconcile([], []);
    expect(home.getDevice('mqtt_gv2mqtt-bed-lamp')).toBeDefined();
    expect((await staleStore.load()).get('ep_mqtt_gv2mqtt-bed-lamp')).toBe(1_060_000);

    // Boot 4 (after full 7 days since firstMissingAt): dead soul is finally cleaned up.
    clock = 1_060_000 + graceMs;
    const boot4 = createDiscoveryHarness({
      home,
      identitiesRepo,
      staleStore,
      staleGraceMs: graceMs,
      now: () => clock,
    });
    await boot4.discovery.reconcile([], []);
    expect(home.getDevice('mqtt_gv2mqtt-bed-lamp')).toBeUndefined();
    expect(home.listEndpointStates()).not.toHaveProperty('ep_mqtt_gv2mqtt-bed-lamp');
    expect((await staleStore.load()).size).toBe(0);
  });

  it('clears stale tracking as soon as live discovery returns after reboot and never prunes alive devices', async () => {
    let clock = 5_000;
    const graceMs = 24 * 60 * 60 * 1000;
    const home = new StandaloneHomeService();
    const identitiesRepo = new MemoryMqttIdentities();
    const staleStore = new MemoryMqttStaleStore();

    const discoveryMsg = {
      topic: 'homeassistant/switch/workshop/relay/config',
      payload: JSON.stringify({
        unique_id: 'workshop-relay',
        name: 'Workshop Relay',
        state_topic: 'workshop/relay/state',
        command_topic: 'workshop/relay/set',
        device: { identifiers: ['workshop-panel'], name: 'Workshop Panel' },
      }),
      retained: false,
    };

    const boot1 = createDiscoveryHarness({
      home,
      identitiesRepo,
      staleStore,
      staleGraceMs: graceMs,
      now: () => clock,
    });
    await boot1.discovery.handle(discoveryMsg);

    // Reboot: unclaimed at boot -> recorded as missing, device stays.
    clock += 10_000;
    const boot2 = createDiscoveryHarness({
      home,
      identitiesRepo,
      staleStore,
      staleGraceMs: graceMs,
      now: () => clock,
    });
    await boot2.discovery.reconcile([], []);
    expect(home.getDevice('mqtt_workshop-panel')).toBeDefined();
    expect((await staleStore.load()).has('ep_mqtt_workshop-relay')).toBe(true);

    // Bridge reconnects 5s later and re-announces discovery.
    clock += 5_000;
    await boot2.discovery.handle(discoveryMsg);
    expect((await staleStore.load()).has('ep_mqtt_workshop-relay')).toBe(false);

    // Advance far beyond grace period and run sweep -> device stays because it's alive.
    clock += graceMs * 10;
    expect(await boot2.discovery.sweepStale()).toBe(0);
    expect(home.getDevice('mqtt_workshop-panel')).toBeDefined();
  });

  it('prunes expired dead souls during periodic sweepStale while keeping live siblings', async () => {
    let clock = 10_000;
    const graceMs = 60_000;
    const home = new StandaloneHomeService();
    const identitiesRepo = new MemoryMqttIdentities();
    const staleStore = new MemoryMqttStaleStore();

    const boot1 = createDiscoveryHarness({
      home,
      identitiesRepo,
      staleStore,
      staleGraceMs: graceMs,
      now: () => clock,
    });
    await boot1.discovery.handle({
      topic: 'homeassistant/switch/panel/alive/config',
      payload: JSON.stringify({
        unique_id: 'panel-alive',
        state_topic: 'panel/alive/state',
        device: { identifiers: ['panel-1'], name: 'Panel' },
      }),
      retained: false,
    });
    await boot1.discovery.handle({
      topic: 'homeassistant/sensor/panel/ghost/config',
      payload: JSON.stringify({
        unique_id: 'panel-ghost',
        state_topic: 'panel/ghost/state',
        device: { identifiers: ['panel-1'], name: 'Panel' },
      }),
      retained: false,
    });

    // Reboot: neither was retained; both survive boot.
    clock += 1_000;
    const boot2 = createDiscoveryHarness({
      home,
      identitiesRepo,
      staleStore,
      staleGraceMs: graceMs,
      now: () => clock,
    });
    await boot2.discovery.reconcile([], []);
    expect(home.getDevice('mqtt_panel-1')?.endpoints).toHaveLength(2);

    // Only `panel-alive` re-announces after reboot; `panel-ghost` never comes back.
    await boot2.discovery.handle({
      topic: 'homeassistant/switch/panel/alive/config',
      payload: JSON.stringify({
        unique_id: 'panel-alive',
        state_topic: 'panel/alive/state',
        device: { identifiers: ['panel-1'], name: 'Panel' },
      }),
      retained: false,
    });

    // Before grace expires: sweep keeps both.
    clock += 30_000;
    expect(await boot2.discovery.sweepStale()).toBe(0);
    expect(home.getDevice('mqtt_panel-1')?.endpoints).toHaveLength(2);

    // After grace expires: sweep removes only the dead soul `panel-ghost`.
    clock += 35_000;
    expect(await boot2.discovery.sweepStale()).toBe(1);
    expect(home.getDevice('mqtt_panel-1')?.endpoints.map((ep) => ep.id)).toEqual([
      'ep_mqtt_panel-alive',
    ]);
    expect((await staleStore.load()).size).toBe(0);
  });

  it('still applies explicit retained tombstones immediately while honoring active claims and native sources', async () => {
    const clock = 100_000;
    const home = new StandaloneHomeService();
    const identitiesRepo = new MemoryMqttIdentities();
    const staleStore = new MemoryMqttStaleStore();

    const boot1 = createDiscoveryHarness({
      home,
      identitiesRepo,
      staleStore,
      staleGraceMs: DEFAULT_MQTT_STALE_GRACE_MS,
      now: () => clock,
    });
    await boot1.discovery.handle({
      topic: 'homeassistant/switch/a/config',
      payload: JSON.stringify({
        unique_id: 'ep-tombstoned',
        state_topic: 'dev/a',
        device: { identifiers: ['dev-a'], name: 'Device A' },
      }),
      retained: true,
    });
    await boot1.discovery.handle({
      topic: 'homeassistant/switch/b/config',
      payload: JSON.stringify({
        unique_id: 'ep-shared-native',
        state_topic: 'dev/b',
        device: { identifiers: ['dev-b'], name: 'Device B' },
      }),
      retained: true,
    });
    const nativeRef: SourceServiceRef = {
      protocol: 'vendor',
      externalId: 'native:b',
      domain: 'switch',
    };
    const devB = home.getDevice('mqtt_dev-b')!;
    home.registerDevice({
      ...devB,
      services: [],
      endpoints: devB.endpoints.map((ep) => ({
        ...ep,
        sourceRefs: [...(ep.sourceRefs ?? []), nativeRef],
      })),
    });

    // Reboot with explicit tombstones for both endpoints:
    // - dev-a (pure MQTT) is immediately removed despite 7-day grace.
    // - dev-b (shared vendor + MQTT) strips only MQTT source and stays.
    const boot2 = createDiscoveryHarness({
      home,
      identitiesRepo,
      staleStore,
      staleGraceMs: DEFAULT_MQTT_STALE_GRACE_MS,
      now: () => clock + 100,
    });
    const tombstoned: MqttDiscoveryClaim[] = [
      { kind: 'device', device: 'dev-a' },
      { kind: 'endpoint', device: 'dev-a', component: 'switch', uniqueId: 'ep-tombstoned' },
      { kind: 'device', device: 'dev-b' },
      { kind: 'endpoint', device: 'dev-b', component: 'switch', uniqueId: 'ep-shared-native' },
    ];
    await boot2.discovery.reconcile([], tombstoned);

    expect(home.getDevice('mqtt_dev-a')).toBeUndefined();
    expect(home.getDevice('mqtt_dev-b')?.endpoints[0]?.sourceRefs).toEqual([nativeRef]);
  });

  it('preserves devices end-to-end across MqttService restart with empty retained store', async () => {
    let clock = 1_000;
    const home = new StandaloneHomeService();
    const staleStore = new MemoryMqttStaleStore();
    const emptyRetainedStore: RetainedStore = {
      load: async (): Promise<readonly RetainedPacket[]> => [],
      save: async () => undefined,
    };

    const first = new MqttService(home, {
      host: '127.0.0.1',
      port: 0,
      allowAnonymous: true,
      retainedStore: emptyRetainedStore,
      staleStore,
      staleGraceMs: DEFAULT_MQTT_STALE_GRACE_MS,
      staleSweepIntervalMs: 0,
      now: () => clock,
    });
    await first.onApplicationBootstrap();
    cleanups.push(() => first.onApplicationShutdown());

    const client = new HausMqttClient({
      host: '127.0.0.1',
      port: first.broker.port,
      allowAnonymous: true,
    });
    await client.connect({ reconnectPeriod: 0 });
    cleanups.push(() => client.close());

    await client.publish({
      topic: 'homeassistant/light/bed-lamp/config',
      payload: JSON.stringify({
        unique_id: 'bed-lamp-main',
        name: 'Bed Lamp',
        schema: 'json',
        state_topic: 'gv2mqtt/light/bed/state',
        command_topic: 'gv2mqtt/light/bed/command',
        device: { identifiers: ['bed-lamp'], name: 'Bed Lamp', manufacturer: 'Govee' },
      }),
      qos: 1,
      retain: false,
    });
    await vi.waitFor(() => expect(home.getDevice('mqtt_bed-lamp')).toBeDefined());
    await client.close();
    await first.onApplicationShutdown();

    // Restart MqttService against the same persisted Home state with empty retainedStore.
    clock += 15_000;
    const second = new MqttService(home, {
      host: '127.0.0.1',
      port: 0,
      allowAnonymous: true,
      retainedStore: emptyRetainedStore,
      staleStore,
      staleGraceMs: DEFAULT_MQTT_STALE_GRACE_MS,
      staleSweepIntervalMs: 0,
      now: () => clock,
    });
    await second.onApplicationBootstrap();
    cleanups.push(() => second.onApplicationShutdown());

    expect(home.getDevice('mqtt_bed-lamp')).toBeDefined();
    expect(home.getDevice('mqtt_bed-lamp')?.endpoints).toHaveLength(1);
    // Still works cleanly with MqttRecovery sweep API.
    expect(await second.sweepStale()).toBe(0);
    expect(MqttRecovery).toBeDefined();
  });

  it('tracks explicit removed/replaced claims on a retained topic and clears them when re-announced', () => {
    const dev: MqttDiscoveryClaim = { kind: 'device', device: 'panel' };
    const claim = (component: string, uniqueId: string): MqttDiscoveryClaim => ({
      kind: 'endpoint',
      device: 'panel',
      component,
      uniqueId,
    });
    const relay = claim('switch', 'relay');
    const temp = claim('sensor', 'temp');
    const replacement = claim('switch', 'replacement');

    const removedOne = computeNextTombstonedClaims([], [dev, relay, temp], [dev, temp]);
    expect(removedOne).toEqual([relay]);
    const replaced = computeNextTombstonedClaims(
      removedOne,
      [dev, temp],
      [dev, temp, replacement],
    );
    expect(replaced).toEqual([relay]);
    const readded = computeNextTombstonedClaims(
      replaced,
      [dev, temp, replacement],
      [dev, relay, temp],
    );
    expect(readded).toEqual([replacement]);
    expect(computeNextTombstonedClaims([], [dev, relay, temp], [])).toEqual([dev, relay, temp]);
  });

  it('deduplicates legacy duplicate MQTT devices sharing the same externalId on startup without corrupting hash-suffixed discovery devices', async () => {
    const home = new StandaloneHomeService();
    const cap = { id: 'water_heater', kind: 'complex' as const, readable: true, operations: [] };
    home.registerDevice({
      id: 'mqtt_haus_kettle_873226972',
      source: { instanceId: 'haus-mqtt', externalId: 'haus_kettle_873226972' },
      name: 'Kitchen Kettle',
      category: 'appliances',
      roomId: 'kitchen',
      areaId: 'kitchen',
      availability: 'online',
      connectivity: { protocol: 'mqtt' },
      sourceRefs: [{ protocol: 'mqtt', externalId: 'haus_kettle_873226972' }],
      endpoints: [
        {
          id: 'ep_haus_kettle_873226972_kettle',
          name: 'Kitchen Kettle',
          category: 'appliances',
          capabilities: [cap],
          readings: {},
        },
      ],
    });
    await home.updateEndpointState('ep_haus_kettle_873226972_kettle', { status: 0, fault: 0 });
    home.registerDevice({
      id: 'mqtt_haus_kettle_873226972-0748254b00f57d4d',
      source: { instanceId: 'haus-mqtt', externalId: 'haus_kettle_873226972' },
      name: 'Kitchen Kettle',
      category: 'appliances',
      roomId: 'unassigned',
      availability: 'online',
      connectivity: { protocol: 'mqtt' },
      sourceRefs: [
        { protocol: 'mqtt', externalId: 'haus_kettle_873226972-0748254b00f57d4d' },
        {
          protocol: 'mqtt',
          externalId: 'haus_kettle_873226972',
          metadata: { discovery: { identifiers: ['haus_kettle_873226972'] } },
        },
      ],
      endpoints: [
        {
          id: 'ep_haus_kettle_873226972_kettle-08f89f25b587c752',
          name: 'Kitchen Kettle',
          category: 'appliances',
          capabilities: [cap],
          readings: {},
          sourceRefs: [
            {
              protocol: 'mqtt',
              externalId: 'haus_kettle_873226972_kettle',
              domain: 'water_heater',
            },
          ],
        },
      ],
    });

    const service = new MqttService(home, {
      host: '127.0.0.1',
      port: 0,
      allowAnonymous: true,
      staleSweepIntervalMs: 0,
    });
    await service.onApplicationBootstrap();
    cleanups.push(() => service.onApplicationShutdown());

    expect(home.listDevices()).toHaveLength(1);
    const canonical = home.getDevice('mqtt_haus_kettle_873226972-0748254b00f57d4d');
    expect(canonical?.roomId).toBe('kitchen');
    expect(canonical?.source.externalId).toBe('haus_kettle_873226972');
    expect(canonical?.sourceRefs?.map((ref) => ref.externalId)).toEqual(['haus_kettle_873226972']);
    expect(home.getDevice('mqtt_haus_kettle_873226972')).toBeUndefined();
    expect(home.getEndpointState('ep_haus_kettle_873226972_kettle')).toEqual({});
  });
});
