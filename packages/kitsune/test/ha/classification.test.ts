/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { HacsVirtualizer } from '../../src/hacs/virtualizer.js';
import type { HacsEntityPayload } from '../../src/hacs/types.js';

it('keeps the motion sensor category with telemetry and configuration controls on the same device', () => {
  const entities: HacsEntityPayload[] = [
    {
      entityId: 'binary_sensor.motion',
      domain: 'binary_sensor',
      state: 'on',
      attributes: { device_class: 'motion' },
      name: 'Motion',
    },
    {
      entityId: 'sensor.temperature',
      domain: 'sensor',
      state: '67.5',
      attributes: { device_class: 'temperature', unit_of_measurement: '°F' },
      name: 'Temperature',
    },
    {
      entityId: 'sensor.battery',
      domain: 'sensor',
      state: '96',
      attributes: { device_class: 'battery', unit_of_measurement: '%' },
      name: 'Battery',
      entityCategory: 'diagnostic',
    },
    {
      entityId: 'sensor.light',
      domain: 'sensor',
      state: '24',
      attributes: { device_class: 'illuminance', unit_of_measurement: 'lx' },
      name: 'Illuminance',
    },
    {
      entityId: 'switch.enabled',
      domain: 'switch',
      state: 'on',
      attributes: {},
      name: 'Enabled',
      entityCategory: 'config',
    },
  ];
  for (const order of [entities, [...entities].reverse()]) {
    const projection = new HacsVirtualizer();
    for (const entity of order) projection.handleEntityAdded({ ...entity, deviceId: 'hue-motion' });
    const [device] = projection.getDevices();
    expect(device.category).toBe('occupancy_sensors');
    expect(device.endpoints).toHaveLength(5);
    const endpoint = (id: string) => device.endpoints.find((item) => item.id === id);
    expect(endpoint('binary_sensor.motion')?.readings.motion.value).toBe(true);
    expect(endpoint('sensor.temperature')?.capabilities[0]?.unit).toBe('°F');
    expect(endpoint('sensor.temperature')?.readings.temperature.value).toBe(67.5);
    expect(endpoint('sensor.light')?.capabilities[0]?.deviceClass).toBe('illuminance');
    expect(endpoint('sensor.battery')?.capabilities[0]).toMatchObject({
      deviceClass: 'battery',
      entityCategory: 'diagnostic',
    });
    expect(endpoint('sensor.battery')?.readings.humidity).toBeUndefined();
    expect(endpoint('switch.enabled')?.capabilities[0]?.entityCategory).toBe('config');
  }
});

it('keeps software service controls without presenting them as physical outlets', () => {
  for (const service of [true, false]) {
    const projection = new HacsVirtualizer();
    for (const entity of [
      {
        entityId: 'sensor.speed',
        domain: 'sensor',
        state: '3',
        attributes: { device_class: 'data_rate', unit_of_measurement: 'MB/s' },
      },
      { entityId: 'switch.speed_limit', domain: 'switch', state: 'on', attributes: {} },
    ])
      projection.handleEntityAdded({
        ...entity,
        name: entity.entityId,
        deviceId: 'fixture',
        ...(service ? { deviceEntryType: 'service' } : {}),
      });
    const [device] = projection.getDevices();
    expect(device.category).toBe(service ? 'network' : 'power');
    expect(
      device.endpoints.find(({ id }) => id === 'switch.speed_limit')?.capabilities,
    ).toContainEqual(
      expect.objectContaining({
        id: 'on_off',
        operations: expect.arrayContaining(['turn_on', 'turn_off']),
      }),
    );
  }
});
