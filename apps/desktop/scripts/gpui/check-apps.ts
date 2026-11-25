/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import type { ManagementPort } from '@haus/core/transport';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { createTestRoot, hasNativeTestRenderer, type TestRenderer } from '@gpuix/react/testing';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { pct } from '@haus/ui/ir';
import { Box, HausUiProvider } from '@haus/ui/primitives';
import { requireGpuiBun } from '../../src/gpui/bun.js';
import { GpuiAppsView } from '../../src/gpui/management/apps.js';

requireGpuiBun();
assert(hasNativeTestRenderer, 'GPUIX native test renderer is required for check-apps');

function click(renderer: TestRenderer, id: string): void {
  const element = renderer.findByTestId(id);
  assert(element, `Missing testId="${id}"`);
  let bounds = renderer.getElementBounds(element.id);
  if (bounds && (bounds.y < 0 || bounds.y + bounds.height > 780)) {
    const scrollX = bounds.x + Math.max(24, bounds.width / 2);
    renderer.nativeSimulateScrollWheel(scrollX, 400, 0, -(bounds.y - 360));
    renderer.dispatchNativeEvents();
    renderer.flush();
    bounds = renderer.getElementBounds(element.id);
  }
  assert(bounds && bounds.width > 0 && bounds.height > 0, `Missing bounds for "${id}"`);
  renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0);
  renderer.dispatchNativeEvents();
  renderer.flush();
}

function setInputValue(renderer: TestRenderer, id: string, value: string): void {
  const element = renderer.findByTestId(id);
  assert(element, `Missing input testId="${id}"`);
  renderer.writeToClipboard(value);
  renderer.nativeSimulateKeystrokes(element.id, 'cmd-a backspace cmd-v');
  renderer.dispatchNativeEvents();
  renderer.flush();
}

async function flushMicrotasks(renderer: TestRenderer, turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    renderer.dispatchNativeEvents();
    renderer.flush();
  }
}

function withRoot(
  element: ReactElement,
  fn: (renderer: TestRenderer) => void | Promise<void>,
): Promise<void> {
  const { renderer, render, unmount } = createTestRoot({ width: 1080, height: 820 });
  render(
    createElement(HausUiProvider, {
      contentHost: GPUIX_CONTENT_HOST,
      mode: 'dark',
      children: createElement(Box, {
        style: { layout: { width: pct(100), height: pct(100), overflowY: 'scroll' } },
        children: element,
      }),
    }),
  );
  renderer.flush();
  return Promise.resolve(fn(renderer)).finally(() => unmount());
}

