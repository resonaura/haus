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
