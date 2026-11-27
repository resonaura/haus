/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement, type ReactElement } from 'react';
import type { ManagementPort, ManagementRequest } from '@haus/core/transport';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { createTestRoot, hasNativeTestRenderer, type TestRenderer } from '@gpuix/react/testing';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { pct } from '@haus/ui/ir';
import { Box, HausUiProvider } from '@haus/ui/primitives';
import { requireGpuiBun } from '../../src/gpui/bun.js';
import { GpuiAutomationsView } from '../../src/gpui/management/automations.js';

requireGpuiBun();
assert(hasNativeTestRenderer, 'GPUIX native test renderer is required for check-automations');

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

async function checkDemoSampleImport(): Promise<void> {
  const snapshot = createDemoSnapshot();
  let savedCount = 0;

  await withRoot(
    createElement(GpuiAutomationsView, {
      snapshot,
      automations: [],
      demo: true,
      disabled: false,
      onControl: () => undefined,
      onSaved: () => {
        savedCount += 1;
      },
    }),
    async (renderer) => {
      click(renderer, 'automations-import-ha');
      await flushMicrotasks(renderer);
      assert(renderer.findByTestId('ha-import-submit'), 'Import modal should open in demo mode');

      click(renderer, 'ha-import-load-sample');
      await flushMicrotasks(renderer);
      const previewTexts = renderer.getAllText();
      assert(
        previewTexts.some((text) => text.includes('2 rules · 0 saved on Haus')),
        'Sample transfer bundle preview should list 2 ready rules',
      );

      click(renderer, 'ha-import-submit');
      await flushMicrotasks(renderer);
      const afterTexts = renderer.getAllText();
      assert(
        afterTexts.some((text) => text.includes('Import finished')),
        'Demo import should reach finished state',
      );
      assert(
        afterTexts.some((text) => text.includes('Saved disabled in demo preview')),
        'Demo import should show saved status reason',
      );
      assert.equal(savedCount, 1);

      click(renderer, 'ha-import-close');
      await flushMicrotasks(renderer);
      assert(!renderer.findByTestId('ha-import-close'), 'Close button must dismiss modal');
    },
  );
}

