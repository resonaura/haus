/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import {
  bundleDiscovery,
  buildEndpointFromComponent,
  componentDiscovery,
  expandHaDiscoveryPayload,
  extractEndpointStatePatch,
} from '../src/index.js';

it('imports an abbreviated MQTT enum sensor as a read-only enum with string states', () => {
  const config = expandHaDiscoveryPayload({
    p: 'sensor',
    uniq_id: 'kettle_mode',
    stat_t: 'kettle/mode',
    dev_cla: 'enum',
    ops: ['off', 'heat', 'boil'],
  });

  expect(componentDiscovery(config)).toBe(true);
  if (!componentDiscovery(config)) throw Error('enum_sensor_discovery_invalid');

  const { endpoint, binding } = buildEndpointFromComponent({
    deviceId: 'kettle',
    deviceName: 'Kettle',
    component: 'sensor',
    uniqueId: 'kettle_mode',
    endpointId: 'mode',
    config,
  });

  expect(endpoint.capabilities[0]).toMatchObject({
    id: 'enum',
    kind: 'enum',
    deviceClass: 'enum',
    choices: ['off', 'heat', 'boil'],
    readable: true,
    operations: [],
  });
  expect(binding.primaryCapabilityId).toBe('enum');
  expect(extractEndpointStatePatch(binding, 'heat')).toEqual({
    state: 'heat',
    value: 'heat',
    enum: 'heat',
  });
  expect(extractEndpointStatePatch(binding, '{"enum": "boil"}')).toEqual({
    state: 'boil',
    value: 'boil',
    enum: 'boil',
  });
  expect(extractEndpointStatePatch(binding, 'unknown')).toEqual({});
});

it('rejects enum sensors without options or with incompatible metadata', () => {
  expect(componentDiscovery({ platform: 'sensor', device_class: 'enum' })).toBe(false);
  expect(componentDiscovery({ platform: 'sensor', device_class: 'enum', options: [] })).toBe(false);
  expect(
    componentDiscovery({
      platform: 'sensor',
      device_class: 'enum',
      options: ['off', 'on'],
      unit_of_measurement: '%',
    }),
  ).toBe(false);
  expect(
    componentDiscovery({
      platform: 'sensor',
      device_class: 'enum',
      options: ['off', 'on'],
      state_class: 'measurement',
    }),
  ).toBe(false);
  expect(componentDiscovery({ platform: 'sensor', options: ['off', 'on'] })).toBe(false);
  expect(
    componentDiscovery(
      expandHaDiscoveryPayload({
        p: 'sensor',
        dev_cla: 'enum',
        ops: ['off', 'on'],
        stat_cla: 'measurement',
      }),
    ),
  ).toBe(false);
});

it('preserves abbreviated enum options in bundled discovery', () => {
  const bundle = expandHaDiscoveryPayload({
    dev: { ids: ['kettle'], name: 'Kettle' },
    cmps: {
      mode: {
        p: 'sensor',
        uniq_id: 'kettle_mode',
        stat_t: 'kettle/mode',
        dev_cla: 'enum',
        ops: ['off', 'heat', 'boil'],
      },
    },
  });

  expect(bundleDiscovery(bundle)).toBe(true);
  expect(bundle.components).toMatchObject({
    mode: { platform: 'sensor', device_class: 'enum', options: ['off', 'heat', 'boil'] },
  });
});
