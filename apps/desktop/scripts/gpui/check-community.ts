/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import type { ManagementPort } from '@haus/core/transport';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { defaults } from '@haus/ha/view/preferences';
import { createTestRoot, hasNativeTestRenderer, type TestRenderer } from '@gpuix/react/testing';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { pct } from '@haus/ui/ir';
import { Box, HausUiProvider } from '@haus/ui/primitives';
import { requireGpuiBun } from '../../src/gpui/bun.js';
import { homeDashboard } from '../../src/gpui/home/model.js';
import { SettingsView } from '../../src/gpui/home/settings-view.js';
import type { GpuiAddDeviceRequest } from '../../src/gpui/management/add-device.js';
import { GpuiHacsView } from '../../src/gpui/management/hacs.js';
import { GpuiIntegrationsView } from '../../src/gpui/management/integrations.js';

requireGpuiBun();
assert(hasNativeTestRenderer, 'GPUIX native test renderer is required for check-community');

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

async function flushMicrotasks(renderer: TestRenderer, turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
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

async function checkDemoHacsCommunityFlow(): Promise<void> {
  const snapshot = createDemoSnapshot();
  const home = homeDashboard(snapshot, defaults);
  const flowRequests: GpuiAddDeviceRequest[] = [];

  await withRoot(
    createElement(GpuiIntegrationsView, {
      snapshot,
      home,
      demo: true,
      onAddDevice: (request) => {
        if (request) flowRequests.push(request);
      },
    }),
    async (renderer) => {
      assert(
        renderer.findByTestId('integrations-open-hacs'),
        'Community entry button should exist',
      );
      click(renderer, 'integrations-open-hacs');
      assert(renderer.getAllText().includes('Community'));
      assert(renderer.getAllText().includes('Adaptive Lighting'));
      assert(renderer.getAllText().includes('LocalTuya'));
      assert(renderer.getAllText().includes('legacy-community/deprecated-bridge'));

      click(renderer, 'hacs-scope-updates');
      assert(renderer.getAllText().includes('Adaptive Lighting'));
      assert(!renderer.getAllText().includes('LocalTuya'));

      click(renderer, 'hacs-scope-browse');
      assert(renderer.getAllText().includes('Frigate NVR'));

      click(renderer, 'hacs-scope-removed');
      assert(renderer.getAllText().includes('retired-author/old-sensor-pack'));

      click(renderer, 'hacs-scope-installed');
      click(renderer, 'hacs-add-source');
      assert(renderer.findByTestId('hacs-add-repo-url'), 'Add custom HACS dialog must open');

      setInputValue(renderer, 'hacs-add-repo-url', 'https://evil.example.com/o/r');
      click(renderer, 'hacs-add-repo-submit');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().some((text) => text.includes('Enter a GitHub repository')),
        'Untrusted non-GitHub HACS URL must show validation error',
      );

      setInputValue(renderer, 'hacs-add-repo-url', 'https://github.com/haus-test/demo-climate.git');
      click(renderer, 'hacs-add-repo-submit');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().includes('demo-climate'),
        'Custom repository details should open',
      );
      assert(renderer.getAllText().includes('haus-test/demo-climate'));

      click(renderer, 'hacs-beta-toggle');
      await flushMicrotasks(renderer);
      click(renderer, 'hacs-download-btn');
      assert(
        renderer.findByTestId('hacs-confirm-submit'),
        'Download confirmation modal should open',
      );
      click(renderer, 'hacs-confirm-submit');
      await flushMicrotasks(renderer);

      assert(
        renderer.findByTestId('hacs-remove-download'),
        'Installed custom repo shows Remove download',
      );
      assert(
        renderer.findByTestId('hacs-setup-integration'),
        'Config-flow repo shows Set up integration',
      );
      click(renderer, 'hacs-setup-integration');
      assert.deepEqual(flowRequests, [{ mode: 'flow', target: { domain: 'demo_climate' } }]);
    },
  );
}

