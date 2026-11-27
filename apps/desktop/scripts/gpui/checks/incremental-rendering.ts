/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, useState } from 'react';
import sharp from 'sharp';
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { defaults } from '@haus/ha/view/preferences';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { corners, insets, px, rgba, SolidMaterial } from '@haus/ui/ir';
import {
  Box,
  HausDialog,
  HausScrollArea,
  HausUiProvider,
  Pressable,
  Stack,
  Text,
} from '@haus/ui/primitives';
import { requireGpuiBun } from '../../../src/gpui/bun.js';
import { HomeWorkspace } from '../../../src/gpui/home/workspace.js';

requireGpuiBun();
assert(hasNativeTestRenderer, 'GPUIX native test renderer is required for incremental-rendering');

const KEEP_SHOTS = process.env.HAUS_KEEP_SHOTS === '1';
const SHOT_DIR = resolve('/tmp/haus-incremental-rendering-check');
mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const DARK_PREFS = { ...defaults, theme: 'dark' as const };
const NOOP = (): void => undefined;

interface PixelDiffResult {
  readonly totalPixels: number;
  readonly diffPixels: number;
  readonly maxChannelDiff: number;
}

async function diffPngs(pathA: string, pathB: string): Promise<PixelDiffResult> {
  const [rawA, rawB] = await Promise.all([
    sharp(pathA).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(pathB).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.equal(rawA.info.width, rawB.info.width, 'Screenshot widths must match');
  assert.equal(rawA.info.height, rawB.info.height, 'Screenshot heights must match');
  let diffPixels = 0;
  let maxChannelDiff = 0;
  for (let i = 0; i < rawA.data.length; i += 4) {
    const d0 = Math.abs((rawA.data[i] ?? 0) - (rawB.data[i] ?? 0));
    const d1 = Math.abs((rawA.data[i + 1] ?? 0) - (rawB.data[i + 1] ?? 0));
    const d2 = Math.abs((rawA.data[i + 2] ?? 0) - (rawB.data[i + 2] ?? 0));
    const d3 = Math.abs((rawA.data[i + 3] ?? 0) - (rawB.data[i + 3] ?? 0));
    const localMax = Math.max(d0, d1, d2, d3);
    if (localMax > 0) {
      diffPixels += 1;
      if (localMax > maxChannelDiff) maxChannelDiff = localMax;
    }
  }
  return { totalPixels: rawA.info.width * rawA.info.height, diffPixels, maxChannelDiff };
}

function withRoot(
  size: { width: number; height: number },
  fn: (ctx: ReturnType<typeof createTestRoot>) => void | Promise<void>,
): Promise<void> {
  const root = createTestRoot(size);
  return Promise.resolve(fn(root)).finally(() => {
    root.renderer.setIncrementalRendering(null);
    root.unmount();
  });
}

function renderHome(snapshot: ReturnType<typeof createDemoSnapshot>) {
  return createElement(HomeWorkspace, {
    snapshot,
    preferences: DARK_PREFS,
    systemTheme: 'dark',
    demo: true,
    onControl: NOOP,
    onTheme: NOOP,
    onGrouping: NOOP,
  });
}

const MODAL_BRANDS =
  'Home Assistant Core|HACS Community|Homebridge Hub|Hue Bridge Pro|Aqara Zigbee 3.0|Matter Thread Border|Scrypted NVR Camera|Lutron Caseta|Shelly Gen3 Local|UniFi Protect|ESPHome Native|MQTT Broker'.split(
    '|',
  );

async function checkNoopBatchSuppression(): Promise<void> {
  await withRoot({ width: 960, height: 640 }, ({ renderer, render }) => {
    render(
      createElement(
        HausUiProvider,
        {
          mode: 'dark',
          viewport: { width: 960, height: 640, scale: 1, reducedMotion: true },
          contentHost: GPUIX_CONTENT_HOST,
        },
        createElement(
          Stack,
          { gapPx: 12, style: { layout: { padding: insets(24) } } },
          createElement(Text, null, 'Static dashboard frame'),
        ),
      ),
    );
    renderer.flush();
    renderer.resetPerfMetrics();
    renderer.applyBatch('[]');
    const perf = renderer.getPerfMetrics();
    assert(
      perf.noopBatchCount >= 1 && perf.drawCount === 0,
      `Expected no-op batch to skip GPUI draw, got ${JSON.stringify(perf)}`,
    );
    console.log(
      `[1/5] No-op batch suppression passed: noopBatchCount=${perf.noopBatchCount}, drawCount=${perf.drawCount}`,
    );
  });
}

function makeStaticSnapshot() {
  const snap = createDemoSnapshot();
  return {
    ...snap,
    states: snap.states.map((entity) => {
      if (!entity.attributes || !('effect' in entity.attributes)) return entity;
      const nextAttrs = { ...entity.attributes };
      delete nextAttrs.effect;
      return { ...entity, attributes: nextAttrs };
    }),
  };
}

function makeMutatedSnapshot(base: ReturnType<typeof makeStaticSnapshot>) {
  return {
    ...base,
    states: base.states.map((entity) =>
      entity.entity_id.startsWith('light.')
        ? { ...entity, state: entity.state === 'on' ? 'off' : 'on' }
        : entity,
    ),
  };
}

async function checkPortalSubtreeReplayAndBackdropCache(): Promise<void> {
  const baseSnapshot = makeStaticSnapshot();
  const mutatedSnapshot = makeMutatedSnapshot(baseSnapshot);
  const animatedSnapshot = createDemoSnapshot();

  await withRoot({ width: 1280, height: 840 }, async ({ renderer, render }) => {
    let setQueryExternal: ((q: string) => void) | null = null;
    let setModeExternal: ((mode: 'static' | 'mutated' | 'animated') => void) | null = null;

    function ModalOverWorkspace() {
      const [query, setQuery] = useState('');
      const [bgMode, setBgMode] = useState<'static' | 'mutated' | 'animated'>('static');
      setQueryExternal = setQuery;
      setModeExternal = setBgMode;
      const activeSnap =
        bgMode === 'mutated'
          ? mutatedSnapshot
          : bgMode === 'animated'
            ? animatedSnapshot
            : baseSnapshot;
      const filtered = MODAL_BRANDS.filter((item) =>
        item.toLowerCase().includes(query.trim().toLowerCase()),
      );
      return createElement(
        HausUiProvider,
        {
          mode: 'dark',
          viewport: { width: 1280, height: 840, scale: 1, reducedMotion: true },
          contentHost: GPUIX_CONTENT_HOST,
        },
        createElement(
          Box,
          { style: { layout: { width: px(1280), height: px(840), position: 'relative' } } },
          renderHome(activeSnap),
          createElement(
            HausDialog,
            {
              open: true,
              onClose: NOOP,
              title: 'Add Integration',
              eyebrow: 'CONNECT YOUR HOME',
              maxWidthPx: 680,
            },
            createElement(
              Stack,
              { gapPx: 12, style: { layout: { padding: insets(8) } } },
              createElement('input', {
                testId: 'modal-search-input',
                value: query,
                placeholder: 'Search integrations...',
                onChange: (event: { value?: string }) => setQuery(event.value ?? ''),
                style: {
                  height: 40,
                  paddingLeft: 12,
                  paddingRight: 12,
                  borderRadius: 12,
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  color: '#f5f5f7',
                },
              }),
              createElement(
                HausScrollArea,
                { id: 'modal-results-scroll', style: { layout: { height: px(280) } } },
                createElement(
                  Stack,
                  { gapPx: 8 },
                  ...filtered.map((brand, idx) =>
                    createElement(
                      Pressable,
                      {
                        key: brand,
                        id: `modal-row-${idx}`,
                        style: {
                          layout: {
                            height: px(44),
                            padding: insets(0, 14),
                            justifyContent: 'center',
                          },
                          corners: corners(12),
                          material: new SolidMaterial(rgba(255, 255, 255, 0.04)),
                          states: {
                            hover: { material: new SolidMaterial(rgba(255, 255, 255, 0.11)) },
                          },
                        },
                      },
                      createElement(Text, null, brand),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    const flushPresent = () => {
      renderer.flush();
      renderer.presentFrame();
    };
    renderer.setIncrementalRendering(true);
    render(createElement(ModalOverWorkspace));
    await sleep(80);
    flushPresent();
    renderer.clockFastForward(1000);
    flushPresent();
    flushPresent();

    const inputEl = renderer.findByTestId('modal-search-input');
    assert(inputEl, 'Missing modal-search-input');
    renderer.focusElement(inputEl.id);
    flushPresent();
    flushPresent();

    renderer.resetPerfMetrics();
    renderer.advanceTime(550);
    renderer.presentFrame();
    const caretPerf = renderer.getPerfMetrics();
    assert(
      caretPerf.replayedSubtrees >= 1 &&
        caretPerf.replayedElements >= 700 &&
        caretPerf.builtElements < 100,
      `Expected background HomeWorkspace replay on modal caret blink, got ${JSON.stringify(caretPerf)}`,
    );
    assert(
      caretPerf.backdropPasses === 0 && caretPerf.backdropCacheHits >= 1,
      `Expected 0 GPU backdrop blur passes on modal caret blink, got ${JSON.stringify(caretPerf)}`,
    );

    const typeTimes: number[] = [];
    let lastSearchPerf = caretPerf;
    for (const nextQuery of ['h', 'ho', 'hom']) {
      renderer.resetPerfMetrics();
      const t0 = performance.now();
      setQueryExternal?.(nextQuery);
      await sleep(5);
      flushPresent();
      typeTimes.push(Number((performance.now() - t0).toFixed(2)));
      const searchPerf = renderer.getPerfMetrics();
      lastSearchPerf = searchPerf;
      assert(
        searchPerf.replayedSubtrees >= 1 && searchPerf.replayedElements >= 300,
        `Expected background HomeWorkspace replay during search "${nextQuery}"`,
      );
      assert(
        searchPerf.backdropPasses === 0 && searchPerf.backdropCacheHits >= 1,
        `Expected 0 GPU backdrop blur passes during search "${nextQuery}"`,
      );
    }

    const row0 = renderer.findByTestId('modal-row-0');
    assert(row0, 'Missing modal-row-0');
    const rowBounds = renderer.getElementBounds(row0.id);
    assert(rowBounds, 'Missing modal-row-0 bounds');
    const rowCx = rowBounds.x + rowBounds.width / 2;
    const rowCy = rowBounds.y + rowBounds.height / 2;
    renderer.resetPerfMetrics();
    renderer.nativeSimulateMouseMove(rowCx, rowCy);
    renderer.dispatchNativeEvents();
    renderer.presentFrame();
    const hoverPerf = renderer.getPerfMetrics();
    assert.equal(hoverPerf.applyBatchCount, 0, 'Modal native hover must trigger 0 React batches');
    assert(
      hoverPerf.replayedSubtrees >= 1 &&
        hoverPerf.backdropPasses === 0 &&
        hoverPerf.backdropCacheHits >= 1,
      `Expected subtree replay + backdrop cache hit on modal hover, got ${JSON.stringify(hoverPerf)}`,
    );

    renderer.nativeSimulateClick(rowCx, rowCy, 0);
    renderer.dispatchNativeEvents();
    flushPresent();

    const incShot = resolve(SHOT_DIR, 'modal-incremental-on.png');
    const fullShot = resolve(SHOT_DIR, 'modal-incremental-off.png');
    renderer.clockPause();
    renderer.captureScreenshot(incShot);
    const incText = renderer.getPaintedText();
    const incHits = renderer.getElementsAt(rowCx, rowCy);
    renderer.setIncrementalRendering(false);
    renderer.resetPerfMetrics();
    renderer.captureScreenshot(fullShot);
    renderer.clockResume();
    const fullPerf = renderer.getPerfMetrics();
    assert.equal(fullPerf.replayedSubtrees, 0, 'Full-render fallback must not replay subtrees');
    assert(fullPerf.backdropPasses >= 1, 'Full-render fallback must run live backdrop passes');
    assert.deepEqual(incText, renderer.getPaintedText(), 'Painted text order must match 1:1');
    assert.deepEqual(incHits, renderer.getElementsAt(rowCx, rowCy), 'Hitbox order must match 1:1');
    const modalDiff = await diffPngs(incShot, fullShot);
    assert.equal(
      modalDiff.diffPixels,
      0,
      `Expected 0 modal diff pixels, got ${modalDiff.diffPixels}`,
    );

    renderer.setIncrementalRendering(true);
    flushPresent();
    renderer.resetPerfMetrics();
    setModeExternal?.('mutated');
    await sleep(20);
    flushPresent();
    const bgInvalidatedPerf = renderer.getPerfMetrics();
    assert(bgInvalidatedPerf.backdropPasses >= 1, 'Expected backdrop invalidation on bg mutation');
    renderer.clockFastForward(1000);
    flushPresent();

    const mutatedIncShot = resolve(SHOT_DIR, 'mutated-bg-inc.png');
    const mutatedFullShot = resolve(SHOT_DIR, 'mutated-bg-full.png');
    renderer.clockPause();
    renderer.captureScreenshot(mutatedIncShot);
    renderer.setIncrementalRendering(false);
    renderer.captureScreenshot(mutatedFullShot);
    renderer.clockResume();
    const mutatedDiff = await diffPngs(mutatedIncShot, mutatedFullShot);
    assert.equal(
      mutatedDiff.diffPixels,
      0,
      `Expected 0 mutated diff pixels, got ${mutatedDiff.diffPixels}`,
    );

    renderer.setIncrementalRendering(true);
    flushPresent();
    renderer.resetPerfMetrics();
    setQueryExternal?.('home');
    await sleep(10);
    flushPresent();
    const rehitPerf = renderer.getPerfMetrics();
    assert(
      rehitPerf.replayedSubtrees >= 1 &&
        rehitPerf.backdropPasses === 0 &&
        rehitPerf.backdropCacheHits >= 1,
      `Expected caches to re-stabilize after bg mutation, got ${JSON.stringify(rehitPerf)}`,
    );

    renderer.clockPause();
    setModeExternal?.('animated');
    await sleep(60);
    flushPresent();
    renderer.resetPerfMetrics();
    renderer.clockFastForward(48);
    renderer.presentFrame();
    renderer.clockResume();
    const animPerf = renderer.getPerfMetrics();
    assert(
      animPerf.replayedSubtrees >= 3 &&
        animPerf.backdropPasses >= 1 &&
        animPerf.backdropCacheHits >= 1,
      `Expected selective backdrop invalidation + sibling replay, got ${JSON.stringify(animPerf)}`,
    );

    console.log(
      `[2/5] Portal isolation + subtree replay + backdrop cache passed: searchReplayed=${lastSearchPerf.replayedElements}, searchBuilt=${lastSearchPerf.builtElements}, caretDrawMs=${caretPerf.totalDrawMs.toFixed(2)}, searchDrawMs=${lastSearchPerf.totalDrawMs.toFixed(2)} (steps=[${typeTimes.join(', ')}]), hoverDrawMs=${hoverPerf.totalDrawMs.toFixed(2)} (vs full=${fullPerf.totalDrawMs.toFixed(2)}), pixelDiff=0/${modalDiff.totalPixels}`,
    );
    console.log(
      `[3/5] Backdrop invalidation safety passed: bgPasses=${bgInvalidatedPerf.backdropPasses}, pixelDiff=0/${mutatedDiff.totalPixels}, fgPasses=${rehitPerf.backdropPasses}, aurora={replayed:${animPerf.replayedElements}, passes:${animPerf.backdropPasses}, hits:${animPerf.backdropCacheHits}}`,
    );
  });
}

async function checkNonModalHoverPixelIdentity(): Promise<void> {
  await withRoot({ width: 1280, height: 840 }, async ({ renderer, render }) => {
    render(renderHome(makeStaticSnapshot()));
    await sleep(60);
    renderer.flush();
    renderer.clockFastForward(1000);
    renderer.flush();
    renderer.flush();
    const lights = renderer.findByTestId('category-lights');
    const servers = renderer.findByTestId('category-servers');
    assert(lights && servers, 'Missing category pills');
    const lb = renderer.getElementBounds(lights.id);
    const sb = renderer.getElementBounds(servers.id);
    assert(lb && sb, 'Missing category pill bounds');
    renderer.nativeSimulateMouseMove(lb.x + lb.width / 2, lb.y + lb.height / 2);
    renderer.dispatchNativeEvents();
    renderer.resetPerfMetrics();
    renderer.nativeSimulateMouseMove(sb.x + sb.width / 2, sb.y + sb.height / 2);
    renderer.dispatchNativeEvents();
    const hoverPerf = renderer.getPerfMetrics();
    const incHoverShot = resolve(SHOT_DIR, 'non-modal-hover-inc.png');
    const fullHoverShot = resolve(SHOT_DIR, 'non-modal-hover-full.png');
    renderer.clockPause();
    renderer.captureScreenshot(incHoverShot);
    renderer.setIncrementalRendering(false);
    renderer.captureScreenshot(fullHoverShot);
    renderer.clockResume();
    const hoverDiff = await diffPngs(incHoverShot, fullHoverShot);
    assert.equal(hoverDiff.diffPixels, 0, 'Expected 0 diff pixels on non-modal hover');
    assert(hoverPerf.replayedSubtrees >= 1, 'Expected unhovered sibling subtrees to replay');
    console.log(
      `[4/5] Non-modal hover pixel identity passed: replayedSubtrees=${hoverPerf.replayedSubtrees}, replayedElements=${hoverPerf.replayedElements}, drawMs=${hoverPerf.totalDrawMs.toFixed(2)}, pixelDiff=0/${hoverDiff.totalPixels}`,
    );
  });
}

async function checkDiagonalScrollArbitration(): Promise<void> {
  await withRoot({ width: 740, height: 760 }, async ({ renderer, render }) => {
    render(renderHome(createDemoSnapshot()));
    await sleep(60);
    renderer.flush();
    const railEl = renderer.findByTestId('home-category-rail');
    assert(railEl, 'Missing home-category-rail');
    const railBounds = renderer.getElementBounds(railEl.id);
    assert(railBounds, 'Missing home-category-rail bounds');
    const rx = railBounds.x + railBounds.width / 2;
    const ry = railBounds.y + railBounds.height / 2;
    const mainBefore = renderer.getScrollState('main-scroll');
    assert(mainBefore, 'Missing main-scroll state');

    for (let i = 0; i < 6; i++) renderer.nativeSimulateScrollWheel(rx, ry, -40, -3);
    renderer.dispatchNativeEvents();
    renderer.flush();
    const railAfterDiag = renderer.getScrollState('home-category-rail');
    const mainAfterDiag = renderer.getScrollState('main-scroll');
    assert(railAfterDiag && railAfterDiag.offsetX < -20, 'Expected horizontal rail to scroll');
    assert(
      mainAfterDiag && Math.abs(mainAfterDiag.offsetY - mainBefore.offsetY) < 0.01,
      `Expected outer vertical scroller to stay at ${mainBefore.offsetY}`,
    );

    for (let i = 0; i < 4; i++) renderer.nativeSimulateScrollWheel(rx, ry, 0, -36);
    renderer.dispatchNativeEvents();
    renderer.flush();
    const mainAfterVert = renderer.getScrollState('main-scroll');
    assert(mainAfterVert && mainAfterVert.offsetY < -40, 'Expected vertical wheel to bubble');
    console.log(
      `[5/5] Diagonal scroll arbitration passed: diag (-40,-3)x6 -> railX=${railAfterDiag.offsetX.toFixed(1)}, mainY=${mainAfterDiag.offsetY.toFixed(1)}; vert (0,-36)x4 -> mainY=${mainAfterVert.offsetY.toFixed(1)}`,
    );
  });
}

try {
  await checkNoopBatchSuppression();
  await checkPortalSubtreeReplayAndBackdropCache();
  await checkNonModalHoverPixelIdentity();
  await checkDiagonalScrollArbitration();
} finally {
  if (!KEEP_SHOTS) rmSync(SHOT_DIR, { recursive: true, force: true });
  else console.log(`Saved screenshots to ${SHOT_DIR}`);
}
