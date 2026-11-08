/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { listen, port, closeServer, stubStore } from '../support/http.js';
import { test, onTestFinished } from 'vitest';
import { openTestHaCatalog } from '../support/catalog.js';
import { queryOne } from '../support/recording.js';
import { HaCameras, type HaCamerasRegistry } from '@haus/ha/node/ha-cameras';
import { discoverCameras } from '@haus/ha/node/discovery';

test('failed HA viewer opens log only a safe reason and still release their owner', async () => {
  const owner = await openTestHaCatalog(),
    catalog = owner.haCatalog,
    logs: Array<Record<string, unknown>> = [],
    released: Array<[string, string]> = [];
  let failure: Error & { code?: string; status?: number } = Object.assign(
    Error('private source credentials'),
    {
      code: 'camera_webrtc_failed',
      status: 503,
    },
  );
  const access = new HaCameras({
    catalog,
    registry: () => ({ cameras: [{ id: 'camera.one' }] }),
    log: (value) => logs.push(value),
    sessions: {
      viewer: async () => {
        throw failure;
      },
      closeViewer: async () => {},
      release: async (...args) => released.push(args),
    },
  });
  onTestFinished(async () => {
    await access.stop();
    await owner.close();
  });
  const sessionId = '11111111-1111-4111-8111-111111111111';
  await assert.rejects(
    access.command('client', 'camera.one', 'viewer', { sessionId, offer: 'v=0 private sdp' }),
  );
  assert.equal(logs[0]!.reason, 'camera_webrtc_failed');
  assert.equal(logs[0]!.status, 503);
  assert.equal(JSON.stringify(logs).includes('private'), false);
  assert.equal(access.viewers.size, 0);
  assert.equal(released.length, 1);
  failure = Error('rtsp://private:secret@camera/live');
  access.log = () => {
    throw Error('logger unavailable');
  };
  await assert.rejects(
    access.command('client', 'camera.one', 'viewer', { sessionId, offer: 'v=0' }),
  );
  assert.equal(released.length, 2);
});

test('native HA view becomes primary only after its legacy entity is gone, without exposing its source', async () => {
  const owner = await openTestHaCatalog(),
    catalog = owner.haCatalog;
  const data: HaCamerasRegistry = {
    cameras: [
      {
        id: 'camera.source',
        available: true,
        nativeSource: { url: 'rtsp://private:secret@192.168.1.2/live' },
        nativeProvider: { bridgeId: 'b', physicalId: 'p', provider: 'aqara' },
      },
    ],
    states: [{ entity_id: 'camera.source', attributes: {} }],
  };
  const access = new HaCameras({
    catalog,
    registry: () => data,
  });
  onTestFinished(async () => {
    await access.stop();
    await owner.close();
  });
  assert.equal(access.cameras()[0]!.native!.primary, false);
  data.states = [{ entity_id: 'camera.native_view', attributes: { haus_camera_proxy: 1 } }];
  assert.equal(access.cameras()[0]!.native!.primary, true);
  data.states = [
    { entity_id: 'camera.source', attributes: { haus_native_camera: 1, haus_camera_proxy: 0 } },
  ];
  assert.equal(
    access.cameras()[0]!.native!.primary,
    true,
    'A native entity renamed to the original ID must not demote itself',
  );
  assert.equal(JSON.stringify(access.cameras()).includes('secret'), false);
  data.states = [{ entity_id: 'camera.source', state: 'unavailable', attributes: {} }];
  data.entities = [{ entity_id: 'camera.source', platform: 'haus' }];
  assert.equal(
    access.cameras()[0]!.native!.primary,
    true,
    'HA omits extra state attributes while unavailable; exact registry ownership remains authoritative',
  );
  data.entities[0]!.platform = 'generic';
  assert.equal(access.cameras()[0]!.native!.primary, false);
});

