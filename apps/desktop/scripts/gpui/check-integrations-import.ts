/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement, type ReactElement } from 'react';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { defaults } from '@haus/ha/view/preferences';
import { createTestRoot, hasNativeTestRenderer, type TestRenderer } from '@gpuix/react/testing';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { pct } from '@haus/ui/ir';
import { Box, HausUiProvider } from '@haus/ui/primitives';
import { requireGpuiBun } from '../../src/gpui/bun.js';
import { homeDashboard } from '../../src/gpui/home/model.js';
import {
  GpuiIntegrationsView,
  type GpuiRpcRequest,
} from '../../src/gpui/management/integrations.js';

requireGpuiBun();
assert(
  hasNativeTestRenderer,
  'GPUIX native test renderer is required for check-integrations-import',
);

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

async function flushMicrotasks(renderer: TestRenderer, turns = 8): Promise<void> {
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

async function checkDemoHaDataImport(): Promise<void> {
  const snapshot = createDemoSnapshot();
  const home = homeDashboard(snapshot, defaults);
  let onSavedCount = 0;

  await withRoot(
    createElement(GpuiIntegrationsView, {
      snapshot,
      home,
      demo: true,
      onSaved: () => {
        onSavedCount += 1;
      },
    }),
    async (renderer) => {
      click(renderer, 'integrations-import-ha');
      await flushMicrotasks(renderer);
      assert(renderer.findByTestId('ha-data-import-submit'), 'HA data import modal should open');

      click(renderer, 'ha-data-import-load-sample');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().some((text) => text.includes('2 entries ready')),
        'Demo sample must show 2 entries ready',
      );

      click(renderer, 'ha-data-import-submit');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().some((text) => text.includes('Staged')),
        'Demo stage must announce Staged',
      );
      assert.equal(onSavedCount, 1);

      click(renderer, 'ha-data-import-close');
      await flushMicrotasks(renderer);
      assert(!renderer.findByTestId('ha-data-import-close'), 'Close button must dismiss modal');
    },
  );
}

async function checkLiveRpcPartialFailureAndRetry(): Promise<void> {
  const base = createDemoSnapshot();
  const snapshot = {
    ...base,
    user: { name: 'Alex', is_admin: true },
  };
  const home = homeDashboard(snapshot, defaults);
  const importedCalls: Record<string, unknown>[] = [];
  let failOnSecond = true;
  let onSavedCount = 0;

  const requestRpc: GpuiRpcRequest = async <T>(message: Record<string, unknown>): Promise<T> => {
    switch (message.type) {
      case 'config_entries/get':
        return [] as T;
      case 'haus/integration_meta':
      case 'manifest/list':
      case 'config_entries/flow/progress':
        return [] as T;
      case 'repairs/list_issues':
        return { issues: [] } as T;
      case 'haus/updates/list':
        return null as T;
      case 'ha/config_entries/import': {
        importedCalls.push(message);
        if (failOnSecond && importedCalls.length === 2) {
          throw new Error('integration_entity_conflict');
        }
        return { ok: true } as T;
      }
      default:
        return {} as T;
    }
  };

  const invalidJson = JSON.stringify({
    entries: [
      {
        entry: {
          entryId: 'e1',
          domain: 'hue',
          title: 'Hue',
          data: {},
          disabledBy: null,
        },
      },
    ],
  });

  const validJson = JSON.stringify({
    entries: [
      {
        entry: {
          entryId: 'hue_1',
          domain: 'hue',
          title: 'Hue Bridge',
          data: { host: '192.168.1.40' },
          disabledBy: 'user',
        },
        devices: [{ id: 'd1' }],
        entities: [{ entity_id: 'light.a' }],
      },
      {
        entry: {
          entryId: 'mqtt_1',
          domain: 'mqtt',
          title: 'MQTT Broker',
          data: { host: '192.168.1.2' },
          disabledBy: 'user',
        },
        devices: [{ id: 'd2' }],
        entities: [{ entity_id: 'lock.door' }],
      },
    ],
  });

  await withRoot(
    createElement(GpuiIntegrationsView, {
      snapshot,
      home,
      demo: false,
      requestRpc,
      onSaved: () => {
        onSavedCount += 1;
      },
    }),
    async (renderer) => {
      await flushMicrotasks(renderer);
      click(renderer, 'integrations-import-ha');
      await flushMicrotasks(renderer);

      setInputValue(renderer, 'ha-data-import-json-input', invalidJson);
      click(renderer, 'ha-data-import-parse-json');
      await flushMicrotasks(renderer);
      assert(renderer.findByTestId('ha-data-import-error'), 'Invalid JSON must display error');
      assert(
        renderer
          .getAllText()
          .some((text) =>
            text.includes('This file is not a supported, disabled Home Assistant transfer bundle.'),
          ),
        'Must surface exact validation failure text',
      );

      setInputValue(renderer, 'ha-data-import-json-input', validJson);
      click(renderer, 'ha-data-import-parse-json');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().some((text) => text.includes('2 entries ready')),
        'Valid bundle must preview 2 entries',
      );

      click(renderer, 'ha-data-import-submit');
      await flushMicrotasks(renderer);
      const partialTexts = renderer.getAllText();
      assert(
        partialTexts.some((text) => text.includes('One or more entity IDs are already owned')),
        'Must display friendly conflict message on entity conflict',
      );
      assert(
        partialTexts.some((text) => text.includes('Stopped after 1 of 2')),
        'Progress label must record partial progress',
      );
      assert.equal(importedCalls.length, 2);
      assert.equal(onSavedCount, 1);

      failOnSecond = false;
      importedCalls.length = 0;
      setInputValue(renderer, 'ha-data-import-json-input', validJson);
      click(renderer, 'ha-data-import-parse-json');
      await flushMicrotasks(renderer);
      click(renderer, 'ha-data-import-submit');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().some((text) => text.includes('Staged')),
        'Retry after clearing conflict must complete staging cleanly',
      );
      assert.equal(importedCalls.length, 2);
      assert.equal(onSavedCount, 2);
    },
  );
}

async function checkNativeFilePickerFlow(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'haus-ha-data-'));
  const filePath = join(dir, 'ha-entries.json');
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        entries: [
          {
            entry: {
              entryId: 'sonos_1',
              domain: 'sonos',
              title: 'Living Room Sonos',
              data: {},
              disabledBy: 'user',
            },
            devices: [{ id: 's1' }],
            entities: [{ entity_id: 'media_player.living_room' }],
          },
        ],
      }),
      'utf8',
    );
    const snapshot = createDemoSnapshot();
    const home = homeDashboard(snapshot, defaults);
    await withRoot(
      createElement(GpuiIntegrationsView, {
        snapshot,
        home,
        demo: true,
        openPaths: async () => [filePath],
      }),
      async (renderer) => {
        click(renderer, 'integrations-import-ha');
        await flushMicrotasks(renderer);

        click(renderer, 'ha-data-import-choose-file');
        await flushMicrotasks(renderer);

        const texts = renderer.getAllText();
        assert(
          texts.some((text) => text.includes('ha-entries.json')),
          'Native picker must display selected file basename',
        );
        assert(
          texts.some((text) => text.includes('Living Room Sonos')),
          'Native picker must parse and display imported integration entry',
        );
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await checkDemoHaDataImport();
await checkLiveRpcPartialFailureAndRetry();
await checkNativeFilePickerFlow();
console.log('GPUIX Integrations HA Data Import check passed.');
