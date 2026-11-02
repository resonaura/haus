/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, it, expect } from 'vitest';
import { bridgeSnapshotSource, fetchBridgeSnapshot } from '../src/snapshot';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';

const camera = { id: 'camera.garden', deviceIds: ['physical'] };
const capability = {
  haus_snapshot_profile: 1,
  haus_snapshot_provider: 'aqara',
  haus_snapshot_url: 'http://192.168.4.44:8580/api/cameras/garden/snapshot/last-live',
};
const registry = {
  entities: [{ entity_id: 'sensor.snapshot', device_id: 'physical', platform: 'mqtt' }],
  states: [{ entity_id: 'sensor.snapshot', state: 'unavailable', attributes: capability }],
};

describe('bridge cached frame handoff', () => {
  it('requires an explicit capability on the same physical camera, rejects Haus proxies and ambiguity', () => {
    expect(bridgeSnapshotSource(camera, registry)?.provider).toBe('aqara');
    expect(bridgeSnapshotSource({ ...camera, deviceIds: ['other'] }, registry)).toBeUndefined();
    expect(
      bridgeSnapshotSource(camera, {
        ...registry,
        entities: [{ ...registry.entities[0], platform: 'haus' }],
      }),
    ).toBeUndefined();
    expect(
      bridgeSnapshotSource(camera, {
        ...registry,
        states: [{ ...registry.states[0], attributes: { ...capability, haus_camera_proxy: 1 } }],
      }),
    ).toBeUndefined();
    expect(
      bridgeSnapshotSource(camera, {
        ...registry,
        states: [
          ...registry.states,
          {
            entity_id: 'sensor.conflict',
            state: 'on',
            attributes: {
              ...capability,
              haus_snapshot_url: capability.haus_snapshot_url.replace('garden', 'other'),
            },
          },
        ],
        entities: [...registry.entities, { entity_id: 'sensor.conflict', device_id: 'physical' }],
      }),
    ).toBeUndefined();
  });
  it('rejects public sources, camera_proxy and credentialed URLs before contacting them', async () => {
    for (const url of [
      'http://8.8.8.8/api/cameras/garden/snapshot/last-live',
      'http://127.0.0.1/api/cameras/garden/snapshot/last-live',
      'http://192.168.1.1/api/camera_proxy/camera.garden',
      'http://user:secret@192.168.1.1/api/cameras/garden/snapshot/last-live',
    ])
      await expect(fetchBridgeSnapshot({ version: 1, provider: 'aqara', url })).rejects.toThrow();
  });
  it('preserves capture time and rejects placeholders, redirects and forged provider metadata', async () => {
    const host = Object.values(networkInterfaces())
      .flat()
      .find((item) => item?.family === 'IPv4' && !item.internal)?.address;
    if (!host) throw Error('LAN fixture needs a private interface');
    let mode = 'real';
    const server = createServer((_req, res) => {
      const headers = {
        'content-type': 'image/jpeg',
        'x-haus-snapshot-profile': '1',
        'x-haus-snapshot-provider': mode === 'recursive' ? 'haus' : 'aqara',
        'x-haus-snapshot-captured-at': '10000',
      };
      if (mode === 'redirect') {
        res.writeHead(302, { location: 'http://8.8.8.8/' }).end();
        return;
      }
      if (mode === 'placeholder')
        delete (headers as Record<string, string>)['x-haus-snapshot-profile'];
      res.writeHead(200, headers).end(Buffer.from([255, 216, 1, 2, 255, 217]));
    });
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('No fixture');
      const source = {
        version: 1 as const,
        provider: 'aqara' as const,
        url: `http://${host}:${address.port}/api/cameras/garden/snapshot/last-live`,
      };
      expect(await fetchBridgeSnapshot(source, { now: () => 20000 })).toMatchObject({
        at: 10000,
        stale: false,
      });
      expect(await fetchBridgeSnapshot(source, { now: () => 45000 })).toMatchObject({
        at: 10000,
        stale: true,
      });
      for (mode of ['recursive', 'placeholder', 'redirect'])
        await expect(fetchBridgeSnapshot(source)).rejects.toThrow();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
