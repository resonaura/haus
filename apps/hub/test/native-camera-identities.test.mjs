/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NativeCameraIdentities } from '../lib/camera/identities.mjs';
import { openTestCameraCatalog } from './support/catalog.mjs';

test('native enrollment retains recording IDs and leaves events and preferences unchanged', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-native-identities-'));
  const file = join(directory, 'catalog.sqlite');
  let db = new DatabaseSync(file);
  let dbOpen = true;
  const closeDb = () => {
    if (dbOpen) {
      db.close();
      dbOpen = false;
    }
  };
  let owner;
  t.after(async () => {
    await owner?.close();
    closeDb();
    await rm(directory, { recursive: true, force: true });
  });
  db.exec(
    'CREATE TABLE events(id TEXT PRIMARY KEY,camera_id TEXT,digest TEXT,original_path TEXT);CREATE TABLE settings(id TEXT PRIMARY KEY,value TEXT);',
  );
  for (const id of [
    'camera.outdoor_camera',
    'camera.guinea_pigs_camera',
    'camera.outdoor_side_camera',
    'camera.narnia_camera',
  ]) {
    db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(
      'event:' + id,
      id,
      'sha256:' + id,
      'originals/' + id + '/one.mp4',
    );
    db.prepare('INSERT INTO settings VALUES(?,?)').run(
      id,
      JSON.stringify({ enabled: true, recordAudio: true }),
    );
  }
  const baseline = JSON.stringify({
    events: db.prepare('SELECT * FROM events ORDER BY id').all(),
    settings: db.prepare('SELECT * FROM settings ORDER BY id').all(),
  });
  closeDb();
  owner = await openTestCameraCatalog(file);
  const bridgeId = randomUUID();
  let changed = 0;
  const identities = new NativeCameraIdentities(owner.cameraCatalog, () => changed++);
  for (const id of [
    'camera.outdoor_camera',
    'camera.guinea_pigs_camera',
    'camera.outdoor_side_camera',
    'camera.narnia_camera',
  ])
    assert.equal(await identities.resolve(bridgeId, 'physical:' + id, id), id);
  assert.equal(changed, 4);
  await owner.close();
  owner = undefined;
  db = new DatabaseSync(file);
  assert.equal(
    JSON.stringify({
      events: db.prepare('SELECT * FROM events ORDER BY id').all(),
      settings: db.prepare('SELECT * FROM settings ORDER BY id').all(),
    }),
    baseline,
  );
  closeDb();
  owner = await openTestCameraCatalog(file);
  const reopened = new NativeCameraIdentities(owner.cameraCatalog);
  assert.equal(
    await reopened.resolve(bridgeId, 'physical:camera.outdoor_camera'),
    'camera.outdoor_camera',
  );
  await assert.rejects(
    reopened.resolve(bridgeId, 'physical:camera.outdoor_camera', 'camera.outdoor_camera_2'),
    /identity_conflict/,
  );
  await assert.rejects(
    reopened.resolve(randomUUID(), 'different', 'camera.outdoor_camera'),
    /identity_conflict/,
  );
  assert.equal(reopened.list(bridgeId).length, 4);
});

test('new cameras receive durable distinct IDs without deriving identity from their changing HA display name', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-native-camera-ids-'));
  const owner = await openTestCameraCatalog(join(directory, 'catalog.sqlite'));
  t.after(async () => {
    await owner.close();
    await rm(directory, { recursive: true, force: true });
  });
  let changed = 0;
  const identities = new NativeCameraIdentities(owner.cameraCatalog, () => changed++);
  const a = randomUUID();
  const b = randomUUID();
  const id = await identities.resolve(a, 'camera-1');
  assert.match(id, /^camera\.haus_[a-f0-9]{32}$/);
  assert.equal(await identities.resolve(a, 'camera-1'), id);
  assert.notEqual(await identities.resolve(a, 'camera-2'), id);
  assert.notEqual(await identities.resolve(b, 'camera-1'), id);
  assert.equal(changed, 3);
  assert.throws(() => identities.select(a, '../../file'), /invalid_native_camera_identity/);
});