test('HA enrollment is one-use, camera-only and revocable without persisting plaintext tokens', async () => {
  const owner = await openTestHaCatalog(),
    catalog = owner.haCatalog,
    db = owner.source;
  let at = 1000000;
  const revoked: string[] = [];
  const access = new HaCameras({
    catalog,
    registry: () => ({ cameras: [{ id: 'camera.source', available: true }] }),
    snapshots: { snapshot: async () => ({ buffer: Buffer.from([255, 216]) }) },
    now: () => at,
    onRevoke: (id) => revoked.push(id),
  });
  onTestFinished(async () => {
    await access.stop();
    await owner.close();
  });
  const code = await access.setup({ action: 'setup' });
  const enrolled = await access.enroll({ code: code.setupCode });
  assert.equal(access.canManageNative(enrolled.clientId), false);
  const native = await access.enroll({
    code: (await access.setup({ action: 'setup', nativeEntities: true })).setupCode,
  });
  assert.equal(access.canManageNative(native.clientId), true);
  assert.equal(native.nativeEntities, true);
  assert.equal(
    access.canManageNative(enrolled.clientId),
    false,
    'Existing read-only clients never inherit a new grant',
  );
  await access.revoke(native.clientId);
  assert.deepEqual(revoked, [native.clientId]);
  assert.equal(access.canManageNative(native.clientId), false);
  await assert.rejects(
    async () => await access.enroll({ code: code.setupCode }),
    /invalid_ha_setup_code/,
  );
  assert.equal(
    access.authenticate({ headers: { authorization: `Bearer ${enrolled.token}` } }),
    enrolled.clientId,
  );
  assert.notEqual(
    (await queryOne<{ token_hash: string }>(db, 'SELECT token_hash FROM ha_camera_clients'))!
      .token_hash,
    enrolled.token,
  );
  assert.equal(
    (
      (await access.command(enrolled.clientId, 'camera.source', 'snapshot', {})) as {
        buffer: Buffer;
      }
    ).buffer[0],
    255,
  );
  await access.revoke(enrolled.clientId);
  assert.equal(
    access.authenticate({ headers: { authorization: `Bearer ${enrolled.token}` } }),
    undefined,
  );
  const stale = await access.setup({ action: 'setup' });
  at += 600001;
  await assert.rejects(
    async () => await access.enroll({ code: stale.setupCode }),
    /invalid_ha_setup_code/,
  );
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

test('Generic Camera Basic compatibility is restricted to exact read-only snapshots and remains revocable', async () => {
  const owner = await openTestHaCatalog(),
    catalog = owner.haCatalog;
  const access = new HaCameras({
    catalog,
    registry: () => ({ cameras: [] }),
  });
  onTestFinished(async () => {
    await access.stop();
    await owner.close();
  });
  const enrolled = await access.enroll({
    code: (await access.setup({ action: 'setup' })).setupCode,
  });
  const authorization = 'Basic ' + Buffer.from('haus:' + enrolled.token).toString('base64');
  const request = (method: string, url: string, header = authorization) => ({
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
  ] as const)
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

test('scoped HTTP snapshot accepts Generic auth, carries age and rejects Basic signaling', async () => {
  const { createApi } = await import('@haus/hub/runtime');
  const owner = await openTestHaCatalog(),
    catalog = owner.haCatalog;
  const commands: Array<[string, string, unknown]> = [];
  const server = createApi({
    config: { standalone: true, apiToken: 'admin-fixture' },
    store: stubStore(),
    haCatalog: catalog,
    servers: null,
    ha: {},
    recorder: {},
    getRegistry: () => ({ cameras: [{ id: 'camera.fixture', available: true }] }),
    cameraSessions: {},
    nativeEntities: {
      devices: () => [{ cameraId: 'camera.fixture', entities: [] }],
      command: async (...args) => {
        commands.push(args);
        return { accepted: true };
      },
    },
    snapshots: {
      snapshot: async () => ({
        buffer: Buffer.from([255, 216, 1, 255, 217]),
        mime: 'image/jpeg',
        at: 10000,
        stale: true,
      }),
    },
  });
  onTestFinished(async () => {
    server.closeAllConnections();
    await closeServer(server);
    await owner.close();
  });
  await listen(server);
  const base = 'http://127.0.0.1:' + port(server);
  const headers = { 'content-type': 'application/json', 'x-haus-client': '1' };
  const setup = (await fetch(base + '/api/ha-integration', {
    method: 'POST',
    headers: { ...headers, Authorization: 'Bearer admin-fixture' },
    body: JSON.stringify({ action: 'setup' }),
  }).then((r) => r.json())) as { setupCode: string };
  const enrolled = (await fetch(base + '/ha/enroll', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: setup.setupCode }),
  }).then((r) => r.json())) as { token: string };
  const nativePath = '/ha/native/camera.fixture/light/command';
  const readHeaders = { ...headers, authorization: `Bearer ${enrolled.token}` };
  assert.equal((await fetch(base + '/ha/native/devices', { headers: readHeaders })).status, 403);
  assert.equal(
    (await fetch(base + nativePath, { method: 'POST', headers: readHeaders, body: '{}' })).status,
    403,
  );
  assert.equal(commands.length, 0);
  const nativeSetup = (await fetch(base + '/api/ha-integration', {
    method: 'POST',
    headers: { ...headers, Authorization: 'Bearer admin-fixture' },
    body: JSON.stringify({ action: 'setup', nativeEntities: true }),
  }).then((r) => r.json())) as { setupCode: string };
  const nativeClient = (await fetch(base + '/ha/enroll', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: nativeSetup.setupCode }),
  }).then((r) => r.json())) as { token: string };
  const nativeHeaders = { ...headers, authorization: `Bearer ${nativeClient.token}` };
  assert.equal((await fetch(base + '/ha/native/devices', { headers: nativeHeaders })).status, 200);
  assert.equal(
    (await fetch(base + nativePath, { method: 'POST', headers: nativeHeaders, body: '{}' })).status,
    200,
  );
  assert.equal(commands.length, 1);
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
