/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, expect, it, vi } from 'vitest';
import { mqttFixture } from './fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

it('publishes Haus light scene values using the provider JSON profile', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  const commands: Record<string, unknown>[] = [];
  await fixture.client.subscribe('fixture/light/set', (message) => {
    commands.push(JSON.parse(message.payload) as Record<string, unknown>);
  });

  await fixture.publish('homeassistant/light/workshop/config', {
    schema: 'json',
    name: 'Workshop Lamp',
    unique_id: 'workshop_lamp',
    command_topic: 'fixture/light/set',
    brightness_scale: 100,
    color_temp_kelvin: true,
    supported_color_modes: ['hs', 'color_temp'],
    effect_list: ['Pulse'],
  });
  await fixture.service.drain();

  const endpointId = fixture.home.listDevices()[0]?.endpoints[0]?.id;
  expect(endpointId).toBeDefined();
  fixture.home.registerScene({
    schemaVersion: 1,
    id: 'workshop-light-scene',
    name: 'Workshop light',
    members: [
      {
        endpointId: endpointId ?? '',
        targetState: {
          on_off: true,
          brightness: 128,
          color_temp: 3200,
          effect: 'Pulse',
          color_hsv: { h: 120, s: 100, v: 40 },
        },
      },
    ],
  });

  await fixture.home.activateScene('workshop-light-scene');
  await vi.waitFor(() => expect(commands).toHaveLength(5));
  expect(commands).toEqual([
    { state: 'ON' },
    { state: 'ON', brightness: 50 },
    { state: 'ON', color_temp: 3200 },
    { state: 'ON', effect: 'Pulse' },
    { state: 'ON', brightness: 40, color: { h: 120, s: 100 } },
  ]);
});

it('coalesces HA-imported MQTT light scenes into one atomic JSON publish and protects dynamic effects', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  const goveeCommands: Record<string, unknown>[] = [];
  const nixieCommands: Record<string, unknown>[] = [];
  await fixture.client.subscribe('gv2mqtt/light/bed/set', (message) => {
    goveeCommands.push(JSON.parse(message.payload) as Record<string, unknown>);
  });
  await fixture.client.subscribe('nixie/light/all/set', (message) => {
    nixieCommands.push(JSON.parse(message.payload) as Record<string, unknown>);
  });

  await fixture.publish('homeassistant/light/govee_bed/config', {
    schema: 'json',
    name: 'Bedroom Bed Lamp',
    unique_id: 'govee_bed_lamp',
    command_topic: 'gv2mqtt/light/bed/set',
    brightness_scale: 255,
    color_temp_kelvin: true,
    supported_color_modes: ['rgb', 'color_temp'],
    effect_list: ['Fire'],
  });
  await fixture.publish('homeassistant/light/nixie_all/config', {
    schema: 'json',
    name: 'Nixie All Tubes',
    unique_id: 'nixie_all_tubes',
    command_topic: 'nixie/light/all/set',
    brightness_scale: 255,
    supported_color_modes: ['hs'],
    effect_list: ['Custom', 'Rainbow'],
  });
  await fixture.service.drain();

  const devices = fixture.home.listDevices();
  const goveeEp = devices.find((d) => d.name === 'Bedroom Bed Lamp')?.endpoints[0]?.id ?? '';
  const nixieEp =
    devices.find((d) => d.endpoints.some((ep) => ep.name === 'Nixie All Tubes'))?.endpoints[0]
      ?.id ?? '';
  expect(goveeEp).not.toBe('');
  expect(nixieEp).not.toBe('');

  fixture.home.registerScene({
    schemaVersion: 1,
    id: 'bedroom-bright',
    name: 'Bedroom Bright',
    members: [
      {
        endpointId: goveeEp,
        targetState: {
          on_off: true,
          brightness: 255,
          color_temp_kelvin: 6097,
          color: { r: 255, g: 248, b: 240 },
          hs_color: [31.908, 6.078],
        },
      },
      {
        endpointId: nixieEp,
        targetState: {
          on_off: true,
          brightness: 61,
          color: { r: 255, g: 0, b: 0 },
          effect: 'Custom',
        },
      },
    ],
  });

  fixture.home.registerScene({
    schemaVersion: 1,
    id: 'bedroom-relax',
    name: 'Bedroom Relax',
    members: [
      {
        endpointId: goveeEp,
        targetState: {
          on_off: true,
          brightness: 255,
          color_temp_kelvin: 6097,
          color: { r: 255, g: 248, b: 240 },
          hs_color: [31.908, 6.078],
          effect: 'Fire',
        },
      },
    ],
  });

  await fixture.home.activateScene('bedroom-bright');
  await vi.waitFor(() => {
    expect(goveeCommands).toHaveLength(1);
    expect(nixieCommands).toHaveLength(1);
  });
  expect(goveeCommands[0]).toEqual({ state: 'ON', brightness: 255, color_temp: 6097 });
  expect(nixieCommands[0]).toEqual({
    state: 'ON',
    brightness: 61,
    color: { h: 0, s: 100 },
    effect: 'Custom',
  });

  await fixture.home.activateScene('bedroom-relax');
  await vi.waitFor(() => expect(goveeCommands).toHaveLength(2));
  expect(goveeCommands[1]).toEqual({ state: 'ON', brightness: 255, effect: 'Fire' });
});