async function checkLiveHacsRpcContracts(): Promise<void> {
  const calls: Array<Record<string, unknown>> = [];
  const flowRequests: GpuiAddDeviceRequest[] = [];

  const requestRpc = async <T = unknown>(message: Record<string, unknown>): Promise<T> => {
    calls.push(message);
    switch (message.type) {
      case 'hacs/info':
        return {
          categories: ['integration', 'plugin', 'theme'],
          version: '2.0.5',
          stage: 'running',
          disabled_reason: null,
          has_pending_tasks: false,
        } as T;
      case 'hacs/repositories/list':
        return [
          {
            id: 'live-1',
            name: 'Live Sensor',
            full_name: 'haus/live-sensor',
            category: 'integration',
            domain: 'live_sensor',
            installed: true,
            installed_version: 'v1.0.0',
            available_version: 'v1.1.0',
            pending_upgrade: true,
            config_flow: true,
            can_download: true,
          },
        ] as T;
      case 'hacs/critical/list':
        return [
          {
            repository: 'haus/critical-demo',
            reason: 'Action needed on upstream token.',
            acknowledged: false,
          },
        ] as T;
      case 'hacs/repositories/removed':
        return [] as T;
      default:
        return {} as T;
    }
  };

  await withRoot(
    createElement(GpuiHacsView, {
      demo: false,
      requestRpc,
      onAddDevice: (request) => {
        if (request) flowRequests.push(request);
      },
      onBack: () => {},
    }),
    async (renderer) => {
      await flushMicrotasks(renderer, 6);
      assert(calls.some((c) => c.type === 'hacs/info'));
      assert(calls.some((c) => c.type === 'hacs/repositories/list'));
      assert(calls.some((c) => c.type === 'hacs/critical/list'));
      assert(calls.some((c) => c.type === 'hacs/repositories/removed'));
      assert(renderer.getAllText().includes('Live Sensor'));
      assert(renderer.getAllText().includes('haus/critical-demo'));

      click(renderer, 'hacs-critical-ack-0');
      assert(renderer.findByTestId('hacs-confirm-submit'), 'Critical warning confirm should open');
      click(renderer, 'hacs-confirm-submit');
      await flushMicrotasks(renderer, 6);
      assert(
        calls.some(
          (c) => c.type === 'hacs/critical/acknowledge' && c.repository === 'haus/critical-demo',
        ),
        'Live HACS critical acknowledge must dispatch hacs/critical/acknowledge RPC',
      );

      click(renderer, 'hacs-update-live-1');
      await flushMicrotasks(renderer, 6);
      assert(
        calls.some((c) => c.type === 'hacs/repository/download' && c.repository === 'live-1'),
        'Live HACS update button must dispatch hacs/repository/download RPC',
      );
    },
  );
}

async function checkDemoAppleHomeBridgeSuggestions(): Promise<void> {
  await withRoot(
    createElement(SettingsView, {
      demo: true,
      homeName: 'Willow House',
      preferences: defaults,
      onTheme: () => {},
      onGrouping: () => {},
    }),
    (renderer) => {
      assert(renderer.getAllText().includes('Apple Home'));
      assert(renderer.getAllText().includes('Suggested bridges'));
      assert(renderer.getAllText().includes('Lighting · 3 accessories'));
      assert(!renderer.getAllText().includes('Floor Lamp'));
      click(renderer, 'apple-home-bridge-0');
      assert(renderer.getAllText().includes('Floor Lamp'));
      assert(renderer.getAllText().includes('Hall Pendant'));
      assert(renderer.getAllText().includes('Counter Strip'));
    },
  );
}

async function checkLiveAppleHomeBridgeSuggestionsRetry(): Promise<void> {
  let attempt = 0;
  const managementCalls: Array<{ method: string; path: string }> = [];
  const management: ManagementPort = {
    async management<T = unknown>(input: { method: 'GET' | 'POST' | 'DELETE'; path: string }) {
      managementCalls.push({ method: input.method, path: input.path });
      attempt += 1;
      if (attempt === 1) throw new Error('hub_offline');
      return {
        suggestions: [
          {
            name: 'Studio Bridge',
            devices: [{ id: 'dev-1', name: 'Desk Lamp' }],
          },
        ],
      } as T;
    },
  };

  await withRoot(
    createElement(SettingsView, {
      demo: false,
      homeName: 'Live House',
      preferences: defaults,
      sessionKind: 'haus-hub',
      sessionMeta: {
        hasSession: true,
        url: 'http://hub.local:3000',
        kind: 'haus-hub',
        statusText: 'Connected',
        syncStatus: 'synced',
      },
      management,
      onTheme: () => {},
      onGrouping: () => {},
    }),
    async (renderer) => {
      await flushMicrotasks(renderer, 6);
      assert(renderer.getAllText().includes('Couldn’t load bridge suggestions.'));
      click(renderer, 'apple-home-bridges-retry');
      await flushMicrotasks(renderer, 6);
      assert(renderer.getAllText().includes('Studio Bridge · 1 accessories'));
      click(renderer, 'apple-home-bridge-0');
      assert(renderer.getAllText().includes('Desk Lamp'));
      assert.equal(managementCalls.length, 2);
      assert.deepEqual(managementCalls[0], { method: 'GET', path: 'homekit/bridge/suggestions' });
    },
  );
}

await checkDemoHacsCommunityFlow();
await checkLiveHacsRpcContracts();
await checkDemoAppleHomeBridgeSuggestions();
await checkLiveAppleHomeBridgeSuggestionsRetry();
console.log('check-community: HACS Community Extensions + Apple Home Bridge Suggestions passed');