async function checkLiveHubImportAndValidation(): Promise<void> {
  const baseSnapshot = createDemoSnapshot();
  const snapshot = {
    ...baseSnapshot,
    config: { ...baseSnapshot.config, version: 'haus-hub' },
    user: { name: 'Alex', is_admin: true },
  };
  const requests: ManagementRequest[] = [];
  let onSavedCalls = 0;

  const management: ManagementPort = {
    async management<T = unknown>(input: ManagementRequest): Promise<T> {
      requests.push(input);
      if (input.method === 'GET' && input.path === 'haus/rules/scripts') {
        return { scripts: [] } as T;
      }
      if (input.method === 'GET' && input.path === 'haus/rules/automations') {
        return {
          automations: [
            {
              id: 'already_imported',
              metadata: { migration: { sourceEntityId: 'automation.already_imported' } },
            },
            {
              id: 'conflict_id',
              metadata: { migration: { sourceEntityId: 'automation.other_rule' } },
            },
          ],
        } as T;
      }
      if (input.method === 'GET' && input.path === 'haus/rules/entities') {
        return {
          entities: [
            {
              entityId: 'light.haus_lamp',
              deviceId: 'dev_1',
              domain: 'light',
              platform: 'hue',
              uniqueId: 'lamp_uid_1',
            },
          ],
        } as T;
      }
      return { ok: true } as T;
    },
  };

  const validJson = JSON.stringify({
    schemaVersion: 1,
    source: 'home_assistant',
    registryEntityIds: {},
    deviceEntities: {
      abcdef0123456789abcdef0123456789: [
        {
          entityId: 'light.old_lamp',
          domain: 'light',
          platform: 'hue',
          uniqueId: 'lamp_uid_1',
          friendlyName: 'Old Lamp',
        },
      ],
    },
    scripts: [],
    automations: [
      {
        id: 'new_rule',
        name: 'Turn On Lamp',
        sourceEntityId: 'automation.new_rule',
        sourceEnabled: true,
        config: {
          alias: 'Turn On Lamp',
          triggers: [{ trigger: 'state', entity_id: 'light.old_lamp', to: 'on' }],
          actions: [{ action: 'light.turn_on', target: { entity_id: 'light.old_lamp' } }],
        },
      },
      {
        id: 'already_imported',
        name: 'Already Here',
        sourceEntityId: 'automation.already_imported',
        sourceEnabled: false,
        config: {
          alias: 'Already Here',
          triggers: [{ trigger: 'time', at: '07:00:00' }],
          actions: [{ action: 'light.turn_off', target: { entity_id: 'light.old_lamp' } }],
        },
      },
      {
        id: 'conflict_id',
        name: 'Conflicting Rule',
        sourceEntityId: 'automation.conflict_id',
        sourceEnabled: true,
        config: {
          alias: 'Conflicting Rule',
          triggers: [{ trigger: 'time', at: '08:00:00' }],
          actions: [{ action: 'light.turn_on', target: { entity_id: 'light.old_lamp' } }],
        },
      },
    ],
  });

  await withRoot(
    createElement(GpuiAutomationsView, {
      snapshot,
      automations: [],
      demo: false,
      disabled: false,
      management,
      onControl: () => undefined,
      onSaved: () => {
        onSavedCalls += 1;
      },
    }),
    async (renderer) => {
      click(renderer, 'automations-import-ha');
      await flushMicrotasks(renderer);

      setInputValue(renderer, 'ha-import-json-input', '{"schemaVersion":99}');
      click(renderer, 'ha-import-parse-json');
      await flushMicrotasks(renderer);
      const errElement = renderer.findByTestId('ha-import-error');
      assert(errElement, 'Invalid bundle JSON should show error alert');
      assert(
        renderer
          .getAllText()
          .some((text) => text.includes('Choose a valid Home Assistant rules transfer file.')),
        'Invalid bundle JSON should show validation message',
      );

      setInputValue(renderer, 'ha-import-json-input', validJson);
      click(renderer, 'ha-import-parse-json');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().some((text) => text.includes('3 rules · 0 saved on Haus')),
        'Valid pasted bundle must preview 3 rules',
      );

      click(renderer, 'ha-import-submit');
      await flushMicrotasks(renderer);

      const texts = renderer.getAllText();
      assert(
        texts.some((text) => text.includes('3 rules · 1 saved on Haus')),
        'Should report 1 saved rule out of 3',
      );
      assert(
        texts.some((text) => text.includes('Already imported; no changes made.')),
        'Should display skip reason for matching sourceEntityId',
      );
      assert(
        texts.some((text) => text.includes('This Haus ID belongs to a different rule.')),
        'Should display conflict error for mismatched Haus ID',
      );
      assert(
        texts.some((text) => text.includes('Import finished')),
        'Hub import should finish and announce completion',
      );
      assert.equal(onSavedCalls, 1);

      const getPaths = requests.filter((req) => req.method === 'GET').map((req) => req.path);
      assert.deepEqual(getPaths, [
        'haus/rules/scripts',
        'haus/rules/automations',
        'haus/rules/entities',
      ]);

      const postRequests = requests.filter((req) => req.method === 'POST');
      assert.equal(postRequests.length, 1);
      const posted = postRequests[0];
      assert.equal(posted?.path, 'config/automation/config/new_rule');
      assert.equal(
        JSON.stringify(posted?.data).includes('light.haus_lamp'),
        true,
        'Posted rule config should remap light.old_lamp to light.haus_lamp',
      );
      assert.equal(
        JSON.stringify(posted?.data).includes('"source":"home_assistant"'),
        true,
        'Posted rule config should include _hausMigration metadata',
      );
    },
  );
}

