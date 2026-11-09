/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mqttFixture } from './fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function boot(path?: string) {
  const fixture = await mqttFixture(path);
  cleanups.push(() => fixture.close());
  return fixture;
}
const config = (device: string, id: string, command: string) => ({
  device: { identifiers: [device], name: 'Workshop relay' },
  unique_id: id,
  state_topic: `${command}/state`,
  command_topic: `${command}/set`,
});

it('keeps different raw device IDs separate when sanitization produces the same spelling', async () => {
  const f = await boot();
  await f.publish('homeassistant/switch/a/config', config('panel:a', 'first', 'fixture/a'));
  await f.publish('homeassistant/switch/b/config', config('panel/a', 'second', 'fixture/b'));
  await vi.waitFor(() => expect(f.home.listDevices()).toHaveLength(2));
  expect(new Set(f.home.listDevices().map((device) => device.id)).size).toBe(2);
  expect(
    f.home
      .listDevices()
      .map((device) => device.source.externalId)
      .sort(),
  ).toEqual(['panel/a', 'panel:a']);
});

it('isolates equal entity IDs by physical device and platform, including command routing', async () => {
  const f = await boot();
  await f.publish('homeassistant/switch/a/config', config('panel-a', 'shared', 'fixture/a'));
  await f.publish('homeassistant/switch/b/config', config('panel-b', 'shared', 'fixture/b'));
  await f.publish(
    'homeassistant/sensor/a/config',
    config('panel-a', 'shared', 'fixture/temperature'),
  );
  await vi.waitFor(() =>
    expect(f.home.listDevices().flatMap((device) => device.endpoints)).toHaveLength(3),
  );
  const a = f.home.listDevices().find((device) => device.source.externalId === 'panel-a');
  const b = f.home.listDevices().find((device) => device.source.externalId === 'panel-b');
  const switchA = a?.endpoints.find((endpoint) => endpoint.category === 'power');
  const switchB = b?.endpoints.find((endpoint) => endpoint.category === 'power');
  expect(switchA?.id).toBeDefined();
  expect(switchB?.id).not.toBe(switchA?.id);
  const commands: string[] = [];
  await f.client.subscribe('fixture/+/set', (message) => {
    commands.push(`${message.topic}:${message.payload}`);
  });
  await f.home.executeDeviceCommand(switchA?.id ?? '', 'power', 'turn_on');
  await f.home.executeDeviceCommand(switchB?.id ?? '', 'power', 'turn_off');
  await vi.waitFor(() => expect(commands).toEqual(['fixture/a/set:ON', 'fixture/b/set:OFF']));
});

it('keeps an installed endpoint ID and state when its producer switches from single to bundled discovery', async () => {
  const f = await boot();
  await f.publish('homeassistant/switch/relay/config', config('panel', 'relay', 'fixture/old'));
  await f.publish('fixture/old/state', 'ON');
  await vi.waitFor(() => expect(f.home.getEndpointState('ep_mqtt_relay').on_off).toBe(true));
  f.home.registerScene({
    schemaVersion: 1,
    id: 'fixture-scene',
    name: 'Workshop on',
    members: [{ endpointId: 'ep_mqtt_relay', targetState: { on_off: true } }],
  });
  await f.publish('homeassistant/device/panel/config', {
    dev: { ids: ['panel'], name: 'Workshop relay' },
    cmps: {
      main: {
        p: 'switch',
        unique_id: 'relay',
        stat_t: 'fixture/new/state',
        cmd_t: 'fixture/new/set',
      },
    },
  });
  await vi.waitFor(() => expect(f.home.listDevices()[0]?.endpoints).toHaveLength(1));
  expect(f.home.listDevices()[0]?.endpoints[0]?.id).toBe('ep_mqtt_relay');
  expect(f.home.getEndpointState('ep_mqtt_relay').on_off).toBe(true);
  await f.publish('homeassistant/switch/relay/config', '');
  expect(f.home.listDevices()[0]?.endpoints[0]?.id).toBe('ep_mqtt_relay');
  const commands: string[] = [];
  await f.client.subscribe('fixture/new/set', (message) => {
    commands.push(message.payload);
  });
  await f.home.executeDeviceCommand('ep_mqtt_relay', 'power', 'turn_off');
  await vi.waitFor(() => expect(commands).toEqual(['OFF']));
  expect(f.home.listScenes()[0]?.members[0]?.endpointId).toBe('ep_mqtt_relay');
  await f.home.activateScene('fixture-scene');
  await vi.waitFor(() => expect(commands).toEqual(['OFF', 'ON']));
});

