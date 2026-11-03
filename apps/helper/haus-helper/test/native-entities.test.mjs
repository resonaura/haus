/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NativeEntities } from '../lib/native-entities.mjs';
import { cameraOperating } from '../lib/camera-operating.mjs';
import { cameraSpotlight } from '../lib/camera-spotlight.mjs';
test('native controls preserve scope, canonical activity and automatic night vision without exposing source telemetry', async () => {
  const commands = [];
  const camera = { id: 'camera.one', name: 'One', nativeProvider: { bridgeId: 'bridge' } };
  const entities = [
    {
      id: 'infrared_mode',
      role: 'nightVision',
      name: 'Night vision',
      domain: 'select',
      options: ['off', 'auto', 'on'],
      homekit: { enabledValue: 'auto', disabledValue: 'off' },
      writable: true,
      available: true,
      state: 'auto',
    },
    {
      id: 'spotlight',
      role: 'spotlight',
      name: 'Spotlight',
      domain: 'light',
      writable: true,
      available: true,
      brightness: true,
      state: { on: true, brightness: 50 },
    },
    { id: 'raw_motion', role: 'motion', domain: 'binary_sensor', available: true, state: true },
    {
      id: 'p2p_rtsp_stream',
      domain: 'sensor',
      available: true,
      state: 'rtsp://private:secret@192.168.1.2/live',
    },
    {
      id: 'unknown_address',
      domain: 'sensor',
      available: true,
      state: 'rtmp://private:secret@192.168.1.2/talk',
    },
  ];
  const physical = {
    id: 'physical',
    manufacturer: 'Aqara',
    model: 'G5 Pro',
    available: true,
    entities,
  };
  let reachable = true;
  const inventory = () => ({ reachable, cameras: [physical] });
  const native = new NativeEntities({
    sources: {
      rows: () => [
        { bridgeId: 'bridge', physicalId: 'physical', value: { cameraId: camera.id, physical } },
      ],
    },
    providers: {
      inventory,
      refresh: async () => {},
      command: async (...args) => commands.push(args),
    },
    registry: () => ({ cameras: [camera] }),
    activity: { status: () => ({ available: true, active: false, source: 'assisted' }) },
  });
  const device = native.devices()[0];
  assert.equal(JSON.stringify(device).includes('secret'), false);
  assert.equal(device.entities.filter((entity) => entity.role === 'motion').length, 1);
  assert.equal(
    device.entities.find((entity) => entity.id === 'haus_activity').state,
    false,
    'Only canonical Activity, not raw motion, becomes the native HA sensor',
  );
  const operating = cameraOperating({
    ha: { connected: false },
    registry: () => ({ cameras: [camera] }),
    native,
  });
  const night = operating.read(camera.id).nightVision;
  assert.equal(night.value, true);
  await operating.write(camera.id, 'nightVision', night.id, true);
  assert.equal(commands[0][3].value, 'auto', 'HomeKit permission must never force infrared on');
  const spotlight = cameraSpotlight({
    ha: { connected: false },
    registry: () => ({ cameras: [camera] }),
    native,
  });
  assert.equal(spotlight.read(camera.id).brightness, 50);
  await spotlight.write(camera.id, 'native:spotlight', { brightness: 30 });
  assert.deepEqual(commands[1][3], { action: 'set', value: { brightness: 30 } });
  await assert.rejects(
    native.command('camera.other', 'spotlight', {
      requestId: randomUUID(),
      command: { action: 'set', value: { on: false } },
    }),
    /unavailable/,
  );
  await assert.rejects(
    native.command(camera.id, 'p2p_rtsp_stream', {
      requestId: randomUUID(),
      command: { action: 'set', value: 'off' },
    }),
    /unavailable/,
  );
  reachable = false;
  await assert.rejects(operating.write(camera.id, 'nightVision', night.id, true), /unavailable/);
  assert.equal(commands.length, 2);
});
