/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import type { HausDevice, HausEndpoint } from '@haus/core';
import type { CameraMigrationEvidence } from '../../../src/providers/migration/types.js';
import { CameraIdentityMigration } from '../../../src/providers/migration/store.js';
import { StandaloneHomeEntryEntity } from '../../../src/storage/standalone/entities.js';
import { IdentityEntity, AliasEntity } from '../../../src/storage/entities/identity.js';
import { openCatalog, Transactions } from '../../../src/storage/index.js';

export const physicalId = 'camera-one';
export const rawId = 'camera.one';
export const canonical = 'mqtt_camera-one';
export const shadow = 'mqtt_camera-one-shadow';
export const cameraId = 'camera.original';
export const videoId = 'ep_mqtt_camera-one-camera';
export const switchId = 'ep_mqtt_camera-one-status';
export const shadowVideo = `${videoId}-shadow`;
export const shadowSwitch = `${switchId}-shadow`;
export const motionId = 'ep_mqtt_motion-shadow';
export const virtualVideo = 'ep_camera.original';
export const synthetic = 'ep_mqtt_motion_camera';

function endpoint(id: string, kind: 'video' | 'on_off' | 'motion', alias?: string): HausEndpoint {
  return {
    id,
    name: id,
    category: kind === 'video' ? 'cameras' : 'power',
    readings: {},
    capabilities: [
      {
        id: kind,
        kind: kind === 'video' ? 'complex' : 'binary',
        readable: true,
        operations: kind === 'on_off' ? ['set', 'turn_on', 'turn_off'] : [],
      },
    ],
    ...(alias
      ? {
          sourceRefs: [
            {
              protocol: 'mqtt',
              externalId: alias,
              domain: kind === 'video' ? 'camera' : kind === 'on_off' ? 'switch' : 'binary_sensor',
            },
          ],
        }
      : {}),
  };
}

export async function migrationFixture(database = ':memory:') {
  const source = await openCatalog(database);
  const transactions = new Transactions(source);
  const device: HausDevice = {
    id: canonical,
    name: 'Original custom name',
    roomId: 'workshop',
    category: 'cameras',
    source: { instanceId: 'haus-mqtt', externalId: physicalId },
    connectivity: { protocol: 'mqtt' },
    availability: 'online',
    sourceRefs: [{ protocol: 'mqtt', externalId: physicalId }],
    metadata: { custom: 'preserved' },
    endpoints: [
      endpoint(videoId, 'video'),
      {
        ...endpoint(switchId, 'on_off'),
        address: 'switch::workshop:camera-one:status',
        roomId: 'workshop',
      },
      endpoint(synthetic, 'video'),
    ],
  };
  const exact: HausDevice = {
    ...device,
    id: shadow,
    name: 'Provider label',
    metadata: undefined,
    source: { instanceId: 'haus-mqtt', externalId: rawId },
    sourceRefs: [{ protocol: 'mqtt', externalId: rawId }],
    endpoints: [
      endpoint(shadowVideo, 'video', 'camera-one-camera'),
      endpoint(shadowSwitch, 'on_off', 'camera-one-status'),
      endpoint(motionId, 'motion', 'motion'),
    ],
  };
  const stub: HausDevice = {
    ...device,
    id: cameraId,
    metadata: undefined,
    source: { instanceId: 'haus-cameras', externalId: cameraId },
    sourceRefs: [{ protocol: 'virtual', externalId: cameraId }],
    endpoints: [endpoint(virtualVideo, 'video')],
  };
  const evidence: CameraMigrationEvidence = {
    homeId: 'home-default',
    move: { fromHost: '192.168.1.10', toHost: '192.168.1.20' },
    assignments: [
      { cameraId, source: { kind: 'p2p-restream', url: 'rtsp://192.168.1.10:8555/live/one' } },
    ],
    inventory: {
      version: 2,
      bridgeId: randomUUID(),
      provider: 'aqara',
      cameras: [
        {
          id: physicalId,
          identifiers: [rawId],
          name: 'Provider label',
          manufacturer: 'Aqara',
          model: 'E1',
          available: true,
          mqtt: { uniqueId: 'camera-one-camera' },
          stream: { transport: 'p2p', url: 'rtsp://192.168.1.20:8555/live/one' },
          snapshotPath: '/api/cameras/one/snapshot/last-live',
          entities: [
            {
              id: 'status',
              domain: 'switch',
              name: 'Status',
              available: true,
              state: false,
              writable: true,
              updatedAt: 1,
              mqtt: { uniqueId: 'camera-one-status' },
            },
            {
              id: 'motion',
              domain: 'binary_sensor',
              name: 'Motion',
              available: true,
              state: false,
              updatedAt: 1,
              mqtt: { uniqueId: 'motion' },
              role: 'motion',
            },
          ],
        },
      ],
    },
  };
  await transactions.run(async (manager) => {
    const put = async (kind: string, entryId: string, value: unknown) =>
      manager.save(StandaloneHomeEntryEntity, {
        kind,
        entryId,
        value: JSON.stringify(value),
        updatedAt: 1,
      });
    for (const value of [device, exact, stub]) await put('device', value.id, value);
    await put('endpoint_state', switchId, { on_off: false, custom: 'preserved' });
    await put('endpoint_state', shadowSwitch, { on_off: true });
    await put('endpoint_state', virtualVideo, { fill: false, muted: true });
    await put('scene', 'scene', {
      members: [{ endpointId: switchId, targetState: { on_off: true } }],
    });
    const bindings = [
      { id: shadow, kind: 'device' as const, external: rawId },
      ...[
        [shadowVideo, 'camera', 'camera-one-camera'],
        [shadowSwitch, 'switch', 'camera-one-status'],
        [motionId, 'binary_sensor', 'motion'],
      ].map(([id, domain, alias]) => ({
        id: id ?? '',
        kind: 'endpoint' as const,
        external: JSON.stringify([rawId, domain, alias]),
      })),
    ];
    for (const value of bindings) {
      const row = { ...value, home: evidence.homeId, source: 'haus-mqtt' };
      await manager.save(IdentityEntity, row);
      await manager.save(AliasEntity, {
        home: row.home,
        kind: row.kind,
        source: row.source,
        external: row.external,
        identityId: row.id,
      });
    }
  });
  return {
    source,
    transactions,
    evidence,
    migration: new CameraIdentityMigration(transactions),
    async close() {
      await transactions.drain();
      if (source.isInitialized) await source.destroy();
    },
  };
}
