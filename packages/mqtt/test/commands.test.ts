/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { buildCommandMessages, buildEndpointFromComponent } from '../src/index.js';

it('maps typed boolean scene writes to the switch provider payloads', () => {
  const { binding } = buildEndpointFromComponent({
    deviceId: 'panel',
    deviceName: 'Panel',
    component: 'switch',
    uniqueId: 'relay',
    endpointId: 'relay',
    config: {
      command_topic: 'fixture/set',
      payload_on: 'ENABLE',
      payload_off: 'DISABLE',
    },
  });
  expect(buildCommandMessages(binding, 'on_off', 'set', { value: true })).toEqual([
    { topic: 'fixture/set', payload: 'ENABLE' },
  ]);
  expect(buildCommandMessages(binding, 'power', 'set', { value: false })).toEqual([
    { topic: 'fixture/set', payload: 'DISABLE' },
  ]);
});

it('honors a false boolean scene write on a JSON-schema light', () => {
  const { binding } = buildEndpointFromComponent({
    deviceId: 'panel',
    deviceName: 'Panel',
    component: 'light',
    uniqueId: 'lamp',
    endpointId: 'lamp',
    config: { command_topic: 'fixture/set', schema: 'json' },
  });
  expect(buildCommandMessages(binding, 'on_off', 'set', { value: false })).toEqual([
    { topic: 'fixture/set', payload: JSON.stringify({ state: 'OFF' }) },
  ]);
});
