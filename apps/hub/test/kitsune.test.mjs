/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApi } from '../lib/server.mjs';
import { openTestRecordingStore, queryOne, queryRows } from "./support/recording.mjs";
import { HaCatalog, Transactions } from '@haus/hub/storage';
import { HaCameras } from '@haus/ha/node/ha-cameras';
import { nvrCameraSource } from '../lib/camera/sessions.mjs';
import { CameraAvailability } from '../lib/camera/availability.mjs';
import { NativeEntities } from '@haus/ha/node/native-entities';
import { ServiceCatalog } from '@haus/hub/servers';
import { openTestCatalog } from './support/catalog.mjs';

test('Kitsune setup is authenticated, pins resolved versions and never returns source credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-kitsune-api-'));
  await mkdir(join(directory, 'media'));
  const store = await openTestRecordingStore(join(directory, 'test.sqlite'), join(directory, 'media'));
  const catalogOwner = await openTestCatalog(join(directory, 'test.sqlite'));
  const serviceCatalog = new ServiceCatalog(catalogOwner.transactions);
  await serviceCatalog.initialize();
  let enables = 0;
  const catalog = new HaCatalog(new Transactions(store.source));
  await catalog.initialize();
  await catalog.enroll({ id: "fixture-client", tokenHash: "fixture", createdAt: 0, nativeEntities: true });
  const camera = { id: 'camera.kitsune_fixture', available: true, enabled: false, sensors: [], independentSource: true, kitsuneSource: { kind: 'rtsp', url: 'rtsp://fixture-password@192.168.1.2/main' } };
  const server = createApi({ config: { standalone: true, apiToken: 'fixture-api-token' }, ha: { connected: true }, store, serviceCatalog, recorder: { status: () => [] }, getRegistry: () => ({ cameras: [camera] }), refresh: async () => {}, kitsune: {
    hub: { catalog: () => [{ id: 'rtsp', route: { driver: 'npm', package: '@scrypted/rtsp' } }], plugins: new Map([['@scrypted/rtsp', { plugin: { version: '1.2.3' }, call: async () => [{ key: 'newCamera' }] }]]), canWebhook: (_plugin, token) => token === 'a'.repeat(64), webhook: async () => ({ code: 202, headers: { 'content-type': 'text/plain' }, body: Buffer.from('accepted') }) },
    enable: async () => { enables++; return { driver: 'npm', vendor: 'rtsp', version: '1.2.3' }; },
    onboard: async (_vendor, fields) => { if (!fields.url) throw Error('kitsune_missing_field:url'); if (fields.url === 'review') throw Error('kitsune_setting_requires_review:url'); return 'camera-fixture'; },
  } });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await catalogOwner.close(); (await store.close()); await rm(directory, { recursive: true, force: true }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + '/api/kitsune/catalog')).status, 401);
  const headers = { Authorization: 'Bearer fixture-api-token', 'content-type': 'application/json', 'x-haus-client': '1' };
  const enabled = await fetch(origin + '/api/kitsune/rtsp/enable', { method: 'POST', headers, body: '{}' });
  assert.equal(enabled.status, 200); assert.equal(enables, 1);
  assert.equal(serviceCatalog.plugins().find((item) => item.vendor === 'rtsp').version, '1.2.3');
  const settings = await fetch(origin + '/api/kitsune/rtsp/settings', { method: 'POST', headers, body: '{}' });
  assert.deepEqual(await settings.json(), { settings: [{ key: 'newCamera' }] });
  const review = await fetch(origin + '/api/kitsune/rtsp/onboard', { method: 'POST', headers, body: JSON.stringify({ fields: { url: 'review' } }) });
  assert.equal(review.status, 409); assert.deepEqual(await review.json(), { error: 'kitsune_setting_requires_review' });
  const created = await fetch(origin + '/api/kitsune/rtsp/onboard', { method: 'POST', headers, body: JSON.stringify({ fields: { url: 'rtsp://192.168.1.2/main' } }) });
  assert.equal(created.status, 200); assert.deepEqual(await created.json(), { created: 'camera-fixture' });
  const publicCameras = await (await fetch(origin + '/api/cameras', { headers })).text(); assert.ok(!publicCameras.includes('fixture-password'));
  const hook = '/api/kitsune/hooks/' + 'a'.repeat(64) + '/%40scrypted%2Frtsp//motion';
  const delivered = await fetch(origin + hook, { method: 'POST', body: 'event' }); assert.equal(delivered.status, 202); assert.equal(await delivered.text(), 'accepted');
  assert.equal((await fetch(origin + hook.replace('a'.repeat(64), 'b'.repeat(64)), { method: 'POST', body: 'event' })).status, 401);
});

test('plugin sources retain their identity, remain independent of HA and become native HA views', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-kitsune-ha-'));
  const store = await openTestRecordingStore(join(directory, 'test.sqlite'), directory);
  const catalog = new HaCatalog(new Transactions(store.source));
  await catalog.initialize();
  await catalog.enroll({ id: "fixture-client", tokenHash: "fixture", createdAt: 0, nativeEntities: true });
  const camera = { id: 'camera.kitsune_fixture', name: 'Front', available: true, independentSource: true, kitsuneProvider: { pluginId: '@fixture/camera', deviceId: 'kitsune:fixture' }, kitsuneSource: { kind: 'rtsp', url: 'rtsp://192.168.1.2/main' } };
  const ha = new HaCameras({ catalog, registry: () => ({ cameras: [camera] }), snapshots: {}, sessions: {} });
  t.after(async () => { await ha.stop(); (await store.close()); await rm(directory, { recursive: true, force: true }); });
  const view = ha.cameras()[0]; assert.equal(view.native.primary, true); assert.equal(view.native.physicalId, 'kitsune:fixture');
  assert.ok(!JSON.stringify(view).includes('rtsp://'));
  assert.deepEqual(nvrCameraSource(camera, { states: [], entities: [] }), camera.kitsuneSource);
  new CameraAvailability().apply([camera], [], new Map()); assert.equal(camera.available, true);
  const native = new NativeEntities({ catalog, sources: { rows: () => [] }, providers: { inventory: () => { throw Error('plugin must not use native bridge enrollment'); } }, registry: () => ({ cameras: [camera] }), activity: { status: () => ({ active: true, available: true, replaces: [] }) } });
  const device = native.devices()[0];
  assert.equal(device.bridgeId, view.native.bridgeId);
  assert.equal(device.entities[0].id, 'haus_activity');
  assert.equal(device.entities[0].state, true);
  assert.deepEqual(await native.acknowledge('fixture-client', { cameras: [{ cameraId: camera.id, entities: ['haus_activity'] }] }), { ready: true });
  assert.equal((await queryOne(store, 'SELECT COUNT(*) AS total FROM native_ha_owner', )).total, 0);
});
