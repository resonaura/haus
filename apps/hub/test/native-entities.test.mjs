/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { NativeEntities } from '@haus/ha/node/native-entities';
import { cameraOperating } from '../lib/camera/operating.mjs';
import { cameraSpotlight } from '../lib/camera/spotlight.mjs';
test('handover review distinguishes import, HA readiness, exact legacy identity and durable ownership', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(
    "CREATE TABLE ha_camera_clients(id TEXT PRIMARY KEY,native_entities INTEGER);INSERT INTO ha_camera_clients VALUES('client',1)",
  );
  let at = 100000,
    imported = false;
  const physical = {
    id: 'physical',
    identifiers: ['serial'],
    name: 'Camera',
    entities: [],
    available: false,
  };
  const inventory = {
    provider: 'aqara',
    cameras: [physical],
    revision: 'a'.repeat(64),
    reachable: true,
  };
  const row = {
    bridgeId: 'bridge',
    physicalId: 'physical',
    value: { cameraId: 'camera.one', physical },
  };
  const native = new NativeEntities({
    store: { db },
    now: () => at,
    sources: { rows: () => (imported ? [row] : []) },
    providers: {
      inventory: () => inventory,
      confirm: async () => {},
      list: () => [{ id: 'bridge', provider: 'aqara' }],
    },
    registry: () => ({ cameras: [{ id: 'camera.one', nativeProvider: { bridgeId: 'bridge' } }] }),
  });
  const registry = {
    entities: [],
    devices: [{ id: 'exact-device', identifiers: [['mqtt', 'serial']] }],
  };
  const status = () => native.handoverStatus('bridge', registry);
  assert.equal(status().state, 'import_required');
  imported = true;
  assert.equal(status().state, 'integration_required');
  native.acknowledge('client', { cameras: [{ cameraId: 'camera.one', entities: [] }] });
  assert.equal(native.supportsDisabledReadiness('camera.one', inventory.revision), false);
  assert.throws(
    () => native.acknowledge('client', { cameras: [], features: { disabledReadiness: 'true' } }),
    /invalid_native_readiness/,
  );
  native.acknowledge('client', {
    cameras: [{ cameraId: 'camera.one', entities: [] }],
    features: { disabledReadiness: true },
  });
  assert.equal(native.supportsDisabledReadiness('camera.one', inventory.revision), true);
  assert.equal(
    status().state,
    'ready',
    'A disconnected physical camera can still have complete HA entities',
  );
  registry.entities.push(
    {
      entity_id: 'switch.unrelated',
      platform: 'mqtt',
      device_id: 'other',
      unique_id: 'physical_led',
    },
    {
      entity_id: 'switch.similar',
      platform: 'mqtt',
      device_id: 'exact-device',
      unique_id: 'custom_led_identifier',
    },
  );
  assert.equal(status().state, 'migration_required');
  assert.deepEqual(status().cameras[0].legacyEntities, ['switch.similar']);
  registry.entities.pop();
  registry.entities.push({ entity_id: 'camera.one', platform: 'generic' });
  assert.equal(status().state, 'migration_required');
  registry.entities.pop();
  await native.handover('bridge');
  inventory.reachable = false;
  at += 100000;
  assert.equal(
    native.supportsDisabledReadiness('camera.one', inventory.revision),
    false,
    'Readiness features expire and are not inferred from an older adapter',
  );
  assert.equal(status().state, 'connected', 'HA outage does not revoke durable ownership');
  native.revokeClient('client');
  assert.equal(status().state, 'restoring');
  db.exec("DELETE FROM ha_camera_clients WHERE id='client';DELETE FROM native_ha_release");
  assert.equal(status().state, 'unavailable');
  native.providers.inventory = () => {
    throw Error('offline');
  };
  assert.equal(status().state, 'unavailable');
});
test(
  'a blocked provider release cannot delay another bridge handover or undo a newer owner',
  { timeout: 2000 },
  async (t) => {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    db.exec(
      "CREATE TABLE ha_camera_clients(id TEXT PRIMARY KEY,native_entities INTEGER);INSERT INTO ha_camera_clients VALUES('old',1),('new',1)",
    );
    let at = 100000;
    const inventories = ['offline', 'healthy'].map((id) => ({
      bridgeId: id,
      provider: 'aqara',
      reachable: true,
      revision: id,
      cameras: [{ id: 'physical', name: id, available: true, entities: [] }],
    }));
    const sources = inventories.map((inventory) => ({
      bridgeId: inventory.bridgeId,
      physicalId: 'physical',
      value: { cameraId: `camera.${inventory.bridgeId}`, physical: inventory.cameras[0] },
    }));
    const released = [];
    const native = new NativeEntities({
      store: { db },
      now: () => at,
      sources: { rows: () => sources },
      registry: () => ({
        cameras: sources.map((row) => ({
          id: row.value.cameraId,
          nativeProvider: { bridgeId: row.bridgeId },
        })),
      }),
      providers: {
        inventory: (id) => inventories.find((value) => value.bridgeId === id),
        confirm: async () => {},
        releaseNative: async (id) => released.push(id),
      },
    });
    const acknowledge = (client, id) =>
      native.acknowledge(client, { cameras: [{ cameraId: `camera.${id}`, entities: [] }] });
    acknowledge('old', 'offline');
    await native.handover('offline');
    native.revokeClient('old');
    db.exec("DELETE FROM ha_camera_clients WHERE id='old'");
    let enterRelease, finishRelease;
    const releaseStarted = new Promise((resolve) => {
      enterRelease = resolve;
    });
    const releaseBlocked = new Promise((resolve) => {
      finishRelease = resolve;
    });
    native.providers.releaseNative = async (id) => {
      enterRelease();
      await releaseBlocked;
      released.push(id);
    };
    const cleanup = native.tick();
    await releaseStarted;
    acknowledge('new', 'healthy');
    let deadline;
    try {
      await Promise.race([
        native.handover('healthy'),
        new Promise((_, reject) => {
          deadline = setTimeout(
            () => reject(Error('Healthy handover blocked by offline provider')),
            500,
          );
        }),
      ]);
      assert.equal(native.ownsActivity('camera.healthy'), true);
    } finally {
      clearTimeout(deadline);
      finishRelease();
      await cleanup;
    }
    assert.deepEqual(released, ['offline']);

    // Queue a release behind a new owner being confirmed on the same bridge.
    db.exec("INSERT INTO ha_camera_clients VALUES('old',1)");
    at++;
    acknowledge('old', 'healthy');
    await native.handover('healthy');
    at++;
    acknowledge('new', 'healthy');
    let enterConfirm, finishConfirm;
    const confirmStarted = new Promise((resolve) => {
      enterConfirm = resolve;
    });
    const confirmBlocked = new Promise((resolve) => {
      finishConfirm = resolve;
    });
    native.providers.confirm = async () => {
      enterConfirm();
      await confirmBlocked;
    };
    const handover = native.handover('healthy');
    await confirmStarted;
    native.revokeClient('old');
    db.exec("DELETE FROM ha_camera_clients WHERE id='old'");
    const staleCleanup = native.tick();
    finishConfirm();
    await handover;
    await staleCleanup;
    assert.deepEqual(released, ['offline'], 'A cancelled retry must not release the new owner');
    assert.equal(native.ownsActivity('camera.healthy'), true);
  },
);
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
  let unavailable = true,
    released = 0;
  native.providers.releaseNative = async () => {
    if (unavailable) throw Error('offline');
    released++;
  };
  native.revokeClient('client');
  db.exec("DELETE FROM ha_camera_clients WHERE id='client'");
  assert.equal(native.ownsActivity('camera.one'), false);
  await assert.rejects(native.handover(inventory.bridgeId), /not_ready/);
  await native.tick();
  assert.equal(db.prepare('SELECT count(*) n FROM native_ha_release').get().n, 1);
  const restarted = new NativeEntities({ ...native });
  unavailable = false;
  await restarted.tick();
  assert.equal(released, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM native_ha_release').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM native_ha_owner').get().n, 0);
  assert.equal(
    restarted.sources.rows().length,
    1,
    'Revocation restores publication without deleting the native recording source',
  );
  db.exec("INSERT INTO ha_camera_clients VALUES('client',1)");
  native.acknowledge('client', {
    cameras: [{ cameraId: 'camera.one', entities: ['switch', 'haus_activity'] }],
  });
  let entered, finish;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    finish = resolve;
  });
  native.providers.confirm = async () => {
    entered();
    await blocked;
  };
  const pending = native.handover(inventory.bridgeId);
  await started;
  native.revokeClient('client');
  db.exec("DELETE FROM ha_camera_clients WHERE id='client'");
  finish();
  await assert.rejects(pending, /grant_revoked/);
  await native.tick();
  assert.equal(
    released,
    2,
    'A late handover response cannot retain ownership after explicit revocation',
  );
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
