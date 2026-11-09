/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { buildView } from './entities';
import { parseDevices } from './types';

it('projects MQTT enum sensors as read-only sensors with their option list', () => {
  const enumDevices = parseDevices({
    devices: [
      {
        id: 'mqtt_kettle',
        name: 'Kettle',
        category: 'environmental_sensors',
        availability: 'online',
        connectivity: { protocol: 'mqtt' },
        endpoints: [
          {
            id: 'ep_kettle_mode',
            name: 'Kettle Mode',
            capabilities: [
              {
                id: 'enum',
                kind: 'enum',
                deviceClass: 'enum',
                choices: ['off', 'heat', 'boil'],
                operations: [],
              },
            ],
          },
        ],
      },
    ],
  });
  const enumView = buildView(enumDevices, {
    ep_kettle_mode: { enum: 'heat', state: 'heat' },
  });

  expect(enumView.states).toContainEqual(
    expect.objectContaining({
      entity_id: 'sensor.mqtt_kettle',
      state: 'heat',
      attributes: expect.objectContaining({
        device_class: 'enum',
        options: ['off', 'heat', 'boil'],
      }),
    }),
  );
  expect(enumView.states.some((entity) => entity.entity_id === 'select.mqtt_kettle')).toBe(false);

  const offline = buildView(
    enumDevices.map((device) => ({ ...device, availability: 'offline' })),
    {},
  ).states.find((entity) => entity.entity_id === 'sensor.mqtt_kettle');
  expect(offline).toMatchObject({
    state: 'unavailable',
    attributes: {
      device_class: 'enum',
      options: ['off', 'heat', 'boil'],
    },
  });
});
