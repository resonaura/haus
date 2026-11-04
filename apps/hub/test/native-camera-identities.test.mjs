/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NativeCameraIdentities } from '../lib/native-camera-identities.mjs';

test('native enrollment retains existing recording camera IDs and leaves catalog/preferences byte-identical', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-native-identities-')),
    file = join(directory, 'catalog.sqlite');
  let db = new DatabaseSync(file);
  try {
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
    db.exec(
      "CREATE TRIGGER protect_catalog_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'catalog must not change');END;CREATE TRIGGER protect_catalog_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'catalog must not change');END;",
    );
    const bridgeId = randomUUID(),
      identities = new NativeCameraIdentities(db);
    for (const id of [
      'camera.outdoor_camera',
      'camera.guinea_pigs_camera',
      'camera.outdoor_side_camera',
      'camera.narnia_camera',
    ])
      assert.equal(identities.resolve(bridgeId, 'physical:' + id, id), id);
    assert.equal(
      JSON.stringify({
        events: db.prepare('SELECT * FROM events ORDER BY id').all(),
        settings: db.prepare('SELECT * FROM settings ORDER BY id').all(),
      }),
      baseline,
    );
    db.close();
    db = new DatabaseSync(file);
    const restored = new NativeCameraIdentities(db);
    assert.equal(
      restored.resolve(bridgeId, 'physical:camera.outdoor_camera'),
      'camera.outdoor_camera',
    );
    assert.throws(
      () => restored.resolve(bridgeId, 'physical:camera.outdoor_camera', 'camera.outdoor_camera_2'),
      /identity_conflict/,
    );
    assert.throws(
      () => restored.resolve(randomUUID(), 'different', 'camera.outdoor_camera'),
      /identity_conflict/,
    );
    assert.equal(restored.list(bridgeId).length, 4);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('new cameras receive durable distinct IDs without deriving identity from their changing HA display name', () => {
  const db = new DatabaseSync(':memory:');
  try {
    let changed = 0;
    const identities = new NativeCameraIdentities(db, () => changed++),
      a = randomUUID(),
      b = randomUUID();
    const id = identities.resolve(a, 'camera-1');
    assert.match(id, /^camera\.haus_[a-f0-9]{32}$/);
    assert.equal(identities.resolve(a, 'camera-1'), id);
    assert.notEqual(identities.resolve(a, 'camera-2'), id);
    assert.notEqual(identities.resolve(b, 'camera-1'), id);
    assert.equal(changed, 3);
    assert.throws(() => identities.resolve(a, '../../file'), /invalid_native_camera_identity/);
  } finally {
    db.close();
  }
});
