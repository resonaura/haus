/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { defaults } from '@haus/ha/view/preferences';
import { requireGpuiBun } from '../../../src/gpui/bun.js';
import { getGpuiIconRenderService } from '../../../src/gpui/home/brand-service.js';
import { HomeWorkspace } from '../../../src/gpui/home/workspace.js';

requireGpuiBun();
assert(
  hasNativeTestRenderer,
  'GPUIX native test renderer is required for setup-and-repairs-flows check',
);

const KEEP_SHOTS = process.env.HAUS_KEEP_SHOTS === '1';
const SHOT_DIR = resolve('/tmp/haus-setup-repairs-check');
mkdirSync(SHOT_DIR, { recursive: true });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withRoot(
  size: { width: number; height: number },
  fn: (ctx: ReturnType<typeof createTestRoot>) => void | Promise<void>,
): Promise<void> {
  const root = createTestRoot(size);
  return Promise.resolve(fn(root)).finally(() => root.unmount());
}

function assertBounds(
  renderer: ReturnType<typeof createTestRoot>['renderer'],
  testId: string,
): { x: number; y: number; width: number; height: number } {
  const el = renderer.findByTestId(testId);
  assert(el, `Missing testId="${testId}"`);
  const bounds = renderer.getElementBounds(el.id);
  assert(bounds && bounds.width > 0 && bounds.height > 0, `Empty bounds for "${testId}"`);
  return bounds;
}

async function settle(
  renderer: ReturnType<typeof createTestRoot>['renderer'],
  frames = 3,
  ms = 140,
): Promise<void> {
  for (let i = 0; i < frames; i += 1) {
    await sleep(ms);
    renderer.flush();
  }
}

async function clickTestId(
  renderer: ReturnType<typeof createTestRoot>['renderer'],
  testId: string,
  waitMs = 180,
): Promise<void> {
  const b = assertBounds(renderer, testId);
  renderer.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2, 0);
  renderer.dispatchNativeEvents();
  await settle(renderer, 3, Math.max(60, Math.round(waitMs / 3)));
}

