/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import { AppCatalog } from '@haus/apps';
import { isAppConfigEntryId, isAppFlowDomain } from '../app-flows.js';
import { HubApps } from '../apps.js';
import { HubIntegrationFlowManager } from '../flows.js';

describe('Hub catalog App config entries & lifecycle flows', () => {
  it('recognizes all catalog app-only domains and installed app: entry ids', async () => {
    expect(isAppFlowDomain('aqara-cameras')).toBe(true);
    expect(isAppFlowDomain('tuya-rtsp-bridge')).toBe(true);
    expect(isAppFlowDomain('homebridge-appletv-enhanced')).toBe(true);
    expect(isAppFlowDomain('govee2mqtt')).toBe(true);
    expect(isAppFlowDomain('matter-server')).toBe(true);
    expect(isAppConfigEntryId('app:aqara-cameras')).toBe(true);
    expect(isAppConfigEntryId('app:custom-app')).toBe(true);
    expect(isAppConfigEntryId('app:')).toBe(false);

    const catalog = AppCatalog.createDefaultCatalog();
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];
    const manager = new HubIntegrationFlowManager(
      async (path, init) => {
        const method = init?.method ?? 'GET';
        calls.push({ path, method, body: init?.body });
        if (path === '/api/apps/catalog/aqara-cameras') {
          return { entry: catalog.get('aqara-cameras') };
        }
        if (path === '/api/apps') {
          return {
            apps: [
              { id: 'u1', name: 'Aqara Camera Bridge', source: { externalId: 'aqara-cameras' } },
            ],
            drivers: [],
          };
        }
        return { status: 'ok' };
      },
      vi.fn(async () => {}),
    );

    const step = (await manager.handleManagement({
      method: 'POST',
      path: 'config/config_entries/options/flow',
      data: { entry_id: 'app:aqara-cameras' },
    })) as Record<string, unknown>;
    expect(step.type).toBe('form');
    expect(step.handler).toBe('aqara-cameras');

    await manager.handleManagement({
      method: 'POST',
      path: 'config/config_entries/entry/app:aqara-cameras/reload',
      data: {},
    });
    expect(calls).toContainEqual({
      path: '/api/apps/aqara-cameras/execute',
      method: 'POST',
      body: { action: 'restart' },
    });

    await manager.handleManagement({
      method: 'DELETE',
      path: 'config/config_entries/entry/app:aqara-cameras',
    });
    expect(calls).toContainEqual({
      path: '/api/apps/aqara-cameras/operate',
      method: 'POST',
      body: { operation: 'remove' },
    });
  });

  it('forwards configure and remove calls through HubApps without exposing a generic proxy', async () => {
    const api = vi.fn(async () => ({ status: 'ok' }));
    const hubApps = new HubApps(api);
    await hubApps.request({
      method: 'POST',
      path: 'apps/u1/configure',
      data: { options: { lanDisable: true } },
    });
    await hubApps.request({
      method: 'POST',
      path: 'apps/u1/remove',
      data: {},
    });
    await hubApps.request({
      method: 'GET',
      path: 'apps/aqara-cameras/install-progress',
    });
    expect(api.mock.calls).toEqual([
      [
        '/api/apps/u1/operate',
        { method: 'POST', body: { operation: 'configure', options: { lanDisable: true } } },
      ],
      ['/api/apps/u1/operate', { method: 'POST', body: { operation: 'remove' } }],
      ['/api/apps/aqara-cameras/install-progress'],
    ]);
  });
});
