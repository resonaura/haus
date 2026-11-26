/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import sharp from 'sharp';
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { defaults } from '@haus/ha/view/preferences';
import { SCROLL_SHADOW_PRESETS } from '@haus/ui';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { corners, px, rgba, SolidMaterial } from '@haus/ui/ir';
import { HausUiProvider, ScrollView } from '@haus/ui/primitives';
import { requireGpuiBun } from '../../src/gpui/bun.js';
import { HomeWorkspace } from '../../src/gpui/home/workspace.js';

requireGpuiBun();
assert(
  hasNativeTestRenderer,
  'GPUIX native test renderer is required for check-masking-and-scroll-shadow',
);

const KEEP_SHOTS = process.env.HAUS_KEEP_SHOTS === '1';
const SHOT_DIR = resolve('/tmp/haus-masking-scroll-check');
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

async function sampleLogicalPixel(
  pngPath: string,
  logicalWidth: number,
  x: number,
  y: number,
): Promise<[number, number, number, number]> {
  const meta = await sharp(pngPath).metadata();
  const imgWidth = meta.width ?? logicalWidth;
  const imgHeight = meta.height ?? logicalWidth;
  const scale = imgWidth / logicalWidth;
  const pxX = Math.max(0, Math.min(imgWidth - 1, Math.round(x * scale)));
  const pxY = Math.max(0, Math.min(imgHeight - 1, Math.round(y * scale)));
  const { data } = await sharp(pngPath)
    .extract({ left: pxX, top: pxY, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 255];
}

async function createSolidPngDataUri(r: number, g: number, b: number): Promise<string> {
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r, g, b, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function checkRoundedOverflowMaskingAndPartialScroll(): Promise<void> {
  const greenPng = await createSolidPngDataUri(32, 232, 96);
  const shotPath = resolve(SHOT_DIR, 'masking-showcase.png');

  await withRoot({ width: 680, height: 320 }, async ({ renderer, render }) => {
    render(
      createElement(HausUiProvider, {
        contentHost: GPUIX_CONTENT_HOST,
        mode: 'dark',
        children: createElement(
          'div',
          {
            style: {
              width: 680,
              height: 320,
              display: 'flex',
              flexDirection: 'row',
              gap: 24,
              padding: 24,
              backgroundColor: '#12141a',
            },
          },
          // Card 1: overflow: hidden + borderRadius + border masking a full-bleed square red div
          createElement(
            'div',
            {
              testId: 'card-div',
              style: {
                width: 160,
                height: 120,
                overflow: 'hidden',
                borderRadius: 28,
                cornerSmoothing: 0.6,
                borderWidth: 2,
                borderColor: '#55aaff',
                backgroundColor: '#1c202a',
              },
            },
            createElement('div', {
              style: { width: 160, height: 120, backgroundColor: '#ff2222' },
            }),
          ),
          // Card 2: overflow: hidden + borderRadius masking an unrounded <img>
          createElement(
            'div',
            {
              testId: 'card-img',
              style: {
                width: 160,
                height: 120,
                overflow: 'hidden',
                borderRadius: 28,
                cornerSmoothing: 0.6,
                backgroundColor: '#1c202a',
              },
            },
            createElement('img', {
              src: greenPng,
              objectFit: 'cover',
              style: { width: 160, height: 120 },
            }),
          ),
          // Card 3: partially scrolled tall rounded card must NOT distort top clip into fake corners
          createElement(
            'div',
            {
              testId: 'partial-scroll',
              style: {
                width: 160,
                height: 120,
                overflowY: 'scroll',
                overflowX: 'hidden',
                scrollId: 'partial-scroll',
                backgroundColor: '#12141a',
              },
            },
            createElement(
              'div',
              {
                style: {
                  width: 160,
                  height: 160,
                  flexShrink: 0,
                  overflow: 'hidden',
                  borderRadius: 28,
                  cornerSmoothing: 0.6,
                  backgroundColor: '#1c202a',
                },
              },
              createElement('div', {
                style: { width: 160, height: 160, backgroundColor: '#ffd426' },
              }),
            ),
          ),
        ),
      }),
    );

    renderer.flush();
    // Wait for image decode + flush, and scroll partial-scroll down by 40px.
    await sleep(60);
    assert.equal(renderer.scrollToId('partial-scroll', 0, -40), true);
    renderer.flush();
    renderer.captureScreenshot(shotPath);

    const cardDiv = boundsOf(renderer, 'card-div');
    const cardImg = boundsOf(renderer, 'card-img');
    const partialScroll = boundsOf(renderer, 'partial-scroll');

    // Card 1: red child clipped cleanly outside the 28px corner; center is red; border stays blue.
    const divCorner = await sampleLogicalPixel(shotPath, 680, cardDiv.x + 2, cardDiv.y + 2);
    const divCornerBr = await sampleLogicalPixel(
      shotPath,
      680,
      cardDiv.x + cardDiv.width - 2,
      cardDiv.y + cardDiv.height - 2,
    );
    const divCenter = await sampleLogicalPixel(shotPath, 680, cardDiv.x + 80, cardDiv.y + 60);
    const divBorderTop = await sampleLogicalPixel(shotPath, 680, cardDiv.x + 80, cardDiv.y + 1);
    assert(
      divCorner[0] < 45 && divCorner[1] < 45 && divCorner[2] < 55,
      `Card 1 top-left corner should be masked to dark backdrop, got ${JSON.stringify(divCorner)}`,
    );
    assert(
      divCornerBr[0] < 45 && divCornerBr[1] < 45 && divCornerBr[2] < 55,
      `Card 1 bottom-right corner should be masked to dark backdrop, got ${JSON.stringify(divCornerBr)}`,
    );
    assert(
      divCenter[0] > 220 && divCenter[1] < 60,
      `Card 1 center should show red child, got ${JSON.stringify(divCenter)}`,
    );
    assert(
      divBorderTop[2] > 200 && divBorderTop[0] < 130,
      `Card 1 top border should remain crisp blue above clipped child, got ${JSON.stringify(divBorderTop)}`,
    );

    // Card 2: unrounded green <img> clipped cleanly at corners.
    const imgCorner = await sampleLogicalPixel(shotPath, 680, cardImg.x + 2, cardImg.y + 2);
    const imgCenter = await sampleLogicalPixel(shotPath, 680, cardImg.x + 80, cardImg.y + 60);
    assert(
      imgCorner[1] < 45 && imgCorner[0] < 45,
      `Card 2 <img> top-left corner should be masked to dark backdrop, got ${JSON.stringify(imgCorner)}`,
    );
    assert(
      imgCenter[1] > 200 && imgCenter[0] < 80,
      `Card 2 <img> center should show green image, got ${JSON.stringify(imgCenter)}`,
    );

    // Card 3: scrolled down by 40px -> top-left of viewport is mid-card (y=43 of 160), so it MUST
    // stay yellow (straight scroll clip), while bottom-left (y=157 of 160) MUST be rounded-clipped!
    const scrolledTopLeft = await sampleLogicalPixel(
      shotPath,
      680,
      partialScroll.x + 3,
      partialScroll.y + 3,
    );
    const scrolledBottomLeft = await sampleLogicalPixel(
      shotPath,
      680,
      partialScroll.x + 2,
      partialScroll.y + partialScroll.height - 2,
    );
    assert(
      scrolledTopLeft[0] > 210 && scrolledTopLeft[1] > 180,
      `Partially scrolled card top-left must stay yellow (no fake corner), got ${JSON.stringify(scrolledTopLeft)}`,
    );
    assert(
      scrolledBottomLeft[0] < 50 && scrolledBottomLeft[1] < 50,
      `Partially scrolled card bottom-left must stay rounded-clipped, got ${JSON.stringify(scrolledBottomLeft)}`,
    );
  });
}

async function checkSmoothScrollShadowLifecycle(): Promise<void> {
  const shotTop = resolve(SHOT_DIR, 'scroll-shadow-top.png');
  const shotT0 = resolve(SHOT_DIR, 'scroll-shadow-mid-t0.png');
  const shotMid = resolve(SHOT_DIR, 'scroll-shadow-mid-anim.png');
  const shotSettled = resolve(SHOT_DIR, 'scroll-shadow-mid-settled.png');
  const shotBottom = resolve(SHOT_DIR, 'scroll-shadow-bottom.png');

  await withRoot({ width: 420, height: 300 }, async ({ renderer, render }) => {
    let commits = 0;

    function ScrollShadowFixture() {
      commits++;
      return createElement(HausUiProvider, {
        contentHost: GPUIX_CONTENT_HOST,
        mode: 'dark',
        children: createElement(
          'div',
          {
            style: {
              width: 420,
              height: 300,
              padding: 30,
              backgroundColor: '#101218',
            },
          },
          createElement(
            ScrollView,
            {
              id: 'ss-box',
              scrollId: 'ss-box',
              orientation: 'vertical',
              shadowSizePx: 40,
              transitionMs: 180,
              style: {
                layout: { width: px(360), height: px(240) },
                corners: corners(20),
                border: { width: 2, color: rgba(255, 255, 255, 1) },
                material: new SolidMaterial(rgba(16, 18, 24, 1)),
              },
            },
            createElement('div', {
              style: { width: 360, height: 960, flexShrink: 0, backgroundColor: '#38d9ff' },
            }),
          ),
        ),
      });
    }

    render(createElement(ScrollShadowFixture));
    renderer.flush();
    commits = 0;
    renderer.captureScreenshot(shotTop);

    const box = boundsOf(renderer, 'ss-box');

    // Frame 0 (unscrolled): top inner pixel full cyan, bottom inner pixel faded, border crisp white!
    const topAtStart = await sampleLogicalPixel(shotTop, 420, box.x + 180, box.y + 6);
    const botAtStart = await sampleLogicalPixel(shotTop, 420, box.x + 180, box.y + box.height - 6);
    const borderAtStart = await sampleLogicalPixel(
      shotTop,
      420,
      box.x + 180,
      box.y + box.height - 1,
    );
    assert(
      topAtStart[2] > 230 && topAtStart[1] > 190,
      `Frame 0 top edge should be unfaded cyan, got ${JSON.stringify(topAtStart)}`,
    );
    assert(
      botAtStart[2] < 130,
      `Frame 0 bottom edge should ALREADY be faded on first paint, got ${JSON.stringify(botAtStart)}`,
    );
    assert(
      borderAtStart[0] > 200 && borderAtStart[1] > 200 && borderAtStart[2] > 200,
      `Container border must stay crisp white (not faded), got ${JSON.stringify(borderAtStart)}`,
    );

    // Scroll mid-way: verify smooth time-based transition (t=0 -> ~45ms -> ~260ms settled).
    assert.equal(renderer.scrollToId('ss-box', 0, -320), true);
    renderer.flush();
    renderer.captureScreenshot(shotT0);

    await sleep(45);
    renderer.flush();
    renderer.captureScreenshot(shotMid);

    // Advance several ticks across ~240ms so exponential easing settles cleanly.
    for (let i = 0; i < 8; i++) {
      await sleep(32);
      renderer.flush();
    }
    renderer.captureScreenshot(shotSettled);

    const probeY = box.y + 12;
    const blueT0 = (await sampleLogicalPixel(shotT0, 420, box.x + 180, probeY))[2];
    const blueMid = (await sampleLogicalPixel(shotMid, 420, box.x + 180, probeY))[2];
    const blueSettled = (await sampleLogicalPixel(shotSettled, 420, box.x + 180, probeY))[2];
    const topEdgeSettled = await sampleLogicalPixel(shotSettled, 420, box.x + 180, box.y + 5);

    assert(
      blueT0 > blueMid && blueMid > blueSettled,
      `Top scroll fade must transition smoothly over time: t0=${blueT0}, mid=${blueMid}, settled=${blueSettled}`,
    );
    assert(
      topEdgeSettled[2] < 120,
      `Settled top edge should be strongly faded, got ${JSON.stringify(topEdgeSettled)}`,
    );

    // Scroll to bottom: bottom shadow fades smoothly back to 0 (full cyan at bottom!).
    assert.equal(renderer.scrollToId('ss-box', 0, -9000), true);
    for (let i = 0; i < 9; i++) {
      await sleep(32);
      renderer.flush();
    }
    renderer.captureScreenshot(shotBottom);
    const botAtEnd = await sampleLogicalPixel(shotBottom, 420, box.x + 180, box.y + box.height - 6);
    assert(
      botAtEnd[2] > 230 && botAtEnd[1] > 190,
      `Bottom edge should fade back to full cyan at bottom, got ${JSON.stringify(botAtEnd)}`,
    );
    assert.equal(
      commits,
      0,
      `Scroll shadow transitions must cause 0 React commits, got ${commits}`,
    );
  });
}

async function captureRealHomeWorkspaceShot(): Promise<void> {
  const shotPath = resolve(SHOT_DIR, 'gpui-home-scrolled.png');
  const snapshot = createDemoSnapshot();

  await withRoot({ width: 1280, height: 800 }, async ({ renderer, render }) => {
    render(
      createElement(HomeWorkspace, {
        snapshot,
        preferences: defaults,
        systemTheme: 'dark',
        demo: true,
        onControl: () => {},
        onFavorite: () => {},
        onTheme: () => {},
        onGrouping: () => {},
        onPreferencesPatch: () => {},
        onResetLightGroups: () => {},
        onToggleDemo: () => {},
        onManage: async () => {},
        onConnect: () => {},
        onRefresh: () => {},
        onDisconnect: () => {},
      }),
    );
    renderer.flush();
    await sleep(60);
    const scrolled = renderer.scrollToId('main-scroll', 0, -240);
    assert.equal(scrolled, true, 'HomeWorkspace main-scroll should be scrollable');
    for (let i = 0; i < 9; i++) {
      await sleep(30);
      renderer.flush();
    }
    const state = renderer.getScrollState('main-scroll');
    assert(
      state && state.topShadowOpacity === 0 && state.bottomShadowOpacity > 0,
      'main-scroll bottom shadow active while top edge stays clear for sticky HomeCategoryDock',
    );
    renderer.captureScreenshot(shotPath);
  });
}

try {
  await checkRoundedOverflowMaskingAndPartialScroll();
  await checkSmoothScrollShadowLifecycle();
  await captureRealHomeWorkspaceShot();
  console.log(
    `check-masking-and-scroll-shadow: Metal rounded corner masking (div/img/partial-scroll), first-frame & smooth ${SCROLL_SHADOW_PRESETS.main}px scroll shadows (0 commits), and HomeWorkspace verified`,
  );
} finally {
  if (!KEEP_SHOTS) {
    rmSync(SHOT_DIR, { recursive: true, force: true });
  }
}
