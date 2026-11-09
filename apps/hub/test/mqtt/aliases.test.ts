/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Logger } from '@nestjs/common';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mqttFixture } from './fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

const config = (
  identifiers: readonly string[],
  stateTopic: string,
  commandTopic: string,
  connections?: readonly (readonly [string, string])[],
) => ({
  platform: 'switch',
  unique_id: 'relay',
  state_topic: stateTopic,
  command_topic: commandTopic,
  device: {
    identifiers,
    ...(connections ? { connections } : {}),
    name: 'Workshop relay',
  },
});

it('preserves device and endpoint IDs through a primary identifier change and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-mqtt-alias-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'catalog.sqlite');
  const first = await mqttFixture(path);
  cleanups.push(() => first.close());
  await first.publish(
    'homeassistant/switch/old/config',
    config(['panel-v1', 'hardware-serial'], 'fixture/old/state', 'fixture/old/set'),
  );
  await vi.waitFor(() => expect(first.home.listDevices()).toHaveLength(1));
  const oldDeviceId = first.home.listDevices()[0]?.id;
  const oldEndpointId = first.home.listDevices()[0]?.endpoints[0]?.id;

  await first.publish(
    'homeassistant/switch/new/config',
    config(['panel-v2', 'hardware-serial'], 'fixture/new/state', 'fixture/new/set'),
  );
  await vi.waitFor(() => {
    expect(first.home.listDevices()).toHaveLength(1);
    expect(first.home.listDevices()[0]?.source.externalId).toBe('panel-v2');
    expect(first.home.listDevices()[0]?.endpoints).toHaveLength(1);
  });
  expect(first.home.listDevices()[0]?.id).toBe(oldDeviceId);
  expect(first.home.listDevices()[0]?.endpoints[0]?.id).toBe(oldEndpointId);
  expect(
    first.home.listDevices()[0]?.sourceRefs
      ?.filter((reference) => reference.protocol === 'mqtt')
      .map((reference) => reference.externalId)
      .sort(),
  ).toEqual(['panel-v1', 'panel-v2']);

  await first.publish('homeassistant/switch/old/config', '');
  await vi.waitFor(() => expect(first.home.listDevices()[0]?.endpoints).toHaveLength(1));
  await first.close();

  const restored = await mqttFixture(path);
  cleanups.push(() => restored.close());
  await vi.waitFor(() => expect(restored.home.listDevices()).toHaveLength(1));
  expect(restored.home.listDevices()[0]?.id).toBe(oldDeviceId);
  expect(restored.home.listDevices()[0]?.endpoints[0]?.id).toBe(oldEndpointId);
  const commands: string[] = [];
  await restored.client.subscribe('fixture/new/set', (message) => {
    commands.push(message.payload);
  });
  await restored.home.executeDeviceCommand(oldEndpointId ?? '', 'power', 'turn_on');
  await vi.waitFor(() => expect(commands).toEqual(['ON']));
});

it('accepts a shared explicit connection as identity continuity', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  const connection = [['mac', '00:11:22:33:44:55']] as const;
  await fixture.publish(
    'homeassistant/switch/old/config',
    config(['panel-v1'], 'fixture/old/state', 'fixture/old/set', connection),
  );
  await vi.waitFor(() => expect(fixture.home.listDevices()).toHaveLength(1));
  const id = fixture.home.listDevices()[0]?.id;
  await fixture.publish(
    'homeassistant/switch/new/config',
    config(['panel-v2'], 'fixture/new/state', 'fixture/new/set', connection),
  );
  await vi.waitFor(() => expect(fixture.home.listDevices()[0]?.source.externalId).toBe('panel-v2'));
  expect(fixture.home.listDevices()).toHaveLength(1);
  expect(fixture.home.listDevices()[0]?.id).toBe(id);
});

it('rejects ambiguous and conflicting physical identifier matches', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  const warnings = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  await fixture.publish(
    'homeassistant/switch/a/config',
    config(['panel-a'], 'fixture/a/state', 'fixture/a/set'),
  );
  await fixture.publish(
    'homeassistant/switch/b/config',
    config(['panel-b'], 'fixture/b/state', 'fixture/b/set'),
  );
  await vi.waitFor(() => expect(fixture.home.listDevices()).toHaveLength(2));
  const ids = fixture.home.listDevices().map((device) => device.id).sort();

  await fixture.publish(
    'homeassistant/switch/c/config',
    config(['panel-c', 'panel-a', 'panel-b'], 'fixture/c/state', 'fixture/c/set'),
  );
  await vi.waitFor(() => {
    expect(warnings).toHaveBeenCalledWith('mqtt_identity_alias_ambiguous');
    expect(fixture.home.listDevices()).toHaveLength(3);
  });
  const c = fixture.home.listDevices().find((device) => device.source.externalId === 'panel-c');
  expect(c).toBeDefined();
  expect(ids).not.toContain(c?.id);
  const idsAfterAmbiguousDiscovery = fixture.home.listDevices().map((device) => device.id).sort();

  await fixture.publish(
    'homeassistant/switch/a/config',
    config(['panel-a', 'panel-b'], 'fixture/a/state', 'fixture/a/set'),
  );
  await vi.waitFor(() => expect(warnings).toHaveBeenCalledWith('mqtt_identity_alias_conflict'));
  expect(fixture.home.listDevices().map((device) => device.id).sort()).toEqual(idsAfterAmbiguousDiscovery);
});

it('rejects ambiguous pre-upgrade endpoint IDs without changing the existing graph or state', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  const warnings = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  const endpoint = (id: string) => ({
    id,
    name: 'Workshop relay',
    category: 'power' as const,
    capabilities: [
      { id: 'on_off', kind: 'binary' as const, readable: true, operations: ['set'] },
    ],
    readings: {},
  });
  fixture.home.registerDevice({
    id: 'mqtt_legacy-panel',
    source: { instanceId: 'haus-mqtt', externalId: 'legacy-panel' },
    name: 'Workshop relay',
    category: 'power',
    availability: 'online',
    connectivity: { protocol: 'mqtt' },
    endpoints: [endpoint('ep_mqtt_relay'), endpoint('ep_relay')],
  });
  await fixture.home.updateEndpointState('ep_mqtt_relay', { on_off: true });
  const before = fixture.home.listDevices();
  const readingBefore = fixture.home.getEndpointState('ep_mqtt_relay');

  await fixture.publish(
    'homeassistant/switch/relay/config',
    config(['legacy-panel'], 'fixture/new/state', 'fixture/new/set'),
  );
  await vi.waitFor(() =>
    expect(warnings).toHaveBeenCalledWith('mqtt_identity_ambiguous_legacy'),
  );

  expect(fixture.home.listDevices()).toEqual(before);
  expect(fixture.home.getEndpointState('ep_mqtt_relay')).toEqual(readingBefore);
});
