/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { mqttFixture } from './fixture.js';

interface DiscoveryMessage {
  readonly topic: string;
  readonly payload: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFixture(): readonly DiscoveryMessage[] {
  const decoded: unknown = JSON.parse(
    readFileSync(new URL('./fixtures/nixie.json', import.meta.url), 'utf8'),
  );
  if (!isRecord(decoded) || !Array.isArray(decoded.messages)) throw Error('invalid_nixie_fixture');
  return decoded.messages.map((message): DiscoveryMessage => {
    if (
      !isRecord(message) ||
      typeof message.topic !== 'string' ||
      typeof message.payload !== 'string'
    ) {
      throw Error('invalid_nixie_discovery_message');
    }
    return { topic: message.topic, payload: message.payload };
  });
}

function endpointId(
  device: { readonly endpoints: readonly { readonly id: string; readonly name: string }[] },
  suffix: string,
): string {
  const endpoint = device.endpoints.find((candidate) => candidate.id.endsWith(`_${suffix}`));
  if (!endpoint) throw Error(`missing_nixie_endpoint_${suffix}`);
  return endpoint.id;
}

it('imports unchanged Nixie Clock discovery and routes its states and commands on loopback MQTT', async () => {
  const fixture = await mqttFixture();
  try {
    const discovery = readFixture();
    expect(discovery).toHaveLength(14);

    const received: { topic: string; payload: string }[] = [];
    await fixture.client.subscribe('nixie_clock/+/set', (message) => {
      received.push({ topic: message.topic, payload: message.payload });
    });

    for (const message of discovery) await fixture.publish(message.topic, message.payload);

    const device = await vi.waitFor(() => {
      const found = fixture.home.getDevice('mqtt_fixture-nixie-clock');
      expect(found?.endpoints).toHaveLength(14);
      return found;
    });
    if (!device) throw Error('missing_nixie_device');

    await fixture.publish('nixie_clock/availability', 'online');
    for (const suffix of [
      'all_tubes',
      'tube_1',
      'tube_2',
      'tube_3',
      'tube_4',
      'tube_5',
      'tube_6',
      'timezone',
      'time_format',
      'sync_time',
      'alarm_hour',
      'alarm_minute',
      'timer',
      'firmware',
    ]) {
      await vi.waitFor(() =>
        expect(fixture.home.getDevice(device.id)?.endpoints.find((item) =>
          item.id.endsWith(`_${suffix}`),
        )?.availability).toBe('online'),
      );
    }

    const timezone = 'UTC-08:00 — Pacific Time (Seattle, Vancouver)';
    await fixture.publish(
      'homeassistant/light/fixture-nixie-clock/all_tubes/state',
      JSON.stringify({
        state: 'ON',
        color_mode: 'hs',
        color: { h: 212, s: 74 },
        brightness: 128,
        effect: 'Rainbow',
      }),
    );
    await fixture.publish('homeassistant/select/fixture-nixie-clock/timezone/state', timezone);
    await fixture.publish('homeassistant/switch/fixture-nixie-clock/time_format/state', 'ON');
    await fixture.publish('homeassistant/number/fixture-nixie-clock/alarm_hour/state', '6');
    await fixture.publish('homeassistant/number/fixture-nixie-clock/alarm_minute/state', '45');
    await fixture.publish('homeassistant/number/fixture-nixie-clock/timer/state', '12');
    await fixture.publish('homeassistant/sensor/fixture-nixie-clock/firmware/state', '3.101');

    const allTubes = endpointId(device, 'all_tubes');
    const timezoneId = endpointId(device, 'timezone');
    const timeFormat = endpointId(device, 'time_format');
    const syncTime = endpointId(device, 'sync_time');
    const alarmHour = endpointId(device, 'alarm_hour');
    const alarmMinute = endpointId(device, 'alarm_minute');
    const timer = endpointId(device, 'timer');
    const firmware = endpointId(device, 'firmware');

    await vi.waitFor(() => {
      expect(fixture.home.getEndpointState(allTubes)).toMatchObject({
        state: 'on',
        on_off: true,
        brightness: 128,
        hs_color: [212, 74],
        effect: 'Rainbow',
      });
      expect(fixture.home.getEndpointState(timezoneId).value).toBe(timezone);
      expect(fixture.home.getEndpointState(timeFormat).on_off).toBe(true);
      expect(fixture.home.getEndpointState(alarmHour).value).toBe(6);
      expect(fixture.home.getEndpointState(alarmMinute).value).toBe(45);
      expect(fixture.home.getEndpointState(timer).value).toBe(12);
      expect(fixture.home.getEndpointState(firmware).value).toBe('3.101');
    });

    await fixture.home.executeDeviceCommand(allTubes, 'brightness', 'set', { value: 128 });
    await fixture.home.executeDeviceCommand(allTubes, 'effect', 'set', { value: 'Breathing' });
    await fixture.home.executeDeviceCommand(allTubes, 'on_off', 'turn_off');
    await fixture.home.executeDeviceCommand(timezoneId, 'select', 'set', { value: timezone });
    await fixture.home.executeDeviceCommand(timeFormat, 'on_off', 'turn_off');
    await fixture.home.executeDeviceCommand(alarmHour, 'number', 'set', { value: 7 });
    await fixture.home.executeDeviceCommand(alarmMinute, 'number', 'set', { value: 32 });
    await fixture.home.executeDeviceCommand(timer, 'number', 'set', { value: 20 });
    await fixture.home.executeDeviceCommand(syncTime, 'press', 'press');

    await vi.waitFor(() => expect(received).toHaveLength(9));
    expect(received).toEqual([
      { topic: 'nixie_clock/all_tubes/set', payload: '{"state":"ON","brightness":128}' },
      { topic: 'nixie_clock/all_tubes/set', payload: '{"state":"ON","effect":"Breathing"}' },
      { topic: 'nixie_clock/all_tubes/set', payload: '{"state":"OFF"}' },
      { topic: 'nixie_clock/timezone/set', payload: timezone },
      { topic: 'nixie_clock/time_format/set', payload: 'OFF' },
      { topic: 'nixie_clock/alarm_hour/set', payload: '7' },
      { topic: 'nixie_clock/alarm_minute/set', payload: '32' },
      { topic: 'nixie_clock/timer/set', payload: '20' },
      { topic: 'nixie_clock/sync_time/set', payload: 'PRESS' },
    ]);

    await expect(
      fixture.home.executeDeviceCommand(alarmHour, 'number', 'set', { value: 24 }),
    ).rejects.toThrow('mqtt_command_unsupported');
    expect(received).toHaveLength(9);
    await fixture.publish('nixie_clock/availability', 'offline');
    await vi.waitFor(() =>
      expect(fixture.home.getDevice(device.id)?.availability).toBe('offline'),
    );
  } finally {
    await fixture.close();
  }
});
