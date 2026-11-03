/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { NativeProviders } from '../lib/native-providers.mjs';
import { NativeCameraSources } from '../lib/native-camera-sources.mjs';
import { nvrCameraSource } from '../lib/nvr-camera-sessions.mjs';
import { CameraAvailability } from '../lib/camera-availability.mjs';

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let at = 100000;
  const bridgeId = randomUUID();
  const physical = {
    id: 'physical',
    name: 'Same name',
    manufacturer: 'Aqara',
    model: 'G5 Pro',
    identifiers: ['real-device'],
    available: true,
    stream: { url: 'rtsp://192.168.1.20:8554/live/one', transport: 'p2p' },
    snapshotPath: '/api/cameras/one/snapshot/last-live',
    entities: [
      {
        id: 'motion',
        role: 'motion',
        domain: 'binary_sensor',
        name: 'Motion',
        state: true,
        available: true,
      },
    ],
  };
  const connection = {
    bridgeId,
    provider: 'aqara',
    clientId: randomUUID(),
    token: 'a'.repeat(64),
    endpoint: {
      url: 'http://192.168.1.20:8580',
      address: '192.168.1.20',
      family: 4,
      allowHttp: true,
    },
  };
  let ready = 0;
  const providers = new NativeProviders({
    store: { db },
    now: () => at,
    endpoint: async () => connection.endpoint,
    enroll: async () => ({
      connection,
      inventory: async () => ({
        bridgeId,
        provider: 'aqara',
        cameras: [structuredClone(physical)],
      }),
    }),
    client: () => ({
      ready: async () => ready++,
      inventory: async () => ({
        bridgeId,
        provider: 'aqara',
        cameras: [structuredClone(physical)],
      }),
    }),
  });
  await providers.add({ url: connection.endpoint.url, code: 'c'.repeat(48), allowHttp: true });
  const sources = new NativeCameraSources({
    providers,
    store: { db },
    resolveSource: () => {
      throw Error('missing');
    },
  });
  const registry = {
    cameras: [
      {
        id: 'camera.outdoor',
        name: 'User name',
        deviceId: 'registered',
        deviceIds: ['registered'],
        areaId: 'garden',
        sensors: [],
        aliases: [],
      },
    ],
    devices: [{ id: 'registered', identifiers: [['mqtt', 'real-device']] }],
    states: [],
  };
  return {
    db,
    physical,
    providers,
    sources,
    registry,
    bridgeId,
    advance: () => {
      at += 31000;
    },
    ready: () => ready,
  };
}
test('native import retains exact recording identity and settings after HA sources disappear, without acknowledging MQTT retirement', async (t) => {
  const f = await fixture(t);
  f.db.exec(
    "CREATE TABLE events(id,camera_id,digest,path);INSERT INTO events VALUES('original','camera.outdoor','sha-original','blobs/original')",
  );
  const before = JSON.stringify(f.db.prepare('SELECT * FROM events').all());
  await assert.rejects(
    f.providers.validate({
      provider: 'aqara',
      cameras: [{ ...f.physical, stream: { ...f.physical.stream, transport: 'native-rtsp' } }],
    }),
    /protected_p2p/,
  );
  const settings = {
    'camera.outdoor': { enabled: true, motionDetection: { enabled: true, mode: 'objects' } },
  };
  f.sources.import(f.bridgeId, ['physical'], f.registry);
  assert.equal(f.ready(), 0);
  const generic = { ...f.registry.cameras[0], deviceId: 'generic-view' };
  const physicalView = f.sources.merge(
    {
      ...f.registry,
      cameras: [generic],
      devices: [
        ...f.registry.devices,
        { id: 'old-haus-view', identifiers: [['haus', `${f.bridgeId}:physical`]] },
        { id: 'scoped-haus-device', identifiers: [['mqtt', 'real-device']] },
      ],
    },
    settings,
  )[0];
  assert.equal(physicalView.deviceId, 'registered');
  assert.equal(physicalView.id, 'camera.outdoor');
  const combined = f.sources.merge(
    {
      ...f.registry,
      cameras: [
        generic,
        { id: 'camera.old_mqtt', name: 'Old view', deviceId: 'registered' },
        { id: 'camera.unrelated', name: 'User name', deviceId: 'another-device' },
      ],
    },
    settings,
  );
  assert.deepEqual(
    combined.map((camera) => camera.id),
    ['camera.outdoor', 'camera.unrelated'],
  );
  assert.ok(combined[0].aliases.includes('camera.old_mqtt'));
  const [camera] = f.sources.merge({ cameras: [], states: [], devices: [] }, settings);
  assert.equal(camera.id, 'camera.outdoor');
  assert.equal(camera.areaId, 'garden');
  assert.equal(camera.name, 'User name');
  assert.equal(camera.enabled, true);
  assert.equal(camera.available, true);
  assert.deepEqual(nvrCameraSource(camera, { states: [], entities: [] }), {
    kind: 'p2p-restream',
    url: f.physical.stream.url,
  });
  new CameraAvailability().apply([camera], [], new Map());
  assert.equal(
    camera.available,
    true,
    'HA presentation loss must not mark a native source offline',
  );
  assert.equal(camera.sensors[0].active, true);
  f.physical.talkback = {
    transport: 'rtmp',
    codec: 'aac',
    url: 'rtmp://192.168.1.20:1935/talk/one',
  };
  await f.providers.refresh(f.bridgeId);
  const withTalkback = f.sources.merge({ cameras: [], states: [] }, settings)[0];
  assert.equal(withTalkback.nativeTalkback, f.physical.talkback.url);
  await assert.rejects(
    f.providers.validate({
      provider: 'aqara',
      cameras: [
        {
          ...f.physical,
          talkback: { ...f.physical.talkback, url: 'rtmp://127.0.0.1:1935/talk/one' },
        },
      ],
    }),
    /invalid_native_talkback/,
  );
  delete f.physical.talkback;
  await f.providers.refresh(f.bridgeId);
  const updated = f.sources.merge({ cameras: [withTalkback], states: [] }, settings)[0];
  assert.equal(updated.nativeTalkback, undefined);
  assert.equal(
    f.sources.merge({ cameras: [], states: [] }, { 'camera.outdoor': { sensorIds: [] } })[0].sensors
      .length,
    0,
    'Explicit detector opt-outs survive a native import',
  );
  assert.equal(
    f.sources.snapshot(camera).url,
    'http://192.168.1.20:8580/api/cameras/one/snapshot/last-live',
  );
  f.advance();
  assert.equal(f.sources.merge({ cameras: [], states: [] }, settings)[0].available, false);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM events').all()), before);
  assert.deepEqual(settings['camera.outdoor'], {
    enabled: true,
    motionDetection: { enabled: true, mode: 'objects' },
  });
});
test('matching names/rooms never confer identity, ambiguity rolls back and missing native cameras stay offline', async (t) => {
  const f = await fixture(t);
  const noIdentity = { ...f.registry, devices: [] };
  assert.equal(f.sources.preview(f.bridgeId, noIdentity)[0].existingCameraId, undefined);
  assert.throws(
    () =>
      f.sources.import(f.bridgeId, ['physical'], {
        ...f.registry,
        cameras: [...f.registry.cameras, { ...f.registry.cameras[0], id: 'camera.duplicate' }],
      }),
    /ambiguous/,
  );
  assert.equal(f.sources.rows().length, 0);
  assert.equal(f.providers.identities.list(f.bridgeId).length, 0);
  f.sources.import(f.bridgeId, ['physical'], f.registry);
  f.providers.live.get(f.bridgeId).inventory.cameras = [];
  const [camera] = f.sources.merge({ cameras: [], states: [] });
  assert.equal(camera.available, false);
});
test('migration rechecks the original camera registry identity rather than a merged alias or similar stream sensor', async (t) => {
  const f = await fixture(t);
  const camera = {
    id: 'registry-camera',
    entity_id: 'camera.outdoor',
    platform: 'generic',
    device_id: 'generic-device',
  };
  const registry = {
    ...f.registry,
    entities: [
      camera,
      { entity_id: 'camera.outdoor_internal', device_id: 'registered', platform: 'mqtt' },
    ],
    states: [
      { entity_id: 'camera.outdoor', state: 'idle', attributes: { friendly_name: 'Same name' } },
      {
        entity_id: 'camera.outdoor_internal',
        state: 'idle',
        attributes: { friendly_name: 'Same name internal' },
      },
    ],
  };
  assert.equal(
    f.sources.migrationIdentity(f.bridgeId, 'physical', registry)?.entity_id,
    'camera.outdoor_internal',
  );
  assert.notEqual(
    f.sources.migrationIdentity(f.bridgeId, 'physical', registry)?.id,
    camera.id,
    'A name-based presentation alias cannot authorize replacing a Generic entry',
  );
  registry.entities.pop();
  assert.equal(f.sources.migrationIdentity(f.bridgeId, 'physical', registry), undefined);
  camera.device_id = 'registered';
  assert.equal(f.sources.migrationIdentity(f.bridgeId, 'physical', registry).id, camera.id);
});