async function verifyMode(mode: 'dark' | 'light'): Promise<void> {
  const snapshot = createDemoSnapshot();
  const prefs = { ...defaults, theme: mode };

  await withRoot({ width: 1280, height: 860 }, async ({ renderer, render }) => {
    globalThis.hausGpuiRoute = 'integrations';
    render(
      createElement(HomeWorkspace, {
        snapshot,
        preferences: prefs,
        systemTheme: mode,
        demo: true,
        sessionMeta: { connected: true, kind: 'haus-hub', url: 'https://demo.haus.local' },
        platform: {
          openExternal: async () => undefined,
        } as Parameters<typeof HomeWorkspace>[0]['platform'],
        onControl: () => undefined,
        onFavorite: () => undefined,
        onTheme: () => undefined,
        onGrouping: () => undefined,
      }),
    );

    await settle(renderer, 5, 220);

    // 1. Repairs panel -> verify Fix + Docs + Ignore buttons, then open Repair fix flow!
    await clickTestId(renderer, 'integrations-open-repairs', 220);
    assertBounds(renderer, 'repair-card-zha-zigbee_channel_overlap');
    assertBounds(renderer, 'repair-docs-zigbee_channel_overlap');
    assertBounds(renderer, 'repair-fix-zigbee_channel_overlap');
    assertBounds(renderer, 'repair-ignore-zigbee_channel_overlap');
    renderer.captureScreenshot(resolve(SHOT_DIR, `01-repairs-panel-${mode}.png`));

    await clickTestId(renderer, 'repair-fix-zigbee_channel_overlap', 260);
    assertBounds(renderer, 'flow-submit');
    assertBounds(renderer, 'flow-header-docs');
    renderer.captureScreenshot(resolve(SHOT_DIR, `02-repair-fix-flow-${mode}.png`));

    // Submit repair fix -> verify completion card
    await clickTestId(renderer, 'flow-submit', 220);
    assertBounds(renderer, 'flow-done');
    renderer.captureScreenshot(resolve(SHOT_DIR, `03-repair-complete-${mode}.png`));
    await clickTestId(renderer, 'flow-done', 280);

    // Back to integrations list -> open Zigbee Home full-page Integration Details!
    await clickTestId(renderer, 'repairs-back', 220);
    renderer.scrollToId('main-scroll', 0, -450);
    await settle(renderer, 2, 100);
    await clickTestId(renderer, 'integration-manage-zha', 260);
    renderer.scrollToId('main-scroll', 0, 0);
    await settle(renderer, 3, 120);
    assertBounds(renderer, 'integration-detail-attention');
    assertBounds(renderer, 'integration-detail-fix-zigbee_channel_overlap');
    assertBounds(renderer, 'entry-options-zigbee-main');
    assertBounds(renderer, 'entry-reconfigure-zigbee-main');
    assertBounds(renderer, 'entry-reload-zigbee-main');
    assertBounds(renderer, 'entry-toggle-disable-zigbee-main');
    assertBounds(renderer, 'entry-delete-zigbee-main');
    renderer.captureScreenshot(resolve(SHOT_DIR, `04-integration-details-${mode}.png`));

    // Open Options flow directly from entry card
    await clickTestId(renderer, 'entry-options-zigbee-main', 220);
    assertBounds(renderer, 'flow-submit');
    renderer.captureScreenshot(resolve(SHOT_DIR, `05-options-flow-${mode}.png`));
    await clickTestId(renderer, 'dialog-close', 280);

    // Return to integrations overview -> open Add Device modal (with all 4 paths including Camera)
    await clickTestId(renderer, 'integration-detail-back', 220);
    await clickTestId(renderer, 'integrations-add-device', 260);
    assertBounds(renderer, 'add-device-path-code');
    assertBounds(renderer, 'add-device-path-camera');
    assertBounds(renderer, 'add-device-path-browse');
    assertBounds(renderer, 'add-device-path-apps');
    renderer.captureScreenshot(resolve(SHOT_DIR, `06-add-device-${mode}.png`));

    // Browse all integrations -> Brand catalog picker with ecosystem tabs + glass brand grid
    await clickTestId(renderer, 'add-device-path-browse', 280);
    await settle(renderer, 5, 220);
    assertBounds(renderer, 'flow-picker-eco-all');
    assertBounds(renderer, 'flow-picker-eco-homebridge');
    assertBounds(renderer, 'flow-picker-eco-scrypted');
    const esphomeBounds = assertBounds(renderer, 'flow-picker-esphome');
    const gHeaderBounds = assertBounds(renderer, 'flow-picker-section-pill-G');
    assert(
      gHeaderBounds.y >= esphomeBounds.y + esphomeBounds.height - 1,
      `Section G header (${gHeaderBounds.y}) must not overlap ESPHome card bottom (${esphomeBounds.y + esphomeBounds.height})`,
    );
    assertBounds(renderer, 'flow-picker-govee');
    const backdropEl = renderer.findByTestId('dialog-backdrop');
    assert(backdropEl, 'Expected dialog-backdrop');
    assert(
      typeof backdropEl.style.backgroundColor === 'string' &&
        backdropEl.style.backgroundColor.startsWith('rgba(0, 0, 0,'),
      `Expected pure neutral black backdrop, got ${String(backdropEl.style.backgroundColor)}`,
    );
    renderer.captureScreenshot(resolve(SHOT_DIR, `07-brand-catalog-picker-${mode}.png`));

    // Open animated A-Z semantic zoom overlay & verify letter tiles + counts
    await clickTestId(renderer, 'flow-picker-alpha-trigger', 340);
    assertBounds(renderer, 'flow-picker-alphabet-overlay');
    assertBounds(renderer, 'flow-picker-letter-tile-G');
    assertBounds(renderer, 'flow-picker-letter-tile-H');
    renderer.captureScreenshot(resolve(SHOT_DIR, `07b-alphabet-zoom-overlay-${mode}.png`));
    await clickTestId(renderer, 'flow-picker-letter-tile-G', 260);
    assertBounds(renderer, 'flow-picker-clear-letter');
    assertBounds(renderer, 'flow-picker-govee');

    // Open Haus Govee multi-driver Brand Detail
    await clickTestId(renderer, 'flow-picker-govee', 260);
    assertBounds(renderer, 'brand-detail-back');
    assertBounds(renderer, 'brand-driver-launch-homebridge:homebridge-govee');
    renderer.captureScreenshot(resolve(SHOT_DIR, `08-brand-detail-${mode}.png`));

    // Open Homebridge Govee Plugin Install step
    await clickTestId(renderer, 'brand-driver-launch-homebridge:homebridge-govee', 240);
    assertBounds(renderer, 'plugin-install-submit');
    renderer.captureScreenshot(resolve(SHOT_DIR, `09-plugin-install-${mode}.png`));
    await clickTestId(renderer, 'dialog-close', 280);

    // Camera setup path -> Manual RTSP camera setup
    await clickTestId(renderer, 'integrations-add-device', 260);
    await clickTestId(renderer, 'add-device-path-camera', 220);
    assertBounds(renderer, 'camera-path-apps');
    assertBounds(renderer, 'camera-path-brand');
    assertBounds(renderer, 'camera-path-manual');
    renderer.captureScreenshot(resolve(SHOT_DIR, `10-camera-setup-${mode}.png`));

    await clickTestId(renderer, 'camera-path-manual', 220);
    assertBounds(renderer, 'manual-camera-stream-url');
    renderer.captureScreenshot(resolve(SHOT_DIR, `11-camera-manual-${mode}.png`));
    await clickTestId(renderer, 'dialog-close', 280);

    // Code-first commissioning flow
    await clickTestId(renderer, 'integrations-add-device', 260);
    await clickTestId(renderer, 'add-device-path-code', 220);
    await clickTestId(renderer, 'commissioning-demo-matter', 200);
    assertBounds(renderer, 'commissioning-start');
    renderer.captureScreenshot(resolve(SHOT_DIR, `12-commissioning-code-${mode}.png`));
    await clickTestId(renderer, 'dialog-close', 280);
  });
}

