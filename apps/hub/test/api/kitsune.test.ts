/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { test, onTestFinished } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTestRecordingStore, queryOne } from '../support/recording.js';
import { HaCatalog, Transactions } from '@haus/hub/storage';
import { HaCameras } from '@haus/ha/node/ha-cameras';
import { nvrCameraSource, CameraAvailability } from '@haus/hub/camera';
import { NativeEntities } from '@haus/ha/node/native-entities';

test('plugin sources retain their identity, remain independent of HA and become native HA views', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-kitsune-ha-'));
  const store = await openTestRecordingStore(join(directory, 'test.sqlite'), directory);
  const catalog = new HaCatalog(new Transactions(store.source));
  await catalog.initialize();
  await catalog.enroll({
    id: 'fixture-client',
    tokenHash: 'fixture',
    createdAt: 0,
    nativeEntities: true,
  });
  const camera = {
    id: 'camera.kitsune_fixture',
    name: 'Front',
    available: true,
    independentSource: true,
    kitsuneProvider: { pluginId: '@fixture/camera', deviceId: 'kitsune:fixture' },
    kitsuneSource: { kind: 'rtsp' as const, url: 'rtsp://192.168.1.2/main' },
  };
  const ha = new HaCameras({
    catalog,
    registry: () => ({ cameras: [camera] }),
    snapshots: { snapshot: async () => ({}) },
    sessions: {
      viewer: async () => ({}),
      viewerCandidate: async () => ({}),
      ensure: async () => ({}),
      closeViewer: async () => ({}),
      release: async () => ({}),
    },
  });
  onTestFinished(async () => {
    await ha.stop();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const view = ha.cameras()[0]!;
  const nativeMeta = view.native as { primary: boolean; physicalId: string; bridgeId: string };
  assert.equal(nativeMeta.primary, true);
  assert.equal(nativeMeta.physicalId, 'kitsune:fixture');
  assert.ok(!JSON.stringify(view).includes('rtsp://'));
  assert.deepEqual(nvrCameraSource(camera, { states: [], entities: [] }), camera.kitsuneSource);
  new CameraAvailability().apply([camera], [], new Map());
  assert.equal(camera.available, true);
  const native = new NativeEntities({
    catalog,
    sources: { rows: () => [] },
    providers: {
      releaseNative: async () => ({}),
      list: () => [],
      confirm: async () => ({}),
      command: async () => ({}),
      refresh: async () => ({}),
      inventory: () => {
        throw Error('plugin must not use native bridge enrollment');
      },
    },
    registry: () => ({ cameras: [camera] }),
    activity: { status: () => ({ active: true, available: true, replaces: [] }) },
  });
  const device = native.devices()[0]!;
  assert.equal(device.bridgeId, nativeMeta.bridgeId);
  assert.equal(device.entities[0]!.id, 'haus_activity');
  assert.equal(device.entities[0]!.state, true);
  assert.deepEqual(
    await native.acknowledge('fixture-client', {
      cameras: [{ cameraId: camera.id, entities: ['haus_activity'] }],
    }),
    { ready: true },
  );
  assert.equal(
    (await queryOne(store, 'SELECT COUNT(*) AS total FROM native_ha_owner'))?.total,
    0,
  );
});
