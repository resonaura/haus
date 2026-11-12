/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { HubHomeKitPublishing } from './homekit-publishing';

it('routes valid HomeKit publication requests and rejects traversal or unsupported operations', async () => {
  const api = vi.fn(async () => ({ status: 'ok' }));
  const publishing = new HubHomeKitPublishing(api);

  // 1. Get bridge status
  await publishing.request({ method: 'GET', path: 'homekit/bridge' });

  // 2. Add device to bridge
  await publishing.request({
    method: 'POST',
    path: 'homekit/bridge/devices',
    data: { deviceId: 'light-1' },
  });

  // 3. Delete device from bridge
  await publishing.request({
    method: 'DELETE',
    path: 'homekit/bridge/devices/light-1',
  });

  // 4. Reset bridge pairing
  await publishing.request({
    method: 'POST',
    path: 'homekit/bridge/reset',
  });

  // 5. Select batch bridge devices
  await publishing.request({
    method: 'POST',
    path: 'homekit/bridge/select',
    data: { deviceIds: ['light-1', 'switch-2'] },
  });

  // 6. List accessories overview
  await publishing.request({
    method: 'GET',
    path: 'homekit/accessories',
  });

  // 7. Get device mapping & unsupported capability diagnostics
  await publishing.request({
    method: 'GET',
    path: 'homekit/devices/light-1/mapping',
  });

  // 8. Publish standalone camera
  await publishing.request({
    method: 'POST',
    path: 'homekit/standalone/camera-front',
    data: { port: 51830 },
  });

  // 9. Reset standalone pairing
  await publishing.request({
    method: 'POST',
    path: 'homekit/standalone/camera-front/reset',
  });

  // 10. Unpublish standalone camera
  await publishing.request({
    method: 'DELETE',
    path: 'homekit/standalone/camera-front',
  });

  expect(api.mock.calls).toEqual([
    ['/api/homekit/publication/bridge'],
    ['/api/homekit/publication/bridge/devices', { method: 'POST', body: { deviceId: 'light-1' } }],
    ['/api/homekit/publication/bridge/devices/light-1', { method: 'DELETE' }],
    ['/api/homekit/publication/bridge/reset', { method: 'POST', body: {} }],
    [
      '/api/homekit/publication/bridge/select',
      { method: 'POST', body: { deviceIds: ['light-1', 'switch-2'] } },
    ],
    ['/api/homekit/publication/accessories'],
    ['/api/homekit/publication/devices/light-1/mapping'],
    ['/api/homekit/publication/standalone/camera-front', { method: 'POST', body: { port: 51830 } }],
    ['/api/homekit/publication/standalone/camera-front/reset', { method: 'POST', body: {} }],
    ['/api/homekit/publication/standalone/camera-front', { method: 'DELETE' }],
  ]);

  api.mockClear();

  // Test that traversal attacks and unsupported operations throw errors
  for (const invalidRequest of [
    { method: 'GET', path: 'homekit/../secrets' },
    { method: 'GET', path: 'homekit/bridge/../../../etc/passwd' },
    { method: 'POST', path: 'homekit/bridge/devices', data: {} }, // missing deviceId
    { method: 'POST', path: 'homekit/bridge/select', data: { deviceIds: 'not-an-array' } },
    { method: 'GET', path: 'homekit/bridge', token: 'leak-token' },
    { method: 'PATCH', path: 'homekit/bridge' },
  ]) {
    await expect(publishing.request(invalidRequest)).rejects.toThrow();
  }
  expect(api).not.toHaveBeenCalled();
});
