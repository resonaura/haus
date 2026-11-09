/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import {
  buildEndpointFromComponent,
  componentDiscovery,
  expandHaDiscoveryPayload,
  extractEndpointStatePatch,
} from '../src/index.js';

it('preserves HA sensor display precision without rounding the reading', () => {
  const expanded = expandHaDiscoveryPayload({
    p: 'sensor',
    uniq_id: 'room_temperature',
    stat_t: 'room/temperature',
    dev_cla: 'temperature',
    unit_of_meas: '°C',
    sug_dsp_prc: 2,
  });

  expect(componentDiscovery(expanded)).toBe(true);
  if (!componentDiscovery(expanded)) throw Error('sensor_discovery_invalid');

  const { endpoint, binding } = buildEndpointFromComponent({
    deviceId: 'room_sensor',
    deviceName: 'Room Sensor',
    component: 'sensor',
    uniqueId: 'room_temperature',
    endpointId: 'temperature',
    config: expanded,
  });

  expect(endpoint.capabilities[0]).toMatchObject({
    id: 'temperature',
    kind: 'numeric',
    unit: '°C',
    displayPrecision: 2,
  });
  expect(extractEndpointStatePatch(binding, '21.376')).toMatchObject({
    state: 21.376,
    value: 21.376,
    temperature: 21.376,
  });
});

it('preserves numeric-looking strings for sensors declared as text', () => {
  const { endpoint, binding } = buildEndpointFromComponent({
    deviceId: 'nixie-clock',
    deviceName: 'Nixie Clock',
    component: 'sensor',
    uniqueId: 'nixie_clock_firmware',
    endpointId: 'firmware',
    config: { name: 'Firmware Version', state_topic: 'nixie/firmware' },
  });

  expect(endpoint.capabilities[0]).toMatchObject({ id: 'sensor', kind: 'string' });
  expect(extractEndpointStatePatch(binding, '3.101')).toEqual({
    state: '3.101',
    value: '3.101',
    sensor: '3.101',
  });
});

it('rejects negative and fractional sensor display precision', () => {
  expect(componentDiscovery({ suggested_display_precision: -1 })).toBe(false);
  expect(componentDiscovery({ suggested_display_precision: 1.5 })).toBe(false);
  expect(componentDiscovery({ suggested_display_precision: Number.MAX_SAFE_INTEGER + 1 })).toBe(
    false,
  );
});