function demoRepoHash(owner: string, repoName: string, branch = ''): string {
  const seed = `${owner}/${repoName}/${branch}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function checkDemoAppsLifecycle(): Promise<void> {
  const snapshot = createDemoSnapshot();

  await withRoot(createElement(GpuiAppsView, { snapshot, demo: true }), async (renderer) => {
    click(renderer, 'apps-open-repositories');
    await flushMicrotasks(renderer);
    assert(
      renderer.getAllText().some((text) => text.includes('Haus Community Add-ons')),
      'Demo custom add-on repository should render',
    );

    setInputValue(renderer, 'app-repos-url-input', 'https://evil.example.com/addons');
    click(renderer, 'app-repos-add');
    await flushMicrotasks(renderer);
    assert(
      renderer.getAllText().some((text) => text.includes('Enter a valid GitHub repository')),
      'Non-GitHub add-on repo URL should show validation error',
    );

    const addedUrl = 'https://github.com/haus-home/custom-addons#main';
    const addedId = demoRepoHash('haus-home', 'custom-addons', 'main');
    setInputValue(renderer, 'app-repos-url-input', addedUrl);
    click(renderer, 'app-repos-add');
    await flushMicrotasks(renderer);
    assert(
      renderer.findByTestId(`app-repo-row-${addedId}`),
      'Added custom add-on repository row must appear',
    );

    click(renderer, `app-repo-remove-${addedId}`);
    await flushMicrotasks(renderer);
    assert(
      !renderer.findByTestId(`app-repo-row-${addedId}`),
      'Removed custom add-on repository row must disappear',
    );

    click(renderer, 'app-repos-done');
    await flushMicrotasks(renderer);

    click(renderer, 'app-manage-zigbee2mqtt');
    await flushMicrotasks(renderer);
    click(renderer, 'app-detail-tab-config');
    await flushMicrotasks(renderer);
    assert(
      renderer.findByTestId('app-config-field-permit_join'),
      'Boolean switch config field should render',
    );

    click(renderer, 'app-config-field-permit_join');
    await flushMicrotasks(renderer);

    click(renderer, 'app-config-mode-json');
    await flushMicrotasks(renderer);
    assert(
      renderer.findByTestId('app-config-json-textarea'),
      'JSON editor textarea should render in JSON mode',
    );

    click(renderer, 'app-config-mode-fields');
    await flushMicrotasks(renderer);
    click(renderer, 'app-config-save');
    await flushMicrotasks(renderer);
    assert(
      renderer.getAllText().some((text) => text.includes('Configuration saved')),
      'Saved status message should render after saving App config',
    );

    // Re-open config via JSON tab to confirm the secret placeholder stays redacted while permit_join toggled.
    click(renderer, 'app-config-mode-json');
    await flushMicrotasks(renderer);
    click(renderer, 'app-config-mode-fields');
    await flushMicrotasks(renderer);
    assert(
      renderer.getAllText().some((text) => text.includes('Configured')),
      'Configured secret indicator should remain intact after save',
    );

    click(renderer, 'app-detail-tab-logs');
    await flushMicrotasks(renderer);
    assert(
      renderer.getAllText().some((text) => text.includes('Coordinator ready')),
      'Demo logs should appear on Logs tab',
    );

    click(renderer, 'app-detail-tab-overview');
    await flushMicrotasks(renderer);
    click(renderer, 'app-detail-remove');
    await flushMicrotasks(renderer);
    click(renderer, 'app-detail-remove-confirm');
    await flushMicrotasks(renderer);

    assert(!renderer.findByTestId('app-detail-done'), 'App details modal must close after removal');
    assert(
      !renderer.findByTestId('app-card-zigbee2mqtt'),
      'Removed demo app must disappear from installed list',
    );
  });
}

async function checkLiveManagementPortContracts(): Promise<void> {
  const snapshot = createDemoSnapshot();
  const calls: Array<{ method: string; path: string; data?: unknown }> = [];
  const repositories: Array<{
    id: string;
    url: string;
    branch?: string;
    name: string;
    maintainer?: string;
    addonIds: string[];
    updatedAt: string;
  }> = [
    {
      id: 'c1d2e3f4',
      url: 'https://github.com/example/addons#main',
      branch: 'main',
      name: 'Example Repo',
      maintainer: 'Example',
      addonIds: [],
      updatedAt: '2026-11-24T00:00:00.000Z',
    },
  ];
  let savedConfig: Record<string, unknown> = {
    channel: 20,
    permit_join: false,
    mqtt_password: '<unchanged>',
  };

  const management: ManagementPort = {
    management: async <T>(input: {
      method: 'GET' | 'POST';
      path: string;
      data?: Record<string, unknown>;
    }): Promise<T> => {
      calls.push({ method: input.method, path: input.path, data: input.data });
      if (input.method === 'GET' && input.path === 'apps') {
        return {
          drivers: [{ id: 'standalone', capabilities: { logs: true } }],
          apps: [
            {
              id: 'zigbee2mqtt',
              name: 'Zigbee2MQTT',
              version: '2.1.3',
              state: 'running',
              available: true,
              managed: true,
              actions: ['stop', 'restart'],
              source: { instanceId: 'standalone', externalId: 'zigbee2mqtt' },
            },
          ],
        } as T;
      }
      if (input.method === 'GET' && input.path === 'apps/catalog') {
        return {
          entries: [
            {
              id: 'matter-bridge',
              name: 'Matter Controller',
              category: 'matter',
              runtimeType: 'docker_app',
              installed: false,
              latestVersion: '1.5.0',
              updateAvailable: false,
              verified: true,
            },
          ],
        } as T;
      }
      if (input.method === 'GET' && input.path === 'apps/catalog/zigbee2mqtt') {
        return {
          entry: {
            manifest: {
              id: 'zigbee2mqtt',
              options: [{ name: 'channel', description: 'Zigbee radio channel' }],
              secrets: [{ name: 'mqtt_password', description: 'Broker password' }],
            },
          },
        } as T;
      }
      if (input.method === 'GET' && input.path === 'apps/catalog/matter-bridge') {
        return {
          entry: {
            manifest: {
              id: 'matter-bridge',
              name: 'Matter Controller',
              network: { mode: 'host' },
              devices: [{ type: 'usb' }],
            },
          },
        } as T;
      }
      if (input.method === 'POST' && input.path === 'apps/install') {
        return { status: 'ok', id: 'matter-bridge' } as T;
      }
      if (input.method === 'GET' && input.path === 'apps/repositories') {
        return { repositories } as T;
      }
      if (input.method === 'POST' && input.path === 'apps/repositories') {
        repositories.push({
          id: 'abcd1234',
          url: String(input.data?.url ?? ''),
          name: 'Added Repo',
          addonIds: [],
          updatedAt: '2026-11-24T00:00:00.000Z',
        });
        return { repository: repositories[repositories.length - 1] } as T;
      }
      if (input.method === 'POST' && input.path === 'apps/repositories/reload') {
        return { repositories } as T;
      }
      if (input.method === 'POST' && input.path === 'apps/zigbee2mqtt/operate') {
        if (input.data?.operation === 'info') {
          return {
            status: 'ok',
            data: { config: savedConfig, configuredSecrets: ['mqtt_password'] },
          } as T;
        }
        if (input.data?.operation === 'logs') {
          return { status: 'ok', data: { logs: '[hub] zigbee2mqtt stream ok' } } as T;
        }
      }
      if (input.method === 'POST' && input.path === 'apps/zigbee2mqtt/configure') {
        savedConfig = (input.data?.options as Record<string, unknown>) ?? savedConfig;
        return { status: 'ok' } as T;
      }
      if (input.method === 'POST' && input.path === 'apps/zigbee2mqtt/execute') {
        return { status: 'ok' } as T;
      }
      throw new Error(`Unexpected management call: ${input.method} ${input.path}`);
    },
  };

  await withRoot(
    createElement(GpuiAppsView, { snapshot, sessionKind: 'haus-hub', management }),
    async (renderer) => {
      await flushMicrotasks(renderer, 6);
      assert(renderer.findByTestId('app-card-zigbee2mqtt'), 'Hub installed app must load');

      click(renderer, 'apps-open-repositories');
      await flushMicrotasks(renderer, 6);
      setInputValue(renderer, 'app-repos-url-input', 'https://github.com/haus-home/live-addons');
      click(renderer, 'app-repos-add');
      await flushMicrotasks(renderer, 6);
      click(renderer, 'app-repos-reload-all');
      await flushMicrotasks(renderer, 6);
      click(renderer, 'app-repos-done');
      await flushMicrotasks(renderer, 6);

      click(renderer, 'app-manage-zigbee2mqtt');
      await flushMicrotasks(renderer, 6);
      click(renderer, 'app-detail-tab-config');
      await flushMicrotasks(renderer, 6);
      click(renderer, 'app-config-save-restart');
      await flushMicrotasks(renderer, 8);
      click(renderer, 'app-detail-tab-logs');
      await flushMicrotasks(renderer, 6);
      assert(
        renderer.getAllText().some((text) => text.includes('[hub] zigbee2mqtt stream ok')),
        'Live operate/logs output must render in Logs tab',
      );
      click(renderer, 'app-detail-done');
      await flushMicrotasks(renderer, 6);

      click(renderer, 'apps-tab-catalog');
      await flushMicrotasks(renderer, 6);
      click(renderer, 'catalog-install-matter-bridge');
      await flushMicrotasks(renderer, 6);

      assert(
        calls.some((c) => c.method === 'GET' && c.path === 'apps/repositories'),
        'Must fetch custom repositories',
      );
      assert(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.path === 'apps/repositories' &&
            (c.data as { url?: string })?.url === 'https://github.com/haus-home/live-addons',
        ),
        'Must POST new custom repository URL',
      );
      assert(
        calls.some((c) => c.method === 'POST' && c.path === 'apps/repositories/reload'),
        'Must POST repositories reload',
      );
      assert(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.path === 'apps/zigbee2mqtt/operate' &&
            (c.data as { operation?: string })?.operation === 'info',
        ),
        'Must load native config via operate/info',
      );
      assert(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.path === 'apps/zigbee2mqtt/configure' &&
            (c.data as { replace?: boolean })?.replace === true,
        ),
        'Must save config in replace mode',
      );
      assert(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.path === 'apps/zigbee2mqtt/execute' &&
            (c.data as { action?: string })?.action === 'restart',
        ),
        'Must restart running app via execute endpoint',
      );
      assert(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.path === 'apps/zigbee2mqtt/operate' &&
            (c.data as { operation?: string })?.operation === 'logs',
        ),
        'Must fetch logs via operate/logs endpoint',
      );
      assert(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.path === 'apps/install' &&
            Array.isArray((c.data as { grantedPermissions?: unknown })?.grantedPermissions) &&
            (c.data as { grantedPermissions: string[] }).grantedPermissions.includes(
              'network:host',
            ),
        ),
        'Must install catalog app with resolved manifest and permissions',
      );
    },
  );
}

await checkDemoAppsLifecycle();
await checkLiveManagementPortContracts();
console.log(
  'check-apps: custom add-on repositories, native app config editor, removal, and HubApps routes passed',
);
process.exit(0);
