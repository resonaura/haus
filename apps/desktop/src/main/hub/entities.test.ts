/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { translateService } from './commands';
import { buildView } from './entities';
import { parseDevices, parseStates } from './types';

const devices = parseDevices({
  devices: [
    {
      id: 'mqtt_lamp',
      name: 'Lamp',
      category: 'lighting',
      roomId: 'bedroom',
      availability: 'online',
      endpoints: [
        {
          id: 'ep_lamp',
          name: 'Lamp',
          capabilities: [
            { id: 'on_off', kind: 'binary', operations: ['set', 'turn_on', 'turn_off'] },
            { id: 'brightness', kind: 'numeric', operations: ['set'] },
            { id: 'color', kind: 'complex', operations: ['set'] },
          ],
        },
      ],
    },
    {
      id: 'leak_1',
      name: 'Leak',
      category: 'security',
      roomId: 'unassigned',
      availability: 'online',
      endpoints: [
        {
          id: 'ep_leak',
          name: 'Leak',
          capabilities: [{ id: 'leak', kind: 'binary', operations: [] }],
        },
      ],
    },
    { id: 7, name: 'dropped' },
  ],
});
const states = parseStates({
  states: {
    ep_lamp: { state: 'on', on_off: true, brightness: 128, color: { r: 1, g: 2, b: 3 } },
    ep_leak: { state: 'on', leak: true },
  },
});

describe('Hub compatibility view', () => {
  const view = buildView(devices, states, 'now');

  it('drops malformed devices and maps domains, rooms and attributes', () => {
    expect(devices).toHaveLength(2);
    const light = view.states.find((s) => s.entity_id === 'light.mqtt_lamp');
    expect(light).toMatchObject({
      state: 'on',
      attributes: { brightness: 128, rgb_color: [1, 2, 3], supported_color_modes: ['rgb'] },
    });
    expect(view.states.map((s) => s.entity_id)).not.toContain('sensor.mqtt_lamp');
    expect(view.states.find((s) => s.entity_id === 'binary_sensor.leak_1')).toMatchObject({
      state: 'on',
      attributes: { device_class: 'moisture' },
    });
    expect(view.areas).toEqual([{ area_id: 'bedroom', name: 'Bedroom' }]);
    expect(view.devices.find((d) => d.id === 'leak_1')).toMatchObject({ area_id: null });
  });

  it('reports offline devices as unavailable', () => {
    const offline = buildView(
      devices.map((d) => ({ ...d, availability: 'offline' })),
      states,
    );
    expect(offline.states.every((s) => s.state === 'unavailable')).toBe(true);
  });
});

describe('call_service translation', () => {
  const { bindings } = buildView(devices, states);
  const call = (service: string, data?: Record<string, unknown>, id = 'light.mqtt_lamp') =>
    translateService(
      bindings,
      { service, target: { entity_id: id }, service_data: data },
      () => true,
    );

  it('turns brightness_pct and rgb_color into Hub light parameters', () => {
    expect(call('turn_on', { brightness_pct: 50, rgb_color: [255, 0, 10] })).toEqual([
      {
        deviceId: 'mqtt_lamp',
        endpointId: 'ep_lamp',
        capability: 'on_off',
        command: 'turn_on',
        parameters: { brightness: 128, color: { r: 255, g: 0, b: 10 } },
      },
    ]);
  });

  it('toggles from the current state and rejects unsupported targets', () => {
    expect(call('toggle')[0]?.command).toBe('turn_off');
    expect(() => call('turn_on', {}, 'light.missing')).toThrow('no longer available');
    expect(() => call('turn_on', {}, 'binary_sensor.leak_1')).toThrow('cannot be controlled');
    expect(() => call('explode')).toThrow('does not support');
    expect(() => translateService(bindings, { service: 'turn_on' }, () => false)).toThrow(
      'Choose an accessory',
    );
  });
});
