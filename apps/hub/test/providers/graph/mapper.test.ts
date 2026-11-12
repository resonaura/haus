/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import type { BridgeEntity } from '@haus/bridge/protocol';
import { entityEndpoint } from '../../../src/providers/graph/mapper.js';
import { entityCommand } from '../../../src/providers/graph/command.js';

const light: BridgeEntity = {
  id: 'spotlight',
  name: 'Spotlight',
  domain: 'light',
  writable: true,
  available: true,
  updatedAt: 1000,
  state: { on: true, brightness: 40, hue: 120, saturation: 100, colorTemperature: 3000 },
  brightness: true,
  color: true,
  colorTemperature: { minKelvin: 2500, maxKelvin: 6500 },
};
const owner = { protocol: 'vendor' as const, externalId: 'fixture', domain: 'light' };

it('maps native light scales and real observations into the client capability contract', () => {
  const endpoint = entityEndpoint(light, 'endpoint', owner, true);
  expect(endpoint.readings.brightness?.value).toBe(102);
  expect(endpoint.readings.color?.value).toEqual({ r: 0, g: 255, b: 0 });
  expect(endpoint.readings.color_temp?.value).toBe(3000);
  expect(
    entityCommand(light, 'on_off', 'turn_on', {
      brightness: 102,
      color: { r: 0, g: 255, b: 0 },
      color_temp_kelvin: 3000,
    }),
  ).toEqual({
    action: 'set',
    value: { on: true, brightness: 40, hue: 120, saturation: 100, colorTemperature: 3000 },
  });
  expect(entityCommand(light, 'on_off', 'turn_on', { color_temp: 250 })).toEqual({
    action: 'set',
    value: { on: true, colorTemperature: 4000 },
  });
  expect(() => entityCommand(light, 'on_off', 'turn_on', { brightness: 256 })).toThrow(
    'invalid_bridge_command',
  );
  expect(() => entityCommand(light, 'on_off', 'turn_on', { color_temp_kelvin: 9000 })).toThrow(
    'invalid_bridge_command',
  );
  expect(() => entityCommand(light, 'on_off', 'turn_on', { effect: 'unsupported' })).toThrow(
    'invalid_bridge_command',
  );
});

it('keeps diagnostics private and rejects unsupported or unavailable physical commands', () => {
  const sensor: BridgeEntity = {
    id: 'stream',
    name: 'Stream',
    domain: 'sensor',
    state: 'rtsp://private:secret@192.168.1.10/live',
    available: true,
    updatedAt: 1000,
  };
  expect(entityEndpoint(sensor, 'sensor', owner, true).readings.value?.value).toBeNull();
  expect(() => entityCommand(sensor, 'value', 'set', { value: 'x' })).toThrow(
    'invalid_bridge_command',
  );
  expect(() => entityCommand({ ...light, available: false }, 'on_off', 'turn_off')).toThrow(
    'bridge_entity_unavailable',
  );
});

it('exposes and validates number/select/button profiles without MQTT command topics', () => {
  const number: BridgeEntity = {
    id: 'level',
    name: 'Level',
    domain: 'number',
    state: 20,
    min: 0,
    max: 100,
    step: 5,
    writable: true,
    available: true,
    updatedAt: 1000,
  };
  expect(entityEndpoint(number, 'number', owner, true).capabilities[0]).toMatchObject({
    id: 'number',
    minimum: 0,
    maximum: 100,
    step: 5,
  });
  expect(entityCommand(number, 'number', 'set', { value: 25 })).toEqual({
    action: 'set',
    value: 25,
  });
  expect(() => entityCommand(number, 'number', 'set', { value: 24 })).toThrow(
    'invalid_bridge_command',
  );
  const select: BridgeEntity = {
    ...number,
    domain: 'select',
    state: 'auto',
    options: ['auto', 'off'],
  };
  expect(entityCommand(select, 'select', 'set', { value: 'off' })).toEqual({
    action: 'set',
    value: 'off',
  });
  const button: BridgeEntity = { ...number, domain: 'button', state: null };
  expect(entityCommand(button, 'press', 'press')).toEqual({ action: 'press' });
});
