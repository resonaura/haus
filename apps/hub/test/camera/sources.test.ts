/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { CameraCatalog, openCatalog, Transactions } from '@haus/hub/storage';
import { NativeProviders } from '../../src/providers/index.js';
import {
  CameraAvailability,
  NativeCameraSources,
  nvrCameraSource,
  type NativeCameraRegistry,
  type NativePhysicalCamera,
} from '../../src/camera/index.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'haus-native-camera-sources-'));
  const source = await openCatalog(join(root, 'catalog.sqlite'));
  const transactions = new Transactions(source);
  const cameraCatalog = new CameraCatalog(transactions);
  await cameraCatalog.initialize();
  let at = 100000;
  const bridgeId = randomUUID();
  const physical: NativePhysicalCamera & {
    talkback?: { transport?: string; codec?: string; url: string };
  } = {
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
    provider: 'aqara' as const,
    clientId: randomUUID(),
    token: 'a'.repeat(64),
    endpoint: {
      url: 'http://192.168.1.20:8580',
      address: '192.168.1.20',
      family: 4 as const,
      allowHttp: true,
    },
  };
  let ready = 0;
  const providers = new NativeProviders({
    catalog: cameraCatalog,
    now: () => at,
    endpoint: async () => connection.endpoint,
    enroll: async () => ({
      connection,
      inventory: async () => ({
        bridgeId,
        provider: 'aqara',
        cameras: [structuredClone(physical)],
      }),
      revoke: async () => ({}),
    }),
    client: () => ({
      connection,
      ready: async () => {
        ready++;
      },
      inventory: async () => ({
        bridgeId,
        provider: 'aqara',
        cameras: [structuredClone(physical)],
      }),
      revoke: async () => ({}),
    }),
  });
  await providers.add({ url: connection.endpoint.url, code: 'c'.repeat(48), allowHttp: true });
  const sources = new NativeCameraSources({
    providers,
    catalog: cameraCatalog,
    resolveSource: () => {
      throw Error('missing');
    },
  });
  const registry: NativeCameraRegistry = {
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
    source,
    physical,
    providers,
    sources,
    registry,
    bridgeId,
    advance: () => {
      at += 31000;
    },
    ready: () => ready,
    cleanup: async () => {
      await source.destroy();
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe('NativeCameraSources', () => {
  it('native import retains exact recording identity and settings after HA sources disappear, without acknowledging MQTT retirement', async () => {
    const f = await fixture();
    try {
      await f.source.query(
        "INSERT INTO events(id, camera_id, start_at, end_at, status, kinds, detections) VALUES('original','camera.outdoor',1,2,'ready','[]','[]')",
      );
      const before = JSON.stringify(
        await f.source.query('SELECT id, camera_id, status FROM events'),
      );
      await assert.rejects(
        f.providers.validate({
          provider: 'aqara',
          cameras: [{ ...f.physical, stream: { ...f.physical.stream, transport: 'native-rtsp' } }],
        }),
        /protected_p2p/,
      );
      const settings = {
        'camera.outdoor': {
          enabled: true,
          motionDetection: { enabled: true, mode: 'objects' },
        },
      };
      await f.sources.import(f.bridgeId, ['physical'], f.registry);
      assert.equal(f.ready(), 0);
      const generic = { ...f.registry.cameras[0], deviceId: 'generic-view' };
      const physicalView = f.sources.merge(
        {
          ...f.registry,
          cameras: [generic],
          devices: [
            ...(f.registry.devices ?? []),
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
      assert.ok(combined[0].aliases?.includes('camera.old_mqtt'));
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
      assert.equal(camera.sensors?.[0].active, true);
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
        f.sources.merge({ cameras: [], states: [] }, { 'camera.outdoor': { sensorIds: [] } })[0]
          .sensors?.length,
        0,
        'Explicit detector opt-outs survive a native import',
      );
      assert.equal(
        f.sources.snapshot(camera)?.url,
        'http://192.168.1.20:8580/api/cameras/one/snapshot/last-live',
      );
      f.advance();
      assert.equal(f.sources.merge({ cameras: [], states: [] }, settings)[0].available, false);
      assert.equal(
        JSON.stringify(await f.source.query('SELECT id, camera_id, status FROM events')),
        before,
      );
      assert.deepEqual(settings['camera.outdoor'], {
        enabled: true,
        motionDetection: { enabled: true, mode: 'objects' },
      });
    } finally {
      await f.cleanup();
    }
  });

  it('matching names/rooms never confer identity, ambiguity rolls back and missing native cameras stay offline', async () => {
    const f = await fixture();
    try {
      const noIdentity = { ...f.registry, devices: [] };
      assert.equal(f.sources.preview(f.bridgeId, noIdentity)[0].existingCameraId, undefined);
      await assert.rejects(
        f.sources.import(f.bridgeId, ['physical'], {
          ...f.registry,
          cameras: [...f.registry.cameras, { ...f.registry.cameras[0], id: 'camera.duplicate' }],
        }),
        /ambiguous/,
      );
      assert.equal(f.sources.rows().length, 0);
      assert.equal(f.providers.identities.list(f.bridgeId).length, 0);
      await f.sources.import(f.bridgeId, ['physical'], f.registry);
      const liveEntry = f.providers.live.get(f.bridgeId);
      if (liveEntry) liveEntry.inventory.cameras = [];
      const [camera] = f.sources.merge({ cameras: [], states: [] });
      assert.equal(camera.available, false);
    } finally {
      await f.cleanup();
    }
  });

  it('migration rechecks the original camera registry identity rather than a merged alias or similar stream sensor', async () => {
    const f = await fixture();
    try {
      const camera: {
        id: string;
        entity_id: string;
        platform: string;
        device_id: string;
      } = {
        id: 'registry-camera',
        entity_id: 'camera.outdoor',
        platform: 'generic',
        device_id: 'generic-device',
      };
      const entities: {
        id?: string;
        entity_id: string;
        platform: string;
        device_id: string;
      }[] = [
        camera,
        { entity_id: 'camera.outdoor_internal', device_id: 'registered', platform: 'mqtt' },
      ];
      const registry: NativeCameraRegistry = {
        ...f.registry,
        entities,
        states: [
          {
            entity_id: 'camera.outdoor',
            state: 'idle',
            attributes: { friendly_name: 'Same name' },
          },
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
        (f.sources.migrationIdentity(f.bridgeId, 'physical', registry) as { id?: string } | undefined)
          ?.id,
        camera.id,
        'A name-based presentation alias cannot authorize replacing a Generic entry',
      );
      entities.pop();
      assert.equal(f.sources.migrationIdentity(f.bridgeId, 'physical', registry), undefined);
      camera.device_id = 'registered';
      assert.equal(
        (f.sources.migrationIdentity(f.bridgeId, 'physical', registry) as { id?: string } | undefined)
          ?.id,
        camera.id,
      );
    } finally {
      await f.cleanup();
    }
  });
});
