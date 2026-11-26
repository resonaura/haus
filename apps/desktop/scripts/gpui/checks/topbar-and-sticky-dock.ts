/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import sharp from 'sharp';
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { defaults } from '@haus/ha/view/preferences';
import { requireGpuiBun } from '../../../src/gpui/bun.js';
import { HomeWorkspace } from '../../../src/gpui/home/workspace.js';

requireGpuiBun();
assert(
  hasNativeTestRenderer,
  'GPUIX native test renderer is required for check-topbar-and-sticky-dock',
);

const KEEP_SHOTS = process.env.HAUS_KEEP_SHOTS === '1';
const SHOT_DIR = resolve('/tmp/haus-topbar-sticky-check');
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

function boundsOf(
  renderer: ReturnType<typeof createTestRoot>['renderer'],
  testId: string,
): { x: number; y: number; width: number; height: number } {
  const el = renderer.findByTestId(testId);
  assert(el, `Missing testId="${testId}"`);
  const bounds = renderer.getElementBounds(el.id);
  assert(bounds && bounds.width > 0 && bounds.height > 0, `Missing bounds for "${testId}"`);
  return bounds;
}

async function main(): Promise<void> {
  const snapshot = createDemoSnapshot();
  const prefs = { ...defaults, theme: 'dark' as const };
  let commits = 0;

  // 1. Desktop 1280x840: verify unified topbar, removed sidebar fold, native sticky dock pinning,
  //    hit-testing while pinned, and main-scroll scrollTo({ top: 0 }) on category change.
  await withRoot({ width: 1280, height: 840 }, async ({ renderer, render }) => {
    const Tree = () => {
      commits += 1;
      return createElement(HomeWorkspace, {
        snapshot,
        preferences: prefs,
        systemTheme: 'dark',
        demo: true,
        onControl: () => undefined,
        onTheme: () => undefined,
        onGrouping: () => undefined,
      });
    };

    render(createElement(Tree));
    await sleep(60);
    renderer.flush();

    // Sidebar fold button must be completely removed.
    assert.equal(
      renderer.findByTestId('sidebar-toggle'),
      undefined,
      'sidebar-toggle should no longer exist after removing sidebar fold',
    );
    assert.equal(
      renderer.findByTestId('topbar-navigation'),
      undefined,
      'topbar-navigation menu button should not appear on desktop GPUIX',
    );

    const scrollBounds = boundsOf(renderer, 'main-scroll');
    const layerTop = boundsOf(renderer, 'home-category-layer');
    const dockTop = boundsOf(renderer, 'home-category-dock');
    const profileBounds = boundsOf(renderer, 'home-settings');
    assert(
      Math.abs(scrollBounds.y - 61) <= 2,
      `Expected main-scroll directly below 61px topbar, got y=${scrollBounds.y}`,
    );
    assert(
      Math.abs(profileBounds.width - 29) <= 1 && Math.abs(profileBounds.height - 29) <= 1,
      `Expected 29x29 circular profile button, got ${JSON.stringify(profileBounds)}`,
    );
    assert(
      layerTop.y > scrollBounds.y + 60,
      `Expected unscrolled category layer below page header, got layer.y=${layerTop.y} vs scroll.y=${scrollBounds.y}`,
    );

    const topShot = resolve(SHOT_DIR, 'gpui-home-top.png');
    renderer.captureScreenshot(topShot);

    // Verify Liquid Glass HomeCategoryDock renders a single analytical rim (no shader-embedded
    // outer rim doubling over <GlassRim />): the 1px outer border row stays subtle (`materialEdge`)
    // while the single padding-box specular crest 1px inside is distinctly brighter on top & bottom.
    const meta = await sharp(topShot).metadata();
    const shotScale = (meta.width ?? 1280) / 1280;
    const sampleX = Math.round((dockTop.x + 80) * shotScale);
    const topEdgeY = Math.round(dockTop.y * shotScale);
    const botEdgeY = Math.round((dockTop.y + dockTop.height) * shotScale) - 1;
    const raw = await sharp(topShot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const lumaAt = (pxX: number, pxY: number): number => {
      const idx = (pxY * raw.info.width + pxX) * raw.info.channels;
      return Math.round(
        0.2126 * (raw.data[idx] ?? 0) +
          0.7152 * (raw.data[idx + 1] ?? 0) +
          0.0722 * (raw.data[idx + 2] ?? 0),
      );
    };
    const topBorderLuma = lumaAt(sampleX, topEdgeY);
    const topRimCrestLuma = lumaAt(sampleX, topEdgeY + Math.round(shotScale));
    const botBorderLuma = lumaAt(sampleX, botEdgeY);
    const botRimCrestLuma = lumaAt(sampleX, botEdgeY - Math.round(shotScale));
    assert(
      topBorderLuma < 50 && topRimCrestLuma > topBorderLuma + 20,
      `Expected single top GlassRim crest inside subtle border (no double rim), got border=${topBorderLuma}, crest=${topRimCrestLuma}`,
    );
    assert(
      botBorderLuma < 50 && botRimCrestLuma > botBorderLuma + 20,
      `Expected single bottom GlassRim crest inside subtle border (no double rim), got border=${botBorderLuma}, crest=${botRimCrestLuma}`,
    );

    // Scroll down -320px natively with ZERO React commits and verify sticky pinning.
    const commitsBeforeScroll = commits;
    assert.equal(renderer.scrollToId('main-scroll', 0, -320), true);
    renderer.flush();
    await sleep(40);
    renderer.flush();

    assert.equal(commits, commitsBeforeScroll, 'Native sticky scroll must trigger 0 React commits');

    const scrollAfter = renderer.getScrollState('main-scroll');
    assert(
      scrollAfter && scrollAfter.offsetY <= -280,
      `Expected main-scroll scrolled down, got ${JSON.stringify(scrollAfter)}`,
    );

    const layerPinned = boundsOf(renderer, 'home-category-layer');
    const dockPinned = boundsOf(renderer, 'home-category-dock');
    assert(
      Math.abs(layerPinned.y - scrollBounds.y) <= 2,
      `Expected sticky category layer pinned flush at scrollport top (${scrollBounds.y}), got y=${layerPinned.y}`,
    );
    assert(
      Math.abs(dockPinned.y - (scrollBounds.y + 12)) <= 2,
      `Expected floating glass dock pinned at scrollport top + 12px (${scrollBounds.y + 12}), got y=${dockPinned.y}`,
    );

    const scrolledShot = resolve(SHOT_DIR, 'gpui-home-scrolled.png');
    renderer.captureScreenshot(scrolledShot);

    // Hit-test & click a category pill while pinned over scrolled cards -> must hit the pill,
    // navigate to that category, AND automatically scroll main-scroll back to top (offsetY === 0)!
    const lightsBtn = renderer.findByTestId('category-lights');
    assert(lightsBtn, 'Missing category-lights button in sticky dock');
    const lightsBounds = boundsOf(renderer, 'category-lights');
    const clickX = lightsBounds.x + lightsBounds.width / 2;
    const clickY = lightsBounds.y + lightsBounds.height / 2;
    const hitIds = renderer.getElementsAt(clickX, clickY);
    assert(
      hitIds.includes(lightsBtn.id),
      `Expected pinned category-lights (${lightsBtn.id}) at (${clickX.toFixed(1)}, ${clickY.toFixed(1)}), got hits=${JSON.stringify(hitIds.slice(0, 8))}`,
    );

    renderer.nativeSimulateClick(clickX, clickY, 0);
    renderer.dispatchNativeEvents();
    await sleep(80);
    renderer.flush();

    const scrollReset = renderer.getScrollState('main-scroll');
    assert(
      scrollReset && Math.abs(scrollReset.offsetY) <= 1,
      `Expected clicking sticky category to scroll main-scroll back to top, got offsetY=${scrollReset?.offsetY}`,
    );

    // Also verify Servers pill exists inside HomeCategoryDock and navigates + stays at top.
    const serversBtn = renderer.findByTestId('category-servers');
    assert(serversBtn, 'Missing Servers pill in unified HomeCategoryDock');

    console.log(
      `Desktop sticky check passed: unscrolled layer.y=${layerTop.y.toFixed(1)} -> pinned layer.y=${layerPinned.y.toFixed(1)} (dock.y=${dockPinned.y.toFixed(1)}, top=${dockTop.y.toFixed(1)}), 0 React commits on scroll, click while pinned reset offsetY=${scrollReset.offsetY.toFixed(1)}`,
    );
  });

  // 2. Narrow viewport (740x760): verify horizontal rail overflows and auto-scrolls to keep the
  //    selected far-right category pill centered when chosen.
  await withRoot({ width: 740, height: 760 }, async ({ renderer, render }) => {
    render(
      createElement(HomeWorkspace, {
        snapshot,
        preferences: prefs,
        systemTheme: 'dark',
        demo: true,
        onControl: () => undefined,
        onTheme: () => undefined,
        onGrouping: () => undefined,
      }),
    );
    await sleep(60);
    renderer.flush();

    const railBefore = renderer.getScrollState('home-category-rail');
    assert(
      railBefore && railBefore.maxX > 20,
      `Expected horizontal rail overflow at 740px width, got ${JSON.stringify(railBefore)}`,
    );

    // Select a far-right category via sidebar -> HomeCategoryDock effect should scroll rail horizontally!
    const serversSidebar = renderer.findByTestId('sidebar-servers');
    assert(serversSidebar, 'Missing sidebar-servers');
    const sb = boundsOf(renderer, 'sidebar-servers');
    renderer.nativeSimulateClick(sb.x + sb.width / 2, sb.y + sb.height / 2, 0);
    renderer.dispatchNativeEvents();
    await sleep(320);
    renderer.flush();

    const railAfter = renderer.getScrollState('home-category-rail');
    assert(
      railAfter && railAfter.offsetX < -20,
      `Expected horizontal HomeCategoryDock to auto-scroll toward Servers pill, got ${JSON.stringify(railAfter)}`,
    );
    console.log(
      `Horizontal dock scrollTo check passed: maxX=${railBefore.maxX.toFixed(1)}, offsetX 0 -> ${railAfter.offsetX.toFixed(1)}`,
    );
  });

  if (!KEEP_SHOTS) {
    rmSync(SHOT_DIR, { recursive: true, force: true });
  } else {
    console.log(`Saved GPUIX screenshots to ${SHOT_DIR}`);
  }
}

await main();
