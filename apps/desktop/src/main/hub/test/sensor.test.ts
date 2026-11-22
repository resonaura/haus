/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { translateService } from '../commands';
import { buildView } from '../entities';
import { parseDevices, parseStates } from '../types';

describe('Desktop Xiaomi MIoT & BLE Sensors (P18.6.2.7)', () => {
  const devices = parseDevices({
    devices: [
      {
        id: 'narnia_pedalboard',
        name: 'Narnia Pedalboard',
        category: 'power',
        roomId: 'narnia',
        availability: 'online',
        endpoints: [
          {
            id: 'switch.narnia_pedalboard_power',
            name: 'Pedalboard Power',
            capabilities: [
              {
                id: 'on_off',
                kind: 'binary',
                operations: ['turn_on', 'turn_off', 'set'],
              },
            ],
          },
          {
            id: 'light.narnia_pedalboard_indicator_light',
            name: 'Indicator LED',
            capabilities: [
              {
                id: 'on_off',
                kind: 'binary',
                operations: ['turn_on', 'turn_off', 'set'],
              },
            ],
          },
          {
            id: 'sensor.narnia_pedalboard_temperature',
            name: 'Temperature',
            capabilities: [
              {
                id: 'temperature',
                kind: 'numeric',
                operations: [],
                deviceClass: 'temperature',
                unit: '°C',
              },
            ],
          },
        ],
      },
      {
        id: 'bathroom_scale',
        name: 'Bathroom Scale',
        category: 'generic',
        roomId: 'bathroom',
        availability: 'online',
        endpoints: [
          {
            id: 'sensor.bathroom_scale_weight',
            name: 'Weight',
            capabilities: [
              {
                id: 'sensor',
                kind: 'numeric',
                operations: [],
                deviceClass: 'weight',
                unit: 'kg',
              },
            ],
          },
        ],
      },
      {
        id: 'living_room_dimmer_switch',
        name: 'Dimmer Switch',
        category: 'generic',
        roomId: 'living_room',
        availability: 'online',
        endpoints: [
          {
            id: 'event.living_room_dimmer_switch_dimmer',
            name: 'Dimmer Action',
            capabilities: [
              {
                id: 'event',
                kind: 'event',
                operations: [],
                choices: ['press', 'double_press', 'hold', 'rotate_left', 'rotate_right'],
              },
            ],
          },
        ],
      },
    ],
  });

  const states = parseStates({
    states: {
      'switch.narnia_pedalboard_power': {
        on_off: true,
        state: 'on',
      },
      'light.narnia_pedalboard_indicator_light': {
        on_off: true,
        state: 'on',
      },
      'sensor.narnia_pedalboard_temperature': {
        temperature: 34.5,
        state: 34.5,
        unit: '°C',
      },
      'sensor.bathroom_scale_weight': {
        weight: 74.2,
        state: 74.2,
        unit: 'kg',
      },
      'event.living_room_dimmer_switch_dimmer': {
        event: 'rotate_right',
        event_type: 'rotate_right',
        state: 'rotate_right',
      },
    },
  });

  it('projects Xiaomi plug, weight scale, and rotary dimmer event into CompatView', () => {
    const view = buildView(devices, states);

    // 1. Plug power switch
    const switchEntity = view.states.find((s) => s.entity_id === 'switch.narnia_pedalboard');
    expect(switchEntity).toBeDefined();
    expect(switchEntity?.state).toBe('on');

    // 2. Plug temperature sensor
    const tempEntity = view.states.find((s) => s.entity_id === 'sensor.narnia_pedalboard');
    expect(tempEntity).toBeDefined();
    expect(tempEntity?.attributes.device_class).toBe('temperature');
    expect(tempEntity?.attributes.unit_of_measurement).toBe('°C');

    // 3. Scale weight sensor
    const weightEntity = view.states.find((s) => s.entity_id === 'sensor.bathroom_scale');
    expect(weightEntity).toBeDefined();
    expect(weightEntity?.state).toBe('74.2');
    expect(weightEntity?.attributes.device_class).toBe('weight');
    expect(weightEntity?.attributes.unit_of_measurement).toBe('kg');

    // 4. Dimmer event entity
    const eventEntity = view.states.find((s) => s.entity_id === 'event.living_room_dimmer_switch');
    expect(eventEntity).toBeDefined();
    expect(eventEntity?.state).toBe('rotate_right');
    expect(eventEntity?.attributes.event_types).toEqual([
      'press',
      'double_press',
      'hold',
      'rotate_left',
      'rotate_right',
    ]);
  });

  it('translates plug switch and indicator light toggle service calls', () => {
    const view = buildView(devices, states);
    const isOn = (id: string) => view.states.find((s) => s.entity_id === id)?.state === 'on';

    const commands = translateService(
      view.bindings,
      {
        service: 'turn_off',
        target: { entity_id: 'switch.narnia_pedalboard' },
      },
      isOn,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      deviceId: 'narnia_pedalboard',
      endpointId: 'switch.narnia_pedalboard_power',
      capability: 'on_off',
      command: 'turn_off',
    });
  });

  it('uses real numeric readings and reports unknown instead of fabricating minimum when absent', () => {
    const numberDevices = parseDevices({
      devices: [
        {
          id: 'dev_num',
          name: 'Cam',
          connectivity: { protocol: 'mqtt' },
          endpoints: [
            {
              id: 'ep_vol',
              name: 'Alarm Volume',
              capabilities: [
                {
                  id: 'number',
                  kind: 'numeric',
                  operations: ['set'],
                  minimum: 0,
                  maximum: 100,
                  step: 1,
                  unit: '%',
                },
              ],
            },
          ],
        },
      ],
    });
    expect(buildView(numberDevices, { ep_vol: { number: 50 } }).states[0]).toMatchObject({
      state: '50',
      attributes: { min: 0, max: 100, step: 1, unit_of_measurement: '%' },
    });
    expect(buildView(numberDevices, {}).states[0]?.state).toBe('unknown');
  });

  it('reports unknown for MQTT camera switches with null or missing state instead of fabricating off', () => {
    const cameraDevices = parseDevices({
      devices: [
        {
          id: 'mqtt_lumi1_cam',
          name: 'Guinea Pigs Camera',
          category: 'cameras',
          connectivity: { protocol: 'mqtt' },
          endpoints: [
            {
              id: 'ep_humans_track',
              name: 'Human Tracking',
              capabilities: [
                { id: 'on_off', kind: 'binary', operations: ['turn_on', 'turn_off', 'set'] },
              ],
            },
            {
              id: 'ep_missing_track',
              name: 'Missing Switch',
              capabilities: [
                { id: 'on_off', kind: 'binary', operations: ['turn_on', 'turn_off', 'set'] },
              ],
            },
            {
              id: 'ep_ai_sound',
              name: 'AI Sound Detection',
              capabilities: [
                { id: 'on_off', kind: 'binary', operations: ['turn_on', 'turn_off', 'set'] },
              ],
            },
          ],
        },
      ],
    });
    const view = buildView(cameraDevices, {
      ep_humans_track: { on_off: null, state: null },
      ep_ai_sound: { on_off: true, state: 'on' },
    });
    const byName = new Map(
      view.states.map((entity) => [String(entity.attributes.friendly_name), entity.state]),
    );
    expect(byName.get('Guinea Pigs Camera Human Tracking')).toBe('unknown');
    expect(byName.get('Guinea Pigs Camera Missing Switch')).toBe('unknown');
    expect(byName.get('Guinea Pigs Camera AI Sound Detection')).toBe('on');
  });
});
