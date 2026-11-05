/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { NativeProviders } from '../lib/provider/native.mjs';

test('enrollment does not retire MQTT or change recorded camera IDs until explicit complete HA handover', async () => {
  const db = new DatabaseSync(':memory:'),
    id = randomUUID(),
    token = 'a'.repeat(64),
    actions = [];
  const connection = {
    bridgeId: id,
    provider: 'aqara',
    clientId: randomUUID(),
    token,
    endpoint: {
      url: 'http://192.168.1.20:8580',
      address: '192.168.1.20',
      family: 4,
      allowHttp: true,
    },
  };
  const inventory = {
    version: 2,
    bridgeId: id,
    provider: 'aqara',
    revision: 'b'.repeat(64),
    cameras: [
      {
        id: 'physical-one',
        name: 'One',
        manufacturer: 'Aqara',
        model: 'G5 Pro',
        available: true,
        identifiers: ['one'],
        stream: { url: 'rtsp://192.168.1.20:8554/one', transport: 'p2p' },
        snapshotPath: '/api/cameras/one/snapshot/last-live',
        entities: [],
      },
    ],
  };
  const client = {
    connection,
    inventory: async () => structuredClone(inventory),
    ready: async (...args) => actions.push(['ready', ...args]),
    revoke: async () => actions.push(['revoke']),
  };
  const manager = new NativeProviders({
    store: { db },
    endpoint: async () => connection.endpoint,
    enroll: async () => client,
    client: () => client,
  });
  try {
    db.exec(
      "CREATE TABLE events(id TEXT PRIMARY KEY,camera_id TEXT,digest TEXT);INSERT INTO events VALUES('old-event','camera.outdoor_camera','original-digest')",
    );
    const old = JSON.stringify(db.prepare('SELECT * FROM events').all());
    await manager.add({ url: connection.endpoint.url, allowHttp: true, code: 'c'.repeat(48) });
    assert.deepEqual(actions, [], 'Enrollment must not acknowledge HA entities or suppress MQTT');
    assert.equal(JSON.stringify(manager.list()).includes(token), false);
    assert.equal(
      manager.bind(id, 'physical-one', 'camera.outdoor_camera'),
      'camera.outdoor_camera',
    );
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM events').all()), old);
    await manager.confirm(id, inventory.revision, ['camera/physical-one']);
    assert.equal(actions[0][0], 'ready');
    await manager.remove(id);
    assert.deepEqual(manager.list(), []);
    assert.equal(manager.identities.resolve(id, 'physical-one'), 'camera.outdoor_camera');
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM events').all()), old);
  } finally {
    db.close();
  }
});

test('a delayed native inventory response cannot resurrect a removed provider', async () => {
  const db = new DatabaseSync(':memory:'),
    id = randomUUID();
  let resolve;
  const connection = {
    bridgeId: id,
    provider: 'tuya',
    clientId: randomUUID(),
    token: 'a'.repeat(64),
    endpoint: {
      url: 'http://192.168.1.20:6766',
      address: '192.168.1.20',
      family: 4,
      allowHttp: true,
    },
  };
  const manager = new NativeProviders({
    store: { db },
    client: () => ({
      inventory: () =>
        new Promise((done) => {
          resolve = done;
        }),
      revoke: async () => {},
    }),
  });
  try {
    db.prepare('INSERT INTO native_providers VALUES(?,?,?)').run(id, JSON.stringify(connection), 1);
    const pending = manager.refresh(id);
    await manager.remove(id);
    resolve({ version: 2, bridgeId: id, provider: 'tuya', cameras: [], revision: 'b'.repeat(64) });
    await assert.rejects(pending, /not_found/);
    assert.deepEqual(manager.list(), []);
    assert.equal(manager.live.has(id), false);
  } finally {
    db.close();
  }
});