async function verifyDeviceModalBackdropNoLeak(): Promise<void> {
  const snapshot = createDemoSnapshot();
  (globalThis as unknown as { hausGpuiRoute?: string }).hausGpuiRoute = 'category:lights';
  await withRoot({ width: 1280, height: 840 }, async ({ renderer, render }) => {
    render(
      createElement(HomeWorkspace, {
        snapshot,
        preferences: { ...defaults, theme: 'dark' },
        systemTheme: 'dark',
        reducedTransparency: false,
        demo: true,
        onControl: () => undefined,
        onTheme: () => undefined,
        onGrouping: () => undefined,
      }),
    );
    await settle(renderer, 4, 140);
    await clickTestId(renderer, 'device-light.living_room_pendant-details', 260);
    const panel = assertBounds(renderer, 'dialog-panel');
    const tileB = assertBounds(renderer, 'device-light.kitchen_counter-details');
    const bx = tileB.x + tileB.width / 2;
    const by = tileB.y + tileB.height / 2;
    assert(
      bx < panel.x || bx > panel.x + panel.width || by < panel.y || by > panel.y + panel.height,
      'Second light tile should sit behind the modal backdrop',
    );
    renderer.nativeSimulateMouseDown(bx, by, 0);
    renderer.dispatchNativeEvents();
    renderer.flush();
    // Backdrop must stay mounted during mouseDown (closes on mouseUp/click + smooth exit)
    assert(
      renderer.findByTestId('dialog-panel'),
      'Modal must not unmount prematurely on mouseDown',
    );
    renderer.nativeSimulateMouseUp(bx, by, 0);
    renderer.dispatchNativeEvents();
    renderer.flush();
    await settle(renderer, 4, 240);
    assert.equal(
      renderer.findByTestId('dialog-panel'),
      undefined,
      'Backdrop click over another DeviceTile must close modal without opening that device',
    );
  });
}

try {
  await verifyMode('dark');
  await verifyMode('light');
  await verifyDeviceModalBackdropNoLeak();
  console.log(
    'setup-and-repairs-flows GPUIX Metal check passed (dark + light, 13 flows + backdrop occlusion).',
  );
} finally {
  if (!KEEP_SHOTS) {
    rmSync(SHOT_DIR, { recursive: true, force: true });
  }
  await getGpuiIconRenderService().dispose();
}
