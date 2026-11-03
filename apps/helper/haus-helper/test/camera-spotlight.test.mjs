/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraSpotlight } from '../lib/camera-spotlight.mjs';

test('spotlight commands use the camera physical device and only advertised light capabilities', async () => {
  const commands = [],
    data = {
      cameras: [{ id: 'camera.one', deviceIds: ['physical-one'], available: true }],
      entities: [
        {
          entity_id: 'light.camera_spotlight',
          device_id: 'physical-one',
          platform: 'mqtt',
          unique_id: 'one_spotlight',
        },
        { entity_id: 'light.same_room', device_id: 'different' },
      ],
      states: [
        {
          entity_id: 'light.camera_spotlight',
          state: 'on',
          attributes: { brightness: 128, supported_color_modes: ['brightness'] },
        },
        { entity_id: 'light.same_room', state: 'off', attributes: {} },
      ],
    };
  const spotlight = cameraSpotlight({
    registry: () => data,
    ha: { connected: true, request: async (value) => commands.push(value) },
  });
  assert.equal(spotlight.read('camera.one').brightness, 50);
  assert.deepEqual(spotlight.read('camera.one').capabilities, {
    brightness: true,
    color: false,
    colorTemperature: undefined,
  });
  await spotlight.write('camera.one', 'light.camera_spotlight', { brightness: 35 });
  assert.deepEqual(commands, [
    {
      type: 'call_service',
      domain: 'light',
      service: 'turn_on',
      service_data: { entity_id: 'light.camera_spotlight', brightness_pct: 35 },
    },
  ]);
  await assert.rejects(
    spotlight.write('camera.one', 'light.same_room', { on: true }),
    /spotlight_unavailable/,
  );
  await assert.rejects(
    spotlight.write('camera.one', 'light.camera_spotlight', { colorTemperature: 4000 }),
    /invalid_spotlight_command/,
  );
  await assert.rejects(
    spotlight.write('camera.one', 'light.camera_spotlight', { brightness: 101 }),
    /invalid_spotlight_command/,
  );
  data.entities.push({
    entity_id: 'light.second',
    device_id: 'physical-one',
    platform: 'mqtt',
    unique_id: 'other_spotlight',
  });
  assert.equal(spotlight.read('camera.one'), undefined);
  assert.equal(commands.length, 1);
});

test('a stale/offline spotlight cannot issue writes or invent color controls', async () => {
  const data = {
    cameras: [{ id: 'camera.one', deviceId: 'physical-one', available: false }],
    entities: [
      {
        entity_id: 'light.spotlight',
        device_id: 'physical-one',
        platform: 'mqtt',
        unique_id: 'spotlight',
      },
    ],
    states: [
      {
        entity_id: 'light.spotlight',
        state: 'on',
        attributes: { supported_color_modes: ['onoff'] },
      },
    ],
  };
  const spotlight = cameraSpotlight({
    registry: () => data,
    ha: { request: () => assert.fail('No physical writes') },
  });
  assert.equal(spotlight.read('camera.one').available, false);
  assert.equal(spotlight.read('camera.one').capabilities.brightness, false);
  await assert.rejects(
    spotlight.write('camera.one', 'light.spotlight', { on: false }),
    /spotlight_unavailable/,
  );
  data.cameras[0].available = true;
  data.entities[0].platform = 'tuya';
  data.entities[0].unique_id = 'camera_basic_indicator';
  assert.equal(
    spotlight.read('camera.one'),
    undefined,
    'An indicator LED is not a camera spotlight',
  );
});
