/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { defaults } from '@haus/ha/view/preferences';
import {
  DashboardGrid,
  DeviceTile,
  HausUiProvider,
  Heading,
  insets,
  parseCssColor,
  pct,
  Stack,
} from '@haus/ui';
import { createGpuiBrandIconPort, GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { requireGpuiBun } from '../../../src/gpui/bun.js';
import { getGpuiIconRenderService } from '../../../src/gpui/home/brand-service.js';
import { HomeWorkspace } from '../../../src/gpui/home/workspace.js';

requireGpuiBun();
assert(
  hasNativeTestRenderer,
  'GPUIX native test renderer is required for brand-integrations-discovery check',
);

const KEEP_SHOTS = process.env.HAUS_KEEP_SHOTS === '1';
const SHOT_DIR = resolve('/tmp/haus-brand-integrations-check');
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

async function verifyDeviceBrands(mode: 'dark' | 'light'): Promise<void> {
  const brandIcons = createGpuiBrandIconPort();
  const devices = [
    {
      id: 'brand-apple-tv',
      name: 'Living Room Apple TV',
      subtitle: 'Living Room',
      state: 'Playing',
      active: true,
      accent: '#78b9ff',
      deviceIcon: {
        name: 'Apple TV',
        primaryEntityId: 'media_player.apple_tv',
        manufacturer: 'Apple',
        model: 'Apple TV 4K',
      },
    },
    {
      id: 'brand-homepod',
      name: 'Living Room HomePod',
      subtitle: 'Living Room',
      state: 'Playing',
      active: true,
      accent: '#a78bfa',
      deviceIcon: {
        name: 'HomePod',
        primaryEntityId: 'media_player.homepod',
        manufacturer: 'Apple',
        model: 'HomePod (2nd generation)',
      },
    },
    {
      id: 'brand-homepod-mini',
      name: 'Bedroom HomePod mini',
      subtitle: 'Bedroom',
      state: 'Paused',
      active: false,
      deviceIcon: {
        name: 'HomePod mini',
        primaryEntityId: 'media_player.homepod_mini',
        manufacturer: 'Apple',
        model: 'HomePod mini',
      },
    },
    {
      id: 'brand-eero',
      name: 'eero 6+ Gateway',
      subtitle: 'Hallway',
      state: 'Online · 940 Mbps',
      active: true,
      accent: '#34d399',
      deviceIcon: {
        name: 'eero 6+',
        primaryEntityId: 'sensor.eero_gateway',
        category: 'network' as const,
        manufacturer: 'eero',
        model: 'eero 6+',
      },
    },
    {
      id: 'brand-samsung',
      name: 'Studio Samsung TV',
      subtitle: 'Studio',
      state: 'On · HDMI 1',
      active: true,
      accent: '#60a5fa',
      deviceIcon: {
        name: 'Samsung TV',
        primaryEntityId: 'media_player.samsung_tv',
        manufacturer: 'Samsung',
        model: 'LS43CG702',
      },
    },
    {
      id: 'brand-nest-hub',
      name: 'Kitchen Nest Hub',
      subtitle: 'Kitchen',
      state: 'Idle',
      active: false,
      deviceIcon: {
        name: 'Nest Hub',
        primaryEntityId: 'media_player.nest_hub',
        manufacturer: 'Google',
        model: 'Google Nest Hub',
      },
    },
    {
      id: 'brand-firetv',
      name: 'Guest Fire TV',
      subtitle: 'Guest Room',
      state: 'Standby',
      active: false,
      deviceIcon: {
        name: 'Fire TV',
        primaryEntityId: 'media_player.fire_tv',
        manufacturer: 'Amazon',
        model: 'AFTMM',
      },
    },
    {
      id: 'brand-scale',
      name: 'Smart Scale',
      subtitle: 'Bathroom',
      state: '72.4 kg',
      active: false,
      deviceIcon: { name: 'Scale', isScale: true },
    },
    {
      id: 'brand-kettle',
      name: 'Electric Kettle',
      subtitle: 'Kitchen',
      state: '92°C · Boiling',
      active: true,
      accent: '#f59e0b',
      deviceIcon: { name: 'Kettle', isKettle: true },
    },
  ];

  await withRoot({ width: 1080, height: 520 }, async ({ renderer, render }) => {
    render(
      createElement(
        HausUiProvider,
        {
          mode,
          contentHost: GPUIX_CONTENT_HOST,
          viewportWidth: 1080,
          viewportHeight: 520,
          brandIcons,
        },
        createElement(
          Stack,
          {
            gapPx: 16,
            style: {
              layout: { width: pct(100), height: pct(100), padding: insets(24) },
              material: {
                kind: 'solid',
                color: { kind: 'token', name: 'canvas' },
              },
            },
          },
          createElement(Heading, { level: 2, size: 18, weight: 600 }, 'Custom Device Brand Icons'),
          createElement(
            DashboardGrid,
            { columns: 3 },
            devices.map((item) =>
              createElement(DeviceTile, {
                key: item.id,
                frame: { id: item.id },
                name: item.name,
                subtitle: item.subtitle,
                state: item.state,
                available: true,
                active: item.active,
                accent: parseCssColor(item.accent),
                desktop: true,
                deviceIcon: item.deviceIcon,
                onQuick: () => undefined,
                onOpen: () => undefined,
              }),
            ),
          ),
        ),
      ),
    );
    await sleep(160);
    renderer.flush();
    for (const item of devices) {
      assertBounds(renderer, item.id);
    }
    renderer.captureScreenshot(resolve(SHOT_DIR, `device-brands-${mode}.png`));
  });
}

function clickTestId(
  renderer: ReturnType<typeof createTestRoot>['renderer'],
  testId: string,
): void {
  const b = assertBounds(renderer, testId);
  renderer.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2, 0);
  renderer.dispatchNativeEvents();
}

