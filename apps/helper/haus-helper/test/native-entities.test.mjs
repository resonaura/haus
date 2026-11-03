/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { NativeEntities } from '../lib/native-entities.mjs';
import { cameraOperating } from '../lib/camera-operating.mjs';
import { cameraSpotlight } from '../lib/camera-spotlight.mjs';
test('MQTT handover requires complete, fresh, non-revoked HA materialization; reconnects do not republish activity', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(
    "CREATE TABLE ha_camera_clients(id TEXT PRIMARY KEY,native_entities INTEGER);INSERT INTO ha_camera_clients VALUES('client',1)",
  );
  let at = 100000;
  const camera = {
    id: 'physical',
    name: 'One',
    available: true,
    entities: [
      {
        id: 'switch',
        name: 'Detection',
        domain: 'switch',
        writable: true,
        available: true,
        state: true,
      },
    ],
  };
  const inventory = {
      bridgeId: randomUUID(),
      provider: 'aqara',
      reachable: true,
      revision: 'b'.repeat(64),
      cameras: [camera],
    },
    confirmed = [];
  const native = new NativeEntities({
    store: { db },
    now: () => at,
    sources: {
      rows: () => [
        {
          bridgeId: inventory.bridgeId,
          physicalId: 'physical',
          value: { cameraId: 'camera.one', physical: camera },
        },
      ],
    },
    providers: { inventory: () => inventory, confirm: async (...args) => confirmed.push(args) },
    registry: () => ({
      cameras: [{ id: 'camera.one', nativeProvider: { bridgeId: inventory.bridgeId } }],
    }),
    activity: { status: () => ({ active: false, available: true }) },
  });
  await assert.rejects(native.handover(inventory.bridgeId), /not_ready/);
  assert.throws(
    () =>
      native.acknowledge('client', { cameras: [{ cameraId: 'camera.one', entities: ['switch'] }] }),
    /invalid_native_readiness/,
  );
  native.acknowledge('client', {
    cameras: [{ cameraId: 'camera.one', entities: ['switch', 'haus_activity'] }],
  });
  assert.equal(
    native.ownsActivity('camera.one'),
    false,
    'Materialization alone must not retire any legacy discovery',
  );
  at += 31000;
  await assert.rejects(native.handover(inventory.bridgeId), /not_ready/);
  native.acknowledge('client', {
    cameras: [{ cameraId: 'camera.one', entities: ['switch', 'haus_activity'] }],
  });
  await native.handover(inventory.bridgeId);
  assert.deepEqual(confirmed[0][2], ['camera/physical', 'entity/physical/switch']);
  at += 600000;
  assert.equal(
    native.ownsActivity('camera.one'),
    true,
    'Transient HA loss must not republish a duplicate MQTT activity sensor',
  );
  db.exec("DELETE FROM ha_camera_clients WHERE id='client'");
  assert.equal(native.ownsActivity('camera.one'), false);
  await assert.rejects(native.handover(inventory.bridgeId), /not_ready/);
});
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
  physical.available = false;
  await assert.rejects(operating.write(camera.id, 'nightVision', night.id, true), /unavailable/);
  assert.equal(commands.length, 2, 'Reachable bridge does not make an offline camera writable');
  physical.available = true;
  reachable = false;
  await assert.rejects(operating.write(camera.id, 'nightVision', night.id, true), /unavailable/);
  assert.equal(commands.length, 2);
});