async function checkNativeFilePickerFlow(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'haus-ha-import-'));
  const filePath = join(dir, 'ha-export.json');
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        source: 'home_assistant',
        registryEntityIds: {},
        deviceEntities: {},
        scripts: [],
        automations: [
          {
            id: 'sunrise_chime',
            name: 'Sunrise chime',
            sourceEntityId: 'automation.sunrise_chime',
            sourceEnabled: true,
            config: {
              alias: 'Sunrise chime',
              triggers: [{ trigger: 'sun', event: 'sunrise' }],
              actions: [{ delay: { seconds: 1 } }],
            },
          },
        ],
      }),
      'utf8',
    );

    const snapshot = createDemoSnapshot();
    await withRoot(
      createElement(GpuiAutomationsView, {
        snapshot,
        automations: [],
        demo: true,
        disabled: false,
        openPaths: async () => [filePath],
        onControl: () => undefined,
      }),
      async (renderer) => {
        click(renderer, 'automations-import-ha');
        await flushMicrotasks(renderer);

        click(renderer, 'ha-import-choose-file');
        await flushMicrotasks(renderer);

        const texts = renderer.getAllText();
        assert(
          texts.some((text) => text.includes('ha-export.json')),
          'Native file picker should display selected basename',
        );
        assert(
          texts.some((text) => text.includes('Sunrise chime · automation')),
          'Native file picker should parse and list selected rule',
        );
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await checkDemoSampleImport();
await checkLiveHubImportAndValidation();
await checkNativeFilePickerFlow();

// Verify Automations Gallery starter templates, Hue/Event triggers, & visual flow in GPUIX
{
  const snapshot = createDemoSnapshot();
  await withRoot(
    createElement(GpuiAutomationsView, {
      snapshot,
      automations: [
        {
          entity_id: 'automation.hue_living_switch',
          state: 'on',
          attributes: {
            id: 'hue_living_switch',
            friendly_name: 'Living Room Switch',
          },
          last_changed: new Date().toISOString(),
        },
      ],
      demo: true,
      disabled: false,
      onControl: () => undefined,
    }),
    async (renderer) => {
      assert(
        renderer.findByTestId('automation-row-automation.hue_living_switch'),
        'Automations Gallery must render DeviceTile-adapted AutomationTile cards',
      );
      assert(
        renderer.findByTestId('rule-automation.hue_living_switch'),
        'AutomationTile must render interactive DeviceTileIconOrb toggle',
      );
      assert(
        renderer.findByTestId('automation-template-switch_button'),
        'Automations Gallery must render Switch Press starter template',
      );
      assert(
        renderer.findByTestId('automation-template-good_morning'),
        'Automations Gallery must render Good Morning starter template',
      );
      const galleryTexts = renderer.getAllText().join(' ').toLowerCase();
      assert(!galleryTexts.includes('apple'), 'Automations UI must not mention third-party brand');
      assert(!galleryTexts.includes('shortcut'), 'Automations UI must not use Shortcut naming');

      click(renderer, 'automation-template-switch_button');
      await flushMicrotasks(renderer);
      assert(
        !renderer.findByTestId('dialog-panel'),
        'Automation editor must open as a dedicated full-page screen rather than a modal',
      );
      assert(
        renderer.findByTestId('automation-editor-back'),
        'AutomationEditorScreen must render All automations back navigation',
      );
      const texts = renderer.getAllText();
      assert(
        texts.some((t) => t.includes('WHEN')) &&
          texts.some((t) => t.includes('Switch / Button')) &&
          texts.some((t) => t.includes('Event')),
        'AutomationEditorScreen must render Switch / Button and Event trigger modes',
      );
      click(renderer, 'when-kind-button_event-0');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().some((t) => t.includes('Short press')),
        'Switch / Button trigger must expose button press gestures',
      );
      click(renderer, 'automation-editor-back');
      await flushMicrotasks(renderer);
      const afterCancel = renderer.getAllText();
      assert(
        afterCancel.some((t) => t.includes('Discard unsaved automation changes?')),
        'Dirty automation editor screen should prompt before discarding changes',
      );
      click(renderer, 'automation-discard-confirm');
      await flushMicrotasks(renderer);
      assert(
        renderer.getAllText().includes('Create automation'),
        'Confirming discard should return to Automations gallery screen',
      );
    },
  );
}

console.log('GPUIX Automations HA Rules Transfer & Import integration check passed.');