it('retains collision allocations after cold restart and deleting/readding a source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-mqtt-ids-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'catalog.sqlite');
  const first = await boot(path);
  await first.publish('homeassistant/switch/a/config', config('panel', 'relay:a', 'fixture/a'));
  await first.publish('homeassistant/switch/b/config', config('panel', 'relay/a', 'fixture/b'));
  await vi.waitFor(() => expect(first.home.listDevices()[0]?.endpoints).toHaveLength(2));
  const ids = first.home
    .listDevices()[0]
    ?.endpoints.map((endpoint) => endpoint.id)
    .sort();
  await first.close();
  const second = await boot(path);
  expect(
    second.home
      .listDevices()[0]
      ?.endpoints.map((endpoint) => endpoint.id)
      .sort(),
  ).toEqual(ids);
  await second.publish('homeassistant/switch/a/config', '');
  await second.publish('homeassistant/switch/b/config', '');
  await vi.waitFor(() => expect(second.home.listDevices()).toHaveLength(0));
  await second.close();
  const third = await boot(path);
  await third.publish('homeassistant/switch/b/config', config('panel', 'relay/a', 'fixture/b'));
  await third.publish('homeassistant/switch/a/config', config('panel', 'relay:a', 'fixture/a'));
  await vi.waitFor(() => expect(third.home.listDevices()[0]?.endpoints).toHaveLength(2));
  expect(
    third.home
      .listDevices()[0]
      ?.endpoints.map((endpoint) => endpoint.id)
      .sort(),
  ).toEqual(ids);
});

it('keeps allocated physical devices intact across legacy startup cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-mqtt-device-ids-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'catalog.sqlite');
  const first = await boot(path);
  await first.publish('homeassistant/switch/a/config', config('panel:a', 'main', 'fixture/a'));
  const extra = config('panel/a', 'extra', 'fixture/b');
  await first.publish('homeassistant/switch/b/config', {
    ...extra,
    device: { ...extra.device, name: 'Workshop relay extra' },
  });
  await vi.waitFor(() => expect(first.home.listDevices()).toHaveLength(2));
  const before = first.home
    .listDevices()
    .map((device) => [
      device.id,
      device.source.externalId,
      device.endpoints.map((endpoint) => endpoint.id),
    ]);
  await first.close();
  const second = await boot(path);
  expect(
    second.home
      .listDevices()
      .map((device) => [
        device.id,
        device.source.externalId,
        device.endpoints.map((endpoint) => endpoint.id),
      ]),
  ).toEqual(before);
});

it('rejects duplicate component identity within a bundle without partly registering it', async () => {
  const f = await boot();
  const warnings = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  await f.publish('homeassistant/device/panel/config', {
    dev: { ids: ['panel'] },
    cmps: {
      first: { p: 'switch', unique_id: 'duplicate', cmd_t: 'fixture/a/set' },
      second: { p: 'switch', unique_id: 'duplicate', cmd_t: 'fixture/b/set' },
    },
  });
  await vi.waitFor(() => expect(warnings).toHaveBeenCalledWith('mqtt_discovery_identity_conflict'));
  expect(f.home.listDevices()).toHaveLength(0);
});
