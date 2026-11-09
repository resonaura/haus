/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import {
  buildCommandMessages,
  buildEndpointFromComponent,
  expandHaDiscoveryPayload,
} from '../src/index.js';

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

it('maps scene value writes to scaled JSON light attributes', () => {
  const { binding } = buildEndpointFromComponent({
    deviceId: 'panel',
    deviceName: 'Panel',
    component: 'light',
    uniqueId: 'lamp',
    endpointId: 'lamp',
    config: {
      command_topic: 'fixture/light/set',
      schema: 'json',
      brightness_scale: 100,
      color_temp_kelvin: true,
      supported_color_modes: ['hs', 'color_temp'],
      effect_list: ['Pulse'],
    },
  });

  const command = (capability: string, value: unknown) =>
    JSON.parse(buildCommandMessages(binding, capability, 'set', { value })[0]?.payload ?? '{}');

  expect(command('brightness', 128)).toEqual({ state: 'ON', brightness: 50 });
  expect(command('color_temp', 3200)).toEqual({ state: 'ON', color_temp: 3200 });
  expect(command('effect', 'Pulse')).toEqual({ state: 'ON', effect: 'Pulse' });
  expect(command('color_hsv', { h: 120, s: 100, v: 40 })).toEqual({
    state: 'ON',
    brightness: 40,
    color: { h: 120, s: 100 },
  });
  expect(binding.colorTempKelvin).toBe(true);
});

it('maps scene RGB values to HS when the provider supports only HS', () => {
  const { binding } = buildEndpointFromComponent({
    deviceId: 'panel',
    deviceName: 'Panel',
    component: 'light',
    uniqueId: 'lamp',
    endpointId: 'lamp',
    config: {
      command_topic: 'fixture/light/set',
      schema: 'json',
      supported_color_modes: ['hs'],
    },
  });

  const messages = buildCommandMessages(binding, 'color', 'set', {
    value: { r: 0, g: 0, b: 255 },
  });
  expect(JSON.parse(messages[0]?.payload ?? '{}')).toEqual({
    state: 'ON',
    color: { h: 240, s: 100 },
  });
});

it('converts neutral Kelvin scene values to mireds unless Kelvin mode is configured', () => {
  const { binding } = buildEndpointFromComponent({
    deviceId: 'panel',
    deviceName: 'Panel',
    component: 'light',
    uniqueId: 'lamp',
    endpointId: 'lamp',
    config: { command_topic: 'fixture/light/set', schema: 'json' },
  });
  const messages = buildCommandMessages(binding, 'color_temp', 'set', { value: 4000 });
  expect(JSON.parse(messages[0]?.payload ?? '{}')).toEqual({ state: 'ON', color_temp: 250 });
  expect(buildCommandMessages(binding, 'color_temp', 'set', { value: 0 })[0]?.payload).toBe(
    JSON.stringify({ state: 'ON' }),
  );
});

it('expands the official abbreviated Kelvin option into the command binding', () => {
  const expanded = expandHaDiscoveryPayload({
    p: 'light',
    uniq_id: 'lamp',
    cmd_t: 'fixture/light/set',
    schema: 'json',
    clr_temp_k: true,
  });
  expect(expanded.color_temp_kelvin).toBe(true);
  const { binding } = buildEndpointFromComponent({
    deviceId: 'panel',
    deviceName: 'Panel',
    component: 'light',
    uniqueId: 'lamp',
    endpointId: 'lamp',
    config: expanded,
  });
  expect(binding.colorTempKelvin).toBe(true);
});

it('keeps HSV brightness separate from full-intensity RGB color', () => {
  const { binding } = buildEndpointFromComponent({
    deviceId: 'panel',
    deviceName: 'Panel',
    component: 'light',
    uniqueId: 'lamp',
    endpointId: 'lamp',
    config: {
      command_topic: 'fixture/light/set',
      schema: 'json',
      brightness_scale: 100,
      supported_color_modes: ['rgb'],
    },
  });
  const messages = buildCommandMessages(binding, 'color_hsv', 'set', {
    value: { h: 0, s: 100, v: 40 },
  });
  expect(JSON.parse(messages[0]?.payload ?? '{}')).toEqual({
    state: 'ON',
    brightness: 40,
    color: { r: 255, g: 0, b: 0 },
  });
});
