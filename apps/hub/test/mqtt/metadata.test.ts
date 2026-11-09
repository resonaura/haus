/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { mqttFixture } from './fixture.js';

const fixtures: Array<Awaited<ReturnType<typeof mqttFixture>>> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

it('preserves MQTT metadata, resolves a late bridge, then removes an explicit bridge link', async () => {
  const fixture = await mqttFixture();
  fixtures.push(fixture);
  await fixture.publish('homeassistant/switch/child/config', {
    platform: 'switch',
    unique_id: 'child-switch',
    state_topic: 'fixture/child/state',
    device: {
      identifiers: ['child-primary', 'child-secondary'],
      connections: [
        ['mac', '00:11:22:33:44:55'],
        ['zigbee', '0x00124b0001'],
      ],
      name: 'Child device',
      serial_number: 'serial-7',
      hw_version: 'rev-2',
      model_id: 'child-model',
      configuration_url: 'https://example.test/config?token=private#settings',
      via_device: 'bridge-id',
    },
    origin: {
      name: 'Fixture bridge',
      sw_version: '1.2.3',
      support_url: 'https://example.test/support?token=private#details',
    },
  });

  let child = fixture.home
    .listDevices()
    .find((device) => device.source.externalId === 'child-primary');
  await vi.waitFor(() => {
    child = fixture.home
      .listDevices()
      .find((device) => device.source.externalId === 'child-primary');
    expect(child).toBeDefined();
  });
  expect(child?.hardwareVersion).toBe('rev-2');
  expect(child?.serialNumber).toBe('serial-7');
  expect(child?.relationships).toEqual([]);
  const source = child?.sourceRefs?.find((reference) => reference.protocol === 'mqtt');
  expect(source?.metadata?.['discovery']).toMatchObject({
    identifiers: ['child-primary', 'child-secondary'],
    connections: [
      ['mac', '00:11:22:33:44:55'],
      ['zigbee', '0x00124b0001'],
    ],
    viaDevice: 'bridge-id',
    origin: {
      name: 'Fixture bridge',
      sw_version: '1.2.3',
      support_url: 'https://example.test/support',
    },
    modelId: 'child-model',
    configurationUrl: 'https://example.test/config',
  });

  await fixture.publish('homeassistant/switch/bridge/config', {
    platform: 'switch',
    unique_id: 'bridge-switch',
    device: { identifiers: ['bridge-primary', 'bridge-id'], name: 'Bridge' },
  });
  await vi.waitFor(() => {
    child = fixture.home.listDevices().find((device) => device.source.externalId === 'child-primary');
    expect(child?.relationships).toEqual([
      {
        type: 'bridged',
        targetDeviceId: 'mqtt_bridge-primary',
        metadata: { source: 'mqtt-discovery', viaDevice: 'bridge-id' },
      },
    ]);
  });

  await fixture.publish('homeassistant/switch/bridge/config', '');
  await vi.waitFor(() => {
    child = fixture.home.listDevices().find((device) => device.source.externalId === 'child-primary');
    expect(child?.relationships).toEqual([]);
  });
  await fixture.publish('homeassistant/switch/bridge/config', {
    platform: 'switch',
    unique_id: 'bridge-switch',
    device: { identifiers: ['bridge-primary', 'bridge-id'], name: 'Bridge' },
  });
  await vi.waitFor(() => {
    child = fixture.home.listDevices().find((device) => device.source.externalId === 'child-primary');
    expect(child?.relationships).toHaveLength(1);
  });

  await fixture.publish('homeassistant/switch/child/config', {
    platform: 'switch',
    unique_id: 'child-switch',
    state_topic: 'fixture/child/state',
    device: { identifiers: ['child-primary', 'child-secondary'], name: 'Child device' },
  });
  await vi.waitFor(() => {
    child = fixture.home.listDevices().find((device) => device.source.externalId === 'child-primary');
    expect(child?.relationships).toEqual([]);
  });
});

it('does not resolve via-device by a matching display name', async () => {
  const fixture = await mqttFixture();
  fixtures.push(fixture);
  await fixture.publish('homeassistant/switch/child/config', {
    platform: 'switch',
    unique_id: 'child-switch',
    device: { identifiers: ['child'], name: 'Bridge', via_device: 'missing-id' },
  });
  await fixture.publish('homeassistant/switch/other/config', {
    platform: 'switch',
    unique_id: 'other-switch',
    device: { identifiers: ['other'], name: 'Bridge' },
  });
  await vi.waitFor(() => expect(fixture.home.listDevices()).toHaveLength(2));
  const child = fixture.home.listDevices().find((device) => device.source.externalId === 'child');
  expect(child?.relationships).toEqual([]);
});

it('leaves via-device unresolved when an identifier belongs to multiple devices', async () => {
  const fixture = await mqttFixture();
  fixtures.push(fixture);
  await fixture.publish('homeassistant/switch/child/config', {
    platform: 'switch',
    unique_id: 'child-switch',
    device: { identifiers: ['child'], name: 'Child', via_device: 'shared-id' },
  });
  await fixture.publish('homeassistant/switch/bridge-a/config', {
    platform: 'switch',
    unique_id: 'bridge-a-switch',
    device: { identifiers: ['bridge-a', 'shared-id'], name: 'Bridge A' },
  });
  await fixture.publish('homeassistant/switch/bridge-b/config', {
    platform: 'switch',
    unique_id: 'bridge-b-switch',
    device: { identifiers: ['bridge-b', 'shared-id'], name: 'Bridge B' },
  });

  await vi.waitFor(() => expect(fixture.home.listDevices()).toHaveLength(3));
  const child = fixture.home.listDevices().find((device) => device.source.externalId === 'child');
  expect(child?.relationships).toEqual([]);
});
