/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeSnapshotDiscovery, matchBridgeSnapshot } from '../lib/camera/bridge.mjs';

const manifest = {
  version: 1,
  provider: 'tuya',
  cameras: [
    {
      stream: { protocol: 'rtsp:', port: 8655, path: '/live/side' },
      snapshotPath: '/api/cameras/camera-id/snapshot/last-live',
    },
  ],
};
const camera = { id: 'camera.side', deviceId: 'physical' };
const registry = {
  entities: [{ entity_id: 'sensor.side_rtsp_stream', device_id: 'physical' }],
  states: [{ entity_id: 'sensor.side_rtsp_stream', state: 'rtsp://192.168.4.44:8655/live/side' }],
};
test('matches Generic source by exact protocol/port/path and verified host, never its name', () => {
  const match = matchBridgeSnapshot(
    manifest,
    'http://192.168.4.44:6766',
    registry.states[0].state,
    ['192.168.4.44'],
  );
  assert.equal(match.provider, 'tuya');
  assert.equal(
    matchBridgeSnapshot(manifest, 'http://192.168.4.99:6766', registry.states[0].state, [
      '192.168.4.44',
    ]),
    undefined,
  );
  assert.equal(
    matchBridgeSnapshot(
      manifest,
      'http://192.168.4.44:6766',
      'rtsp://192.168.4.44:8656/live/side',
      ['192.168.4.44'],
    ),
    undefined,
  );
  assert.equal(
    matchBridgeSnapshot(
      {
        ...manifest,
        cameras: [
          ...manifest.cameras,
          { ...manifest.cameras[0], snapshotPath: '/api/cameras/different/snapshot/last-live' },
        ],
      },
      'http://192.168.4.44:6766',
      registry.states[0].state,
      ['192.168.4.44'],
    ),
    undefined,
  );
});
test('Supervisor discovery handles host networking and never forwards HA authorization to bridges', async () => {
  let requests = 0;
  const discover = bridgeSnapshotDiscovery({ token: 'private-fixture' }, () => registry, {
    fetchRequest: async (url, options) => {
      requests++;
      if (url.startsWith('http://supervisor'))
        assert.equal(options.headers.Authorization, 'Bearer private-fixture');
      else assert.equal(options.headers, undefined);
      if (url.endsWith('/supervisor/info'))
        return Response.json({
          data: { addons: [{ slug: 'fixture_tuya-rtsp-bridge', state: 'started' }] },
        });
      if (url.endsWith('/network/info'))
        return Response.json({
          data: { interfaces: [{ ipv4: { address: ['192.168.4.44/22'] } }] },
        });
      if (url.endsWith('/addons/fixture_tuya-rtsp-bridge/info'))
        return Response.json({
          data: { ip_address: '172.30.32.1', host_network: true, options: { api_port: 6766 } },
        });
      assert.equal(url, 'http://172.30.32.1:6766/api/haus/cameras');
      return Response.json(manifest);
    },
  });
  const [a, b] = await Promise.all([discover(camera), discover(camera)]);
  assert.deepEqual(a, b);
  assert.equal(a.url, 'http://172.30.32.1:6766/api/cameras/camera-id/snapshot/last-live');
  assert.equal(requests, 4);
  await discover(camera);
  assert.equal(requests, 4);
});
