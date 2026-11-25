/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement, type ReactElement } from 'react';
import type { ManagementPort, ManagementRequest } from '@haus/core/transport';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { defaults } from '@haus/ha/view/preferences';
import { createTestRoot, hasNativeTestRenderer, type TestRenderer } from '@gpuix/react/testing';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { pct } from '@haus/ui/ir';
import { Box, HausUiProvider, Text } from '@haus/ui/primitives';
import { requireGpuiBun } from '../../src/gpui/bun.js';
import { homeDashboard } from '../../src/gpui/home/model.js';
import { GpuiScenesView } from '../../src/gpui/management/scenes.js';

requireGpuiBun();
assert(hasNativeTestRenderer, 'GPUIX native test renderer is required for check-scenes');

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

async function checkDemoScenesSampleImport(): Promise<void> {
  const snapshot = createDemoSnapshot();
  const home = homeDashboard(snapshot, defaults);
  const scenes = home.sceneGroups.flatMap((g) => g.items);
  let onSavedCount = 0;

  await withRoot(
    createElement(GpuiScenesView, {
      snapshot,
      scenes,
      home,
      demo: true,
      renderScenes: (items) =>
        createElement(Text, undefined, items.map((s) => s.entity_id).join(',')),
      onApplyScene: () => undefined,
      onSaved: () => {
        onSavedCount += 1;
      },
    }),
    async (renderer) => {
      click(renderer, 'scenes-import-ha');
      await flushMicrotasks(renderer);
      assert(renderer.findByTestId('ha-scenes-import-submit'), 'Scenes import modal should open');

      click(renderer, 'ha-scenes-import-load-sample');
      await flushMicrotasks(renderer);
      const previewTexts = renderer.getAllText();
      assert(
        previewTexts.some((text) => text.includes('2 scenes ready')),
        'Sample bundle preview should show 2 scenes ready',
      );
      assert(
        previewTexts.some((text) => text.includes('Already in Haus, will skip')),
        'Existing Willow House movie_time scene should display skip notice',
      );

      click(renderer, 'ha-scenes-import-submit');
      await flushMicrotasks(renderer);
      const afterTexts = renderer.getAllText();
      assert(
        afterTexts.some((text) => text.includes('Saved')),
        'Demo scene import should display Saved completion status',
      );
      assert.equal(onSavedCount, 1);

      click(renderer, 'ha-scenes-import-close');
      await flushMicrotasks(renderer);
      assert(!renderer.findByTestId('ha-scenes-import-close'), 'Close button must dismiss modal');
    },
  );
}