async function verifyWorkspaceViews(mode: 'dark' | 'light'): Promise<void> {
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
        onControl: () => undefined,
        onFavorite: () => undefined,
        onTheme: () => undefined,
        onGrouping: () => undefined,
      }),
    );

    // Wait for @haus/icons/node IconRenderService (C++20 worker) + Skia shadow compositing.
    for (let i = 0; i < 6; i += 1) {
      await sleep(300);
      renderer.flush();
    }

    assertBounds(renderer, 'system-summary-repairs');
    assertBounds(renderer, 'system-summary-updates');
    assertBounds(renderer, 'integrations-filter-discovered');
    const discoveredHue = assertBounds(renderer, 'discovered-card-demo-flow-hue');
    assertBounds(renderer, 'discovered-configure-demo-flow-hue');
    const integrationHue = assertBounds(renderer, 'integration-card-hue');
    assertBounds(renderer, 'integration-card-matter');
    assert(
      integrationHue.y >= discoveredHue.y + discoveredHue.height + 8,
      `Integrations grid must never overlap Discovered section (discovered bottom=${discoveredHue.y + discoveredHue.height}, integration top=${integrationHue.y})`,
    );
    renderer.captureScreenshot(resolve(SHOT_DIR, `integrations-${mode}.png`));

    // Scroll down to inspect the Discovered & Integrations cards in full.
    renderer.scrollToId('main-scroll', 0, -420);
    await sleep(100);
    renderer.flush();
    renderer.captureScreenshot(resolve(SHOT_DIR, `integrations-scrolled-${mode}.png`));
    renderer.scrollToId('main-scroll', 0, 0);
    await sleep(80);
    renderer.flush();

    // Open Add Device Discovery modal from Integrations hero button!
    clickTestId(renderer, 'integrations-add-device');
    await sleep(450);
    renderer.flush();
    await sleep(150);
    renderer.flush();

    assertBounds(renderer, 'radar-blip-demo-flow-hue');
    assertBounds(renderer, 'add-device-discovered-demo-flow-hue');
    assertBounds(renderer, 'add-device-path-code');
    renderer.captureScreenshot(resolve(SHOT_DIR, `discovery-modal-${mode}.png`));
  });

  // Render Apps / Add-ons Installed & Catalog views.
  await withRoot({ width: 1280, height: 860 }, async ({ renderer, render }) => {
    globalThis.hausGpuiRoute = 'addons';
    render(
      createElement(HomeWorkspace, {
        snapshot,
        preferences: prefs,
        systemTheme: mode,
        demo: true,
        onControl: () => undefined,
        onFavorite: () => undefined,
        onTheme: () => undefined,
        onGrouping: () => undefined,
      }),
    );

    for (let i = 0; i < 6; i += 1) {
      await sleep(300);
      renderer.flush();
    }

    assertBounds(renderer, 'apps-tab-installed');
    assertBounds(renderer, 'apps-tab-catalog');
    renderer.captureScreenshot(resolve(SHOT_DIR, `apps-installed-${mode}.png`));

    clickTestId(renderer, 'apps-tab-catalog');
    await sleep(450);
    renderer.flush();
    await sleep(150);
    renderer.flush();

    renderer.captureScreenshot(resolve(SHOT_DIR, `apps-catalog-${mode}.png`));
  });
}

async function main(): Promise<void> {
  await verifyDeviceBrands('dark');
  await verifyDeviceBrands('light');
  await verifyWorkspaceViews('dark');
  await verifyWorkspaceViews('light');
  console.log('GPUIX brand icons, integrations, apps, and discovery check passed!');
  await getGpuiIconRenderService().dispose();
  if (!KEEP_SHOTS) {
    rmSync(SHOT_DIR, { recursive: true, force: true });
  } else {
    console.log(`Screenshots saved under ${SHOT_DIR}`);
  }
}

await main();
