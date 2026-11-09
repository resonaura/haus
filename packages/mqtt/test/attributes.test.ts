/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it } from 'vitest';
import {
  buildEndpointFromComponent,
  expandHaDiscoveryPayload,
  extractJsonAttributes,
} from '../src/index.js';

function binding(attributesTemplate?: string) {
  return buildEndpointFromComponent({
    deviceId: 'mqtt_attribute_sensor',
    deviceName: 'Attribute sensor',
    component: 'sensor',
    uniqueId: 'attribute_sensor',
    endpointId: 'ep_attribute_sensor',
    config: {
      state_topic: 'sensor/state',
      json_attributes_topic: 'sensor/attributes',
      ...(attributesTemplate ? { json_attributes_template: attributesTemplate } : {}),
    },
  }).binding;
}

it('expands abbreviated JSON attribute keys and their base topics', () => {
  const expanded = expandHaDiscoveryPayload({
    '~': 'bridge/sensor',
    json_attr_t: '~/attributes',
    json_attr_tpl: '{{ value_json.Timer1 | tojson }}',
  });

  expect(expanded.json_attributes_topic).toBe('bridge/sensor/attributes');
  expect(expanded.json_attributes_template).toBe('{{ value_json.Timer1 | tojson }}');
});

it('reads direct JSON dictionaries and selected nested dictionaries', () => {
  expect(extractJsonAttributes(binding(), '{"signal":-51,"connected":true}')).toEqual({
    kind: 'valid',
    value: { signal: -51, connected: true },
  });
  expect(
    extractJsonAttributes(binding('{{ value_json.Timer1 | tojson }}'), '{"Timer1":{"Arm":true}}'),
  ).toEqual({ kind: 'valid', value: { Arm: true } });
});

it('supports HA dictionary projection templates while rejecting unsupported output', () => {
  expect(
    extractJsonAttributes(
      binding("{{ {'Arm': value_json.Timer1} | tojson }}"),
      '{"Timer1":{"Arm":true,"Time":"12:00"}}',
    ),
  ).toEqual({ kind: 'valid', value: { Arm: { Arm: true, Time: '12:00' } } });
  expect(
    extractJsonAttributes(binding('{{ value_json.Signal | lower }}'), '{"Signal":"-51"}'),
  ).toEqual({
    kind: 'unsupported',
  });
  expect(
    extractJsonAttributes(binding('{{ value_json.Signal | lower }}'), '{invalid json'),
  ).toEqual({ kind: 'invalid' });
  expect(extractJsonAttributes(binding(), '[]')).toEqual({ kind: 'invalid' });
});
