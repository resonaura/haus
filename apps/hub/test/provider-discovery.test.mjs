/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { discoverProviderBridges } from '../lib/provider-discovery.mjs';
test('new Haus install discovers native add-ons and standalone LAN apps without forwarding HA credentials', async () => {
  const addonId = randomUUID(),
    lanId = randomUUID(),
    seen = [];
  const found = await discoverProviderBridges(
    { token: 'never-to-the-camera' },
    {
      duration: 10,
      scan: ({ onFound }) => {
        onFound({ bridgeId: lanId, provider: 'tuya', url: 'http://192.168.1.20:6766' });
        return () => {};
      },
      fetchRequest: async (url, options) => {
        assert.ok(url.startsWith('http://supervisor/'));
        assert.equal(options.headers.Authorization, 'Bearer never-to-the-camera');
        return {
          ok: true,
          json: async () => ({
            data: url.endsWith('/supervisor/info')
              ? { addons: [{ slug: 'abc_aqara-g5pro-mqtt', state: 'started' }] }
              : { ip_address: '172.30.33.1', options: {} },
          }),
        };
      },
      endpoint: async (url) => ({ url }),
      request: async (target, path, options) => {
        seen.push({ target, path, options });
        return {
          version: 2,
          bridgeId: target.url.includes('172.30.') ? addonId : lanId,
          provider: target.url.includes('172.30.') ? 'aqara' : 'tuya',
          name: 'Camera bridge',
        };
      },
    },
  );
  assert.equal(found.length, 2);
  assert.equal(
    found.every((item) => item.paired === false),
    true,
  );
  assert.equal(JSON.stringify(seen).includes('never-to-the-camera'), false);
});
test('a conflicting advertised provider is ignored and discovery cannot enroll or suppress MQTT', async () => {
  const id = randomUUID(),
    paths = [];
  const found = await discoverProviderBridges(
    { standalone: true },
    {
      duration: 10,
      scan: ({ onFound }) => {
        onFound({ bridgeId: id, provider: 'aqara', url: 'http://192.168.1.20:6766' });
        return () => {};
      },
      endpoint: async (url) => ({ url }),
      request: async (_target, path) => {
        paths.push(path);
        return { version: 2, bridgeId: id, provider: 'tuya', name: 'Wrong provider' };
      },
    },
  );
  assert.deepEqual(found, []);
  assert.deepEqual(paths, ['/api/haus/v2/info']);
});
