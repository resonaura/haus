/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { discoverProviderBridges } from '../../src/providers/discovery.js';

describe('discoverProviderBridges', () => {
  it('discovers native add-ons and standalone LAN apps without forwarding HA credentials', async () => {
    const addonId = randomUUID();
    const lanId = randomUUID();
    const seen: unknown[] = [];
    const found = await discoverProviderBridges(
      { token: 'never-to-the-camera' },
      {
        duration: 10,
        scan: ({ onFound }) => {
          onFound({ bridgeId: lanId, provider: 'tuya', url: 'http://192.168.1.20:6766' });
          return () => {};
        },
        fetchRequest: async (url, options) => {
          expect(url.startsWith('http://supervisor/')).toBe(true);
          expect(options.headers.Authorization).toBe('Bearer never-to-the-camera');
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
    expect(found.length).toBe(2);
    expect(found.every((item) => item.paired === false)).toBe(true);
    expect(JSON.stringify(seen).includes('never-to-the-camera')).toBe(false);
  });

  it('ignores a conflicting advertised provider and cannot enroll or suppress MQTT during discovery', async () => {
    const id = randomUUID();
    const paths: string[] = [];
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
    expect(found).toEqual([]);
    expect(paths).toEqual(['/api/haus/v2/info']);
  });
});
