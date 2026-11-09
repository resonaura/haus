/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, expect, it, vi } from 'vitest';
import type { MqttEndpointBinding } from '@haus/mqtt';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MqttAvailability } from '../../src/mqtt/availability.js';
import { mqttFixture } from './fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

it('does not trust persisted availability until this process observes a status', () => {
  const tracker = new MqttAvailability();
  const binding: MqttEndpointBinding = {
    endpointId: 'ep_restart',
    deviceId: 'device_restart',
    component: 'switch',
    primaryCapabilityId: 'on_off',
    isJsonSchema: false,
    availability: {
      mode: 'latest',
      topics: [
        {
          topic: 'fixture/status',
          payload_available: 'online',
          payload_not_available: 'offline',
        },
      ],
    },
    payloadOn: 'ON',
    payloadOff: 'OFF',
  };

  expect(tracker.prepare(binding, undefined, 'online')).toBe('unknown');
  expect(tracker.update(binding, 'fixture/status', 'online')?.availability).toBe('online');
  expect(tracker.prepare(binding, binding, 'offline')).toBe('offline');
});

it('tracks LWT, birth and unknown availability without discarding the last reading', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  await fixture.publish('homeassistant/switch/relay/config', {
    unique_id: 'availability-relay',
    state_topic: 'fixture/relay/state',
    availability_topic: 'homeassistant/status',
    device: { identifiers: ['availability-panel'], name: 'Availability panel' },
  });

  await vi.waitFor(() =>
    expect(fixture.home.getDevice('mqtt_availability-panel')?.availability).toBe('unknown'),
  );
  await fixture.publish('fixture/relay/state', 'ON');
  await vi.waitFor(() =>
    expect(fixture.home.getEndpointState('ep_mqtt_availability-relay').on_off).toBe(true),
  );

  await fixture.publish('homeassistant/status', 'offline');
  await vi.waitFor(() => {
    const device = fixture.home.getDevice('mqtt_availability-panel');
    expect(device?.availability).toBe('offline');
    expect(device?.endpoints[0]?.availability).toBe('offline');
  });
  expect(fixture.home.getEndpointState('ep_mqtt_availability-relay').on_off).toBe(true);

  await fixture.publish('homeassistant/status', 'starting');
  await vi.waitFor(() =>
    expect(fixture.home.getDevice('mqtt_availability-panel')?.availability).toBe('unknown'),
  );
  await fixture.publish('homeassistant/status', 'online');
  await vi.waitFor(() =>
    expect(fixture.home.getDevice('mqtt_availability-panel')?.availability).toBe('online'),
  );
});

it('inherits device-bundle availability topics and applies the all mode', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  await fixture.publish('homeassistant/device/panel/config', {
    device: { identifiers: ['availability-bundle'], name: 'Availability bundle' },
    availability_mode: 'all',
    availability: [
      { topic: 'fixture/power', payload_available: 'up', payload_not_available: 'down' },
      { topic: 'fixture/link', payload_available: 'up', payload_not_available: 'down' },
    ],
    components: {
      relay: { platform: 'switch', unique_id: 'availability-bundle-relay' },
    },
  });
  await vi.waitFor(() =>
    expect(fixture.home.getDevice('mqtt_availability-bundle')?.availability).toBe('unknown'),
  );
  await fixture.publish('fixture/power', 'up');
  expect(fixture.home.getDevice('mqtt_availability-bundle')?.availability).toBe('unknown');
  await fixture.publish('fixture/link', 'up');
  await vi.waitFor(() =>
    expect(fixture.home.getDevice('mqtt_availability-bundle')?.availability).toBe('online'),
  );
  await fixture.publish('fixture/link', 'down');
  await vi.waitFor(() =>
    expect(fixture.home.getDevice('mqtt_availability-bundle')?.availability).toBe('offline'),
  );
});

it('replaces and removes availability topics with discovery configuration', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  const configTopic = 'homeassistant/switch/replacement/config';
  const config = (availabilityTopic?: string) => ({
    unique_id: 'availability-replacement',
    state_topic: 'fixture/replacement/state',
    ...(availabilityTopic ? { availability_topic: availabilityTopic } : {}),
    device: { identifiers: ['availability-replacement'], name: 'Replacement relay' },
  });

  await fixture.publish(configTopic, config('fixture/old-status'));
  await fixture.publish('fixture/old-status', 'offline');
  await vi.waitFor(() =>
    expect(fixture.home.getDevice('mqtt_availability-replacement')?.availability).toBe('offline'),
  );

  await fixture.publish(configTopic, config('fixture/new-status'));
  await vi.waitFor(() =>
    expect(fixture.home.getDevice('mqtt_availability-replacement')?.availability).toBe('unknown'),
  );
  await fixture.publish('fixture/old-status', 'online');
  await fixture.service.drain();
  expect(fixture.home.getDevice('mqtt_availability-replacement')?.availability).toBe('unknown');
  await fixture.publish('fixture/new-status', 'online');
  await vi.waitFor(() =>
    expect(fixture.home.getDevice('mqtt_availability-replacement')?.availability).toBe('online'),
  );

  await fixture.publish(configTopic, config());
  await vi.waitFor(() =>
    expect(fixture.home.getDevice('mqtt_availability-replacement')?.availability).toBe('online'),
  );
  await fixture.publish('fixture/new-status', 'offline');
  await fixture.service.drain();
  expect(fixture.home.getDevice('mqtt_availability-replacement')?.availability).toBe('online');
});

it('restores retained LWT availability after discovery bindings on a cold restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-mqtt-availability-'));
  const database = join(directory, 'catalog.sqlite');
  cleanups.push(async () => rm(directory, { recursive: true, force: true }));
  const first = await mqttFixture(database);
  cleanups.push(() => first.close());
  await first.publish('homeassistant/switch/relay/config', {
    unique_id: 'availability-restart-relay',
    state_topic: 'fixture/restart/state',
    availability_topic: 'fixture/restart/status',
    device: { identifiers: ['availability-restart'], name: 'Restart relay' },
  });
  await first.publish('fixture/restart/state', 'ON');
  await first.publish('fixture/restart/status', 'offline');
  await vi.waitFor(() =>
    expect(first.home.getDevice('mqtt_availability-restart')?.availability).toBe('offline'),
  );
  await first.close();

  const second = await mqttFixture(database);
  cleanups.push(() => second.close());
  expect(second.home.getDevice('mqtt_availability-restart')?.availability).toBe('offline');
  expect(second.home.getEndpointState('ep_mqtt_availability-restart-relay').on_off).toBe(true);
});
