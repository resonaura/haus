/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import { AppCatalog } from '@haus/apps';
import { HubApps } from '../apps.js';
import { appIntegrationTranslations } from '../app-flows.js';
import { HubIntegrationFlowManager, buildHubConfigEntries } from '../flows.js';

describe('Desktop Hub Govee App & Integration Flows', () => {
  it('installs, reconfigures, reloads, and removes govee via integration flows', async () => {
    const catalog = AppCatalog.createDefaultCatalog();
    const installed: Array<Record<string, unknown>> = [];
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];

    const api = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
      const method = init?.method ?? 'GET';
      calls.push({ path, method, body: init?.body });
      if (path === '/api/apps/catalog/govee') {
        return { entry: catalog.get('govee') };
      }
      if (path === '/api/apps') {
        return { apps: installed, drivers: [] };
      }
      if (path === '/api/apps/install' && method === 'POST') {
        installed.push({
          id: 'app-id-1',
          name: 'Govee',
          state: 'running',
          source: { instanceId: 'standalone', externalId: 'govee' },
        });
        return { status: 'ok' };
      }
      return { status: 'ok' };
    });
    const refreshDevices = vi.fn(async () => {});
    const manager = new HubIntegrationFlowManager(api, refreshDevices);

    const startStep = (await manager.handleManagement({
      method: 'POST',
      path: 'config/config_entries/flow',
      data: { handler: 'govee' },
    })) as Record<string, unknown>;

    expect(startStep.type).toBe('form');
    expect(startStep.handler).toBe('govee');
    expect(startStep.step_id).toBe('user');
    const schema = startStep.data_schema as Array<{ name: string }>;
    expect(schema.map((field) => field.name)).toEqual([
      'username',
      'password',
      'code',
      'apiKey',
      'hybridSplit',
      'bleDisable',
      'awsDisable',
      'lanDisable',
    ]);
    expect(calls.some((call) => call.path.includes('/commissioning/flows'))).toBe(false);

    const flowId = String(startStep.flow_id);
    expect(
      await manager.handleManagement({
        method: 'GET',
        path: `config/config_entries/flow/${flowId}`,
      }),
    ).toEqual(startStep);

    const created = (await manager.handleManagement({
      method: 'POST',
      path: `config/config_entries/flow/${flowId}`,
      data: {
        username: 'user@example.com',
        password: 'secret-value',
        hybridSplit: true,
        bleDisable: false,
        extraIgnored: 'drop-me',
      },
    })) as Record<string, unknown>;

    expect(created.type).toBe('create_entry');
    expect(created.handler).toBe('govee');
    expect(created.result).toEqual({ entry_id: 'app:govee', title: 'Govee' });
    const installCall = calls.find((call) => call.path === '/api/apps/install');
    expect(installCall).toBeDefined();
    expect((installCall?.body as Record<string, unknown> | undefined)?.config).toEqual({
      username: 'user@example.com',
      password: 'secret-value',
      hybridSplit: true,
      bleDisable: false,
    });
    expect(refreshDevices).toHaveBeenCalledTimes(1);

    const entries = buildHubConfigEntries([], [], { apps: installed });
    expect(entries).toContainEqual({
      entry_id: 'app:govee',
      domain: 'govee',
      title: 'Govee',
      state: 'loaded',
      disabled_by: null,
      supports_options: true,
      supports_reconfigure: true,
      supports_unload: true,
    });

    const optionsStep = (await manager.handleManagement({
      method: 'POST',
      path: 'config/config_entries/options/flow',
      data: { handler: 'app:govee' },
    })) as Record<string, unknown>;
    expect(optionsStep.type).toBe('form');
    const optionsResult = (await manager.handleManagement({
      method: 'POST',
      path: `config/config_entries/options/flow/${String(optionsStep.flow_id)}`,
      data: { bleDisable: true, hybridSplit: false },
    })) as Record<string, unknown>;
    expect(optionsResult.type).toBe('create_entry');
    expect(calls).toContainEqual({
      path: '/api/apps/govee/operate',
      method: 'POST',
      body: { operation: 'configure', options: { bleDisable: true, hybridSplit: false } },
    });

    await manager.handleManagement({
      method: 'POST',
      path: 'config/config_entries/entry/app%3Agovee/reload',
    });
    expect(calls).toContainEqual({
      path: '/api/apps/govee/execute',
      method: 'POST',
      body: { action: 'restart' },
    });

    await manager.handleManagement({
      method: 'DELETE',
      path: 'config/config_entries/entry/app%3Agovee',
    });
    expect(calls).toContainEqual({
      path: '/api/apps/govee/operate',
      method: 'POST',
      body: { operation: 'remove' },
    });
  });

  it('validates HubApps install, configure, remove routes while keeping raw remove blocked', async () => {
    const api = vi.fn(async () => ({ ok: true }));
    const apps = new HubApps(api);

    await apps.request({
      method: 'POST',
      path: 'apps/install',
      data: {
        manifest: { id: 'govee', name: 'Govee' },
        grantedPermissions: [],
        config: { hybridSplit: true },
      },
    });
    expect(api).toHaveBeenCalledWith('/api/apps/install', {
      method: 'POST',
      body: {
        manifest: { id: 'govee', name: 'Govee' },
        grantedPermissions: [],
        config: { hybridSplit: true },
      },
    });

    await apps.request({
      method: 'GET',
      path: 'apps/govee/install-progress',
    });
    expect(api).toHaveBeenCalledWith('/api/apps/govee/install-progress');

    await apps.request({
      method: 'POST',
      path: 'apps/govee/configure',
      data: { options: { bleDisable: false } },
    });
    expect(api).toHaveBeenCalledWith('/api/apps/govee/operate', {
      method: 'POST',
      body: { operation: 'configure', options: { bleDisable: false } },
    });

    await apps.request({
      method: 'POST',
      path: 'apps/govee/remove',
      data: {},
    });
    expect(api).toHaveBeenCalledWith('/api/apps/govee/operate', {
      method: 'POST',
      body: { operation: 'remove' },
    });

    await expect(
      apps.request({
        method: 'POST',
        path: 'apps/app-1/operate',
        data: { operation: 'remove' },
      }),
    ).rejects.toThrow('Unsupported App operation.');

    await expect(
      apps.request({
        method: 'POST',
        path: 'apps/govee/configure',
        data: { url: 'http://evil', options: {} },
      }),
    ).rejects.toThrow('Unsupported App operation.');

    await expect(
      apps.request({
        method: 'POST',
        path: 'apps/govee/remove',
        data: { force: true },
      }),
    ).rejects.toThrow('Unsupported App operation.');
  });

  it('provides desktop titles and form field translations for govee apps', () => {
    const titles = appIntegrationTranslations('title') as {
      component: Record<string, { title: string }>;
    };
    expect(titles.component.govee?.title).toBe('Govee');
    expect(titles.component['homebridge-govee']?.title).toBe('Homebridge Govee');

    const config = appIntegrationTranslations('config', 'govee') as {
      component: Record<
        string,
        Record<string, { step: { user: { data: Record<string, string> } } }>
      >;
    };
    expect(config.component.govee?.config?.step.user.data.hybridSplit).toBeDefined();
    expect(config.component.govee?.config?.step.user.data.bleDisable).toBeDefined();
  });
});