async function checkLiveHubScenesImportAndErrors(): Promise<void> {
  const base = createDemoSnapshot();
  const snapshot = {
    ...base,
    config: { ...base.config, version: 'haus-hub' },
    user: { name: 'Alex', is_admin: true },
  };
  const home = homeDashboard(snapshot, defaults);
  const requests: ManagementRequest[] = [];
  let onSavedCalls = 0;

  const management: ManagementPort = {
    async management<T = unknown>(input: ManagementRequest): Promise<T> {
      requests.push(input);
      if (input.method === 'GET' && input.path === 'haus/rules/scenes') {
        return {
          scenes: [
            { id: 'edited_scene', name: 'Edited Scene', roomId: 'living_room' },
            {
              id: 'restore_scene',
              name: 'Restore Scene',
              metadata: {
                haEntityId: 'scene.restore_scene',
                haEntities: { 'switch.reading_nook': 'on' },
              },
            },
          ],
        } as T;
      }
      return { ok: true } as T;
    },
  };

  const unknownRoomJson = JSON.stringify({
    scenes: [
      {
        id: 'attic_light',
        name: 'Attic Light',
        haEntityId: 'scene.attic_light',
        areaName: 'Attic',
        entities: { 'light.attic': 'on' },
      },
    ],
  });

  const validJson = JSON.stringify({
    scenes: [
      {
        id: 'brand_new_scene',
        name: 'Brand New Scene',
        haEntityId: 'scene.brand_new_scene',
        areaName: 'Living Room',
        entities: { 'light.living_room_pendant': { state: 'on', brightness: 210 } },
      },
      {
        id: 'edited_scene',
        name: 'Edited Scene',
        haEntityId: 'scene.edited_scene',
        areaName: 'Living Room',
        entities: { 'light.corner_lamp': 'on' },
      },
      {
        id: 'restore_scene',
        name: 'Restore Scene',
        haEntityId: 'scene.restore_scene',
        areaName: 'Living Room',
        entities: { 'switch.reading_nook': 'on' },
      },
    ],
  });

  await withRoot(
    createElement(GpuiScenesView, {
      snapshot,
      scenes: [],
      home,
      demo: false,
      management,
      renderScenes: (items) =>
        createElement(Text, undefined, items.map((s) => s.entity_id).join(',')),
      onApplyScene: () => undefined,
      onSaved: () => {
        onSavedCalls += 1;
      },
    }),
    async (renderer) => {
      click(renderer, 'scenes-import-ha');
      await flushMicrotasks(renderer);

      setInputValue(renderer, 'ha-scenes-import-json-input', '{"bad":true}');
      click(renderer, 'ha-scenes-import-parse-json');
      await flushMicrotasks(renderer);
      assert(renderer.findByTestId('ha-scenes-import-error'), 'Invalid JSON must render error');

      setInputValue(renderer, 'ha-scenes-import-json-input', unknownRoomJson);
      click(renderer, 'ha-scenes-import-parse-json');
      await flushMicrotasks(renderer);
      click(renderer, 'ha-scenes-import-submit');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().some((text) => text.includes('Haus has no room matching “Attic”')),
        'Unknown room error should reject import before any POST',
      );
      assert.equal(requests.filter((r) => r.method === 'POST').length, 0);

      setInputValue(renderer, 'ha-scenes-import-json-input', validJson);
      click(renderer, 'ha-scenes-import-parse-json');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().some((text) => text.includes('3 scenes ready')),
        'Parsed bundle must preview 3 scenes',
      );

      click(renderer, 'ha-scenes-import-submit');
      await flushMicrotasks(renderer);

      const texts = renderer.getAllText();
      assert(
        texts.some((text) => text.includes('Already in Haus, will skip')),
        'Existing scene should report skipped',
      );
      assert(
        texts.some((text) => text.includes('Restore room')),
        'Matching unplaced scene should report Restore room',
      );
      assert(
        texts.some((text) => text.includes('Saved')),
        'Import should announce Saved',
      );
      assert.equal(onSavedCalls, 1);

      const posts = requests.filter((req) => req.method === 'POST');
      assert.deepEqual(
        posts.map((p) => p.path),
        ['config/scene/config/brand_new_scene', 'config/scene/config/restore_scene'],
      );
      assert.equal(JSON.stringify(posts[0]?.data).includes('"room_id":"living_room"'), true);
      assert.equal(JSON.stringify(posts[1]?.data).includes('"room_id":"living_room"'), true);
    },
  );
}

async function checkNativeFilePickerFlow(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'haus-ha-scenes-'));
  const filePath = join(dir, 'ha-scenes.json');
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        scenes: [
          {
            id: 'garden_glow',
            name: 'Garden glow',
            haEntityId: 'scene.garden_glow',
            entities: { 'light.garden': { state: 'on', brightness: 190 } },
          },
        ],
      }),
      'utf8',
    );
    const snapshot = createDemoSnapshot();
    const home = homeDashboard(snapshot, defaults);
    await withRoot(
      createElement(GpuiScenesView, {
        snapshot,
        scenes: [],
        home,
        demo: true,
        openPaths: async () => [filePath],
        renderScenes: () => createElement(Text, undefined, ''),
        onApplyScene: () => undefined,
      }),
      async (renderer) => {
        click(renderer, 'scenes-import-ha');
        await flushMicrotasks(renderer);

        click(renderer, 'ha-scenes-import-choose-file');
        await flushMicrotasks(renderer);

        const texts = renderer.getAllText();
        assert(
          texts.some((text) => text.includes('ha-scenes.json')),
          'Native file picker must display selected scene file basename',
        );
        assert(
          texts.some((text) => text.includes('Garden glow · 1 devices')),
          'Native file picker must parse and display imported scene entry',
        );
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await checkDemoScenesSampleImport();
await checkLiveHubScenesImportAndErrors();
await checkNativeFilePickerFlow();
console.log('GPUIX Scenes HA Transfer & Import integration check passed.');
