/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { HaCameras } from '../lib/ha-cameras.mjs';
import { discoverCameras } from '../lib/discovery.mjs';

test('HA enrollment is one-use, camera-only and revocable without persisting plaintext tokens', async (t) => {
  const db = new DatabaseSync(':memory:');
  let at = 1000000;
  const access = new HaCameras({
    store: { db },
    registry: () => ({ cameras: [{ id: 'camera.source', available: true }] }),
    snapshots: { snapshot: async () => ({ buffer: Buffer.from([255, 216]) }) },
    sessions: {},
    now: () => at,
  });
  t.after(async () => {
    await access.stop();
    db.close();
  });
  const code = access.setup({ action: 'setup' });
  const enrolled = access.enroll({ code: code.setupCode });
  assert.throws(() => access.enroll({ code: code.setupCode }), /invalid_ha_setup_code/);
  assert.equal(
    access.authenticate({ headers: { authorization: `Bearer ${enrolled.token}` } }),
    enrolled.clientId,
  );
  assert.notEqual(
    db.prepare('SELECT token_hash FROM ha_camera_clients').get().token_hash,
    enrolled.token,
  );
  assert.equal(
    (await access.command(enrolled.clientId, 'camera.source', 'snapshot', {})).buffer[0],
    255,
  );
  await access.revoke(enrolled.clientId);
  assert.equal(
    access.authenticate({ headers: { authorization: `Bearer ${enrolled.token}` } }),
    undefined,
  );
  const stale = access.setup({ action: 'setup' });
  at += 600001;
  assert.throws(() => access.enroll({ code: stale.setupCode }), /invalid_ha_setup_code/);
});

test('optimized Haus cameras are never rediscovered as source cameras', () => {
  const cameras = discoverCameras(
    [
      { entity_id: 'camera.original', state: 'idle', attributes: { friendly_name: 'Original' } },
      {
        entity_id: 'camera.haus_proxy',
        state: 'idle',
        attributes: { haus_camera_proxy: 1, haus_source_camera: 'camera.original' },
      },
      { entity_id: 'camera.hidden_marker', state: 'idle', attributes: {} },
    ],
    [{ entity_id: 'camera.hidden_marker', platform: 'haus' }],
    [],
  );
  assert.deepEqual(
    cameras.map((camera) => camera.id),
    ['camera.original'],
  );
});

test('Generic Camera Basic compatibility is restricted to exact read-only snapshots and remains revocable', async (t) => {
  const db = new DatabaseSync(':memory:');
  const access = new HaCameras({
    store: { db },
    registry: () => ({ cameras: [] }),
    snapshots: {},
    sessions: {},
  });
  t.after(async () => {
    await access.stop();
    db.close();
  });
  const enrolled = access.enroll({ code: access.setup({ action: 'setup' }).setupCode });
  const authorization = 'Basic ' + Buffer.from('haus:' + enrolled.token).toString('base64');
  const request = (method, url, header = authorization) => ({
    method,
    url,
    headers: { authorization: header },
  });
  assert.equal(
    access.authenticate(request('GET', '/ha/cameras/camera.garden/snapshot')),
    enrolled.clientId,
  );
  for (const [method, url] of [
    ['POST', '/ha/cameras/camera.garden/snapshot'],
    ['GET', '/ha/cameras'],
    ['POST', '/ha/revoke'],
    ['POST', '/ha/cameras/camera.garden/viewer'],
    ['GET', '/ha/cameras/camera.garden/snapshot?extra=1'],
    ['GET', '/api/cluster'],
  ])
    assert.equal(access.authenticate(request(method, url)), undefined);
  assert.equal(
    access.authenticate(
      request(
        'GET',
        '/ha/cameras/camera.garden/snapshot',
        'Basic ' + Buffer.from('admin:' + enrolled.token).toString('base64'),
      ),
    ),
    undefined,
  );
  await access.revoke(enrolled.clientId);
  assert.equal(
    access.authenticate(request('GET', '/ha/cameras/camera.garden/snapshot')),
    undefined,
  );
});

test('scoped HTTP snapshot accepts Generic auth, carries age and rejects Basic signaling', async (t) => {
  const { createApi } = await import('../lib/server.mjs');
  const db = new DatabaseSync(':memory:');
  const server = createApi({
    config: { standalone: true, apiToken: 'admin-fixture' },
    store: { db },
    servers: null,
    ha: {},
    recorder: {},
    getRegistry: () => ({ cameras: [{ id: 'camera.fixture', available: true }] }),
    cameraSessions: {},
    snapshots: {
      snapshot: async () => ({
        buffer: Buffer.from([255, 216, 1, 255, 217]),
        mime: 'image/jpeg',
        at: 10000,
        stale: true,
      }),
    },
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { 'content-type': 'application/json', 'x-haus-client': '1' };
  const setup = await fetch(base + '/api/ha-integration', {
    method: 'POST',
    headers: { ...headers, Authorization: 'Bearer admin-fixture' },
    body: JSON.stringify({ action: 'setup' }),
  }).then((r) => r.json());
  const enrolled = await fetch(base + '/ha/enroll', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: setup.setupCode }),
  }).then((r) => r.json());
  const authorization = 'Basic ' + Buffer.from('haus:' + enrolled.token).toString('base64');
  const response = await fetch(base + '/ha/cameras/camera.fixture/snapshot', {
    headers: { authorization },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-haus-snapshot-captured-at'), '10000');
  assert.equal(response.headers.get('x-haus-snapshot-stale'), '1');
  assert.equal((await response.arrayBuffer()).byteLength, 5);
  assert.equal((await fetch(base + '/ha/cameras', { headers: { authorization } })).status, 401);
  assert.equal(
    (
      await fetch(base + '/ha/cameras/camera.fixture/viewer', {
        method: 'POST',
        headers: { ...headers, authorization },
        body: '{}',
      })
    ).status,
    401,
  );
});
