/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { parseDiscoveryPayload } from '../src/discovery/payload.js';

it('expands and validates shared HA origin metadata', () => {
  const parsed = parseDiscoveryPayload(
    'device',
    JSON.stringify({
      o: { name: 'Zigbee2MQTT', sw: '2.1.0', url: 'https://example.test/help' },
      dev: { ids: ['bridge'], mdl_id: 'z2m', cu: 'https://example.test/device' },
      cmps: { relay: { p: 'switch', unique_id: 'relay' } },
    }),
  );
  expect(parsed.kind).toBe('device');
  if (parsed.kind === 'device')
    expect(parsed.payload.origin).toEqual({
      name: 'Zigbee2MQTT',
      sw_version: '2.1.0',
      support_url: 'https://example.test/help',
    });
  if (parsed.kind === 'device') {
    expect(parsed.payload.device?.model_id).toBe('z2m');
    expect(parsed.payload.device?.configuration_url).toBe('https://example.test/device');
  }
});

it('rejects malformed origin metadata instead of dropping it silently', () => {
  expect(() =>
    parseDiscoveryPayload(
      'device',
      JSON.stringify({
        o: { name: 12 },
        dev: { ids: ['bridge'] },
        cmps: { relay: { p: 'switch' } },
      }),
    ),
  ).toThrow('mqtt_discovery_invalid');
});
