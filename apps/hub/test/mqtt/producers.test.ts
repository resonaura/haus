/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { mqttFixture } from './fixture.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const decoded: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/kettle.json', import.meta.url), 'utf8'),
);
if (!isRecord(decoded) || typeof decoded.topic !== 'string' || !isRecord(decoded.payload)) {
  throw Error('invalid_kettle_fixture');
}
const kettleDiscovery = { topic: decoded.topic, payload: decoded.payload };

describe('unchanged Haus Kettle MQTT producer', () => {
  it('imports the complete bundle, reads state, and routes safe commands on a loopback broker', async () => {
    const fixture = await mqttFixture();
    const commands = new Map<string, string[]>();
    try {
      await fixture.client.subscribe('haus/kettle/fixture-kettle/set/+', (message) => {
        const values = commands.get(message.topic) ?? [];
        values.push(message.payload);
        commands.set(message.topic, values);
      });

      await fixture.publish(kettleDiscovery.topic, kettleDiscovery.payload);
      await fixture.publish('haus/kettle/fixture-kettle/bridge', 'online');
      await fixture.publish('haus/kettle/fixture-kettle/availability', 'online');
      await fixture.publish('haus/kettle/fixture-kettle/state', {
        mode: 'electric',
        current_temperature: 86,
        target_temperature: 92,
        auto_keep_warm: true,
        lifted: 1,
        fault: 0,
      });

      await vi.waitFor(() => {
        const device = fixture.home.getDevice('mqtt_haus_kettle_fixture-kettle');
        expect(device?.endpoints).toHaveLength(18);
        expect(device?.availability).toBe('online');
        expect(
          fixture.home.getEndpointState('ep_haus_kettle_fixture-kettle_kettle').current_temperature,
        ).toBe(86);
        expect(
          fixture.home.getEndpointState('ep_haus_kettle_fixture-kettle_kettle').target_temperature,
        ).toBe(92);
      });

      await vi.waitFor(() => {
        expect(
          fixture.home.getEndpointState('ep_haus_kettle_fixture-kettle_auto_keep_warm').on_off,
        ).toBe(true);
        expect(fixture.home.getEndpointState('ep_haus_kettle_fixture-kettle_lifted')).toMatchObject({
          state: 'on',
          on_off: true,
        });
        expect(
          fixture.home.getEndpointState('ep_haus_kettle_fixture-kettle_fault').on_off,
        ).toBe(false);
      });

      await fixture.home.executeDeviceCommand(
        'ep_haus_kettle_fixture-kettle_kettle',
        'water_heater',
        'set_temperature',
        { target_temperature: 79.6 },
      );
      await fixture.home.executeDeviceCommand(
        'ep_haus_kettle_fixture-kettle_kettle',
        'water_heater',
        'set',
        { mode: 'off' },
      );
      await fixture.home.executeDeviceCommand('ep_haus_kettle_fixture-kettle_boil', 'press', 'press');

      await vi.waitFor(() => {
        expect(commands.get('haus/kettle/fixture-kettle/set/target_temperature')).toContain('80');
        expect(commands.get('haus/kettle/fixture-kettle/set/mode')).toContain('off');
        expect(commands.get('haus/kettle/fixture-kettle/set/boil')).toContain('PRESS');
      });
    } finally {
      await fixture.close();
    }
  });
});
