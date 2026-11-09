/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import {
  buildEndpointFromComponent,
  componentDiscovery,
  expandHaDiscoveryPayload,
  extractEndpointStatePatch,
  extractFanStatePatch,
} from '../src/index.js';

it('imports HA fan abbreviations, separate power/speed topics, templates and speed ranges', () => {
  const expanded = expandHaDiscoveryPayload({
    '~': 'room/fan',
    p: 'fan',
    uniq_id: 'room_fan',
    stat_t: '~/power',
    stat_val_tpl: '{{ value_json.enabled }}',
    pct_stat_t: '~/speed',
    pct_val_tpl: '{{ value_json.rpm }}',
    spd_rng_min: 10,
    spd_rng_max: 14,
    pl_rst_pct: 'unknown',
  });

  expect(componentDiscovery(expanded)).toBe(true);
  if (!componentDiscovery(expanded)) throw Error('fan_discovery_invalid');
  expect(expanded).toMatchObject({
    state_topic: 'room/fan/power',
    percentage_state_topic: 'room/fan/speed',
    state_value_template: '{{ value_json.enabled }}',
    percentage_value_template: '{{ value_json.rpm }}',
    speed_range_min: 10,
    speed_range_max: 14,
    payload_reset_percentage: 'unknown',
  });

  const { endpoint, binding } = buildEndpointFromComponent({
    deviceId: 'room_fan',
    deviceName: 'Room Fan',
    component: 'fan',
    uniqueId: 'room_fan',
    endpointId: 'main',
    config: expanded,
  });

  expect(binding.stateTopic).toBe('room/fan/power');
  expect(binding.percentageStateTopic).toBe('room/fan/speed');
  expect(endpoint.capabilities.map(({ id }) => id)).toEqual(['fan', 'fan_speed']);
  expect(extractEndpointStatePatch(binding, '{"enabled":true}', binding.stateTopic)).toMatchObject({
    state: 'on',
    on_off: true,
    fan: true,
  });
  expect(
    extractEndpointStatePatch(binding, '{"rpm":12}', binding.percentageStateTopic),
  ).toMatchObject({ percentage: 60, fan_speed: 60 });
  expect(
    extractEndpointStatePatch(binding, '{"rpm":10}', binding.percentageStateTopic),
  ).toMatchObject({ percentage: 20, fan_speed: 20 });
  expect(
    extractEndpointStatePatch(binding, '{"rpm":0}', binding.percentageStateTopic),
  ).toMatchObject({ percentage: 0, fan_speed: 0 });
  expect(
    extractEndpointStatePatch(binding, '{"rpm":9}', binding.percentageStateTopic),
  ).toMatchObject({ percentage: 0, fan_speed: 0 });
  expect(
    extractEndpointStatePatch(binding, '{"rpm":15}', binding.percentageStateTopic),
  ).toMatchObject({ percentage: 100, fan_speed: 100 });
  expect(extractEndpointStatePatch(binding, 'unknown', binding.percentageStateTopic)).toEqual({
    percentage: null,
    fan_speed: null,
  });
  expect(extractEndpointStatePatch(binding, '{"rpm":"bad"}', binding.percentageStateTopic)).toEqual(
    {},
  );
});

it('merges fan power and percentage when both state fields share one topic', () => {
  const { binding } = buildEndpointFromComponent({
    deviceId: 'shared_fan',
    deviceName: 'Shared Fan',
    component: 'fan',
    uniqueId: 'shared_fan',
    endpointId: 'main',
    config: {
      state_topic: 'room/fan/state',
      state_value_template: '{{ value_json.enabled }}',
      payload_on: 'RUN',
      payload_off: 'STOP',
      percentage_state_topic: 'room/fan/state',
      percentage_value_template: '{{ value_json.speed }}',
      speed_range_min: 1,
      speed_range_max: 4,
    },
  });

  expect(
    extractEndpointStatePatch(binding, '{"enabled":"RUN","speed":3}', 'room/fan/state'),
  ).toEqual({
    state: 'on',
    on_off: true,
    power: true,
    fan: true,
    percentage: 75,
    fan_speed: 75,
  });
  expect(
    extractEndpointStatePatch(binding, '{"enabled":"STOP","speed":0}', 'room/fan/state'),
  ).toMatchObject({ state: 'off', on_off: false, power: false, fan: false });
});

it('rejects invalid HA fan speed ranges', () => {
  expect(componentDiscovery({ speed_range_min: 4, speed_range_max: 3 })).toBe(false);
  expect(componentDiscovery({ platform: 'fan', speed_range_min: 1.5, speed_range_max: 4 })).toBe(
    false,
  );
});

it('does not apply unsupported fan value-template filters', () => {
  const { binding } = buildEndpointFromComponent({
    deviceId: 'unsupported_fan',
    deviceName: 'Unsupported Fan',
    component: 'fan',
    uniqueId: 'unsupported_fan',
    endpointId: 'main',
    config: {
      percentage_state_topic: 'room/fan/speed',
      percentage_value_template: '{{ value_json.rpm | lower }}',
    },
  });

  expect(extractFanStatePatch(binding, '{"rpm":50}', 'room/fan/speed')).toEqual({
    patch: {},
    unsupportedTemplate: true,
  });
  expect(extractEndpointStatePatch(binding, '{"rpm":50}', 'room/fan/speed')).toEqual({});
});

it('resets fan power state to unknown on the HA None payload', () => {
  const { binding } = buildEndpointFromComponent({
    deviceId: 'reset_fan',
    deviceName: 'Reset Fan',
    component: 'fan',
    uniqueId: 'reset_fan',
    endpointId: 'main',
    config: { state_topic: 'room/fan/state' },
  });

  expect(extractFanStatePatch(binding, 'None', 'room/fan/state').patch).toEqual({
    state: null,
    on_off: null,
    power: null,
    fan: null,
  });
  expect(extractFanStatePatch(binding, '', 'room/fan/state').patch).toEqual({});
});
