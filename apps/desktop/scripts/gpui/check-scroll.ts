/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createTestRoot, hasNativeTestRenderer, type TestRenderer } from '@gpuix/react/testing';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { px } from '@haus/ui/ir';
import { HausUiProvider, ScrollView } from '@haus/ui/primitives';
import { requireGpuiBun } from '../../src/gpui/bun.js';

requireGpuiBun();
assert(hasNativeTestRenderer, 'GPUIX native test renderer is required for check-scroll');

function withRoot(
  size: { width: number; height: number },
  fn: (ctx: ReturnType<typeof createTestRoot>) => void,
): void {
  const root = createTestRoot(size);
  try {
    fn(root);
  } finally {
    root.unmount();
  }
}

function boundsOf(renderer: TestRenderer, testId: string) {
  const el = renderer.findByTestId(testId);
  assert(el, `Missing testId="${testId}"`);
  const bounds = renderer.getElementBounds(el.id);
  assert(bounds && bounds.width > 0 && bounds.height > 0, `Missing bounds for "${testId}"`);
  return { id: el.id, bounds };
}

function offsetOf(renderer: TestRenderer, testId: string): [number, number] {
  const el = renderer.findByTestId(testId);
  assert(el, `Missing testId="${testId}"`);
  const off = renderer.getScrollOffset(el.id);
  assert(off, `Missing scroll offset for "${testId}"`);
  return off;
}

function wheel(
  renderer: TestRenderer,
  x: number,
  y: number,
  dx: number,
  dy: number,
  touchPhase?: 'started' | 'moved' | 'ended' | 'cancelled',
): void {
  renderer.nativeSimulateScrollWheel(x, y, dx, dy, undefined, touchPhase);
  renderer.dispatchNativeEvents();
  renderer.flush();
}

function checkVerticalIgnoresPureHorizontalWheel(): void {
  withRoot({ width: 500, height: 400 }, ({ renderer, render }) => {
    render(
      createElement(
        'div',
        {
          testId: 'vert',
          style: { width: 500, height: 400, overflowY: 'scroll' },
        },
        createElement('div', { style: { width: 400, height: 1400 } }),
      ),
    );
    renderer.flush();
    const { bounds } = boundsOf(renderer, 'vert');
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    for (let i = 0; i < 4; i++) wheel(renderer, cx, cy, -50, 0);
    const [, oy] = offsetOf(renderer, 'vert');
    assert.equal(oy, 0, 'pure horizontal wheel must not scroll vertical-only container');
  });
}

function checkHorizontalIgnoresPureVerticalWheel(): void {
  withRoot({ width: 500, height: 240 }, ({ renderer, render }) => {
    render(
      createElement(
        'div',
        {
          testId: 'horiz',
          style: {
            width: 500,
            height: 240,
            overflowX: 'scroll',
            display: 'flex',
            flexDirection: 'row',
          },
        },
        createElement('div', { style: { width: 1600, height: 200, flexShrink: 0 } }),
      ),
    );
    renderer.flush();
    const { bounds } = boundsOf(renderer, 'horiz');
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    for (let i = 0; i < 4; i++) wheel(renderer, cx, cy, 0, -50);
    const [ox] = offsetOf(renderer, 'horiz');
    assert.equal(ox, 0, 'pure vertical wheel must not scroll horizontal-only container');
  });
}

function checkNestedRailDiagonalRouting(): void {
  withRoot({ width: 600, height: 500 }, ({ renderer, render }) => {
    render(
      createElement(
        'div',
        {
          testId: 'main',
          style: {
            width: 600,
            height: 500,
            overflowY: 'scroll',
            display: 'flex',
            flexDirection: 'column',
          },
        },
        createElement(
          'div',
          {
            testId: 'rail',
            style: {
              width: 600,
              height: 80,
              overflowX: 'scroll',
              display: 'flex',
              flexDirection: 'row',
              flexShrink: 0,
            },
          },
          createElement('div', { style: { width: 1600, height: 70, flexShrink: 0 } }),
        ),
        createElement('div', { style: { width: 580, height: 1400, flexShrink: 0 } }),
      ),
    );
    renderer.flush();
    const railBox = boundsOf(renderer, 'rail').bounds;
    const rx = railBox.x + railBox.width / 2;
    const ry = railBox.y + railBox.height / 2;

    for (let i = 0; i < 5; i++) wheel(renderer, rx, ry, -40, -3);
    const [railAfterHoriz] = offsetOf(renderer, 'rail');
    const [, mainAfterHoriz] = offsetOf(renderer, 'main');
    assert(
      railAfterHoriz < -100,
      `horizontal-dominant diagonal should scroll rail, got ${railAfterHoriz}`,
    );
    assert.equal(
      mainAfterHoriz,
      0,
      'horizontal-dominant diagonal over rail must not scroll outer main',
    );

    for (let i = 0; i < 4; i++) wheel(renderer, rx, ry, -3, -40);
    const [railAfterVert] = offsetOf(renderer, 'rail');
    const [, mainAfterVert] = offsetOf(renderer, 'main');
    assert.equal(
      railAfterVert,
      railAfterHoriz,
      'vertical-dominant diagonal must not move horizontal rail',
    );
    assert(
      mainAfterVert < -100,
      `vertical-dominant diagonal should scroll main, got ${mainAfterVert}`,
    );
  });
}

function checkOverscrollChainingPolicies(): void {
  for (const mode of ['auto', 'contain', 'none'] as const) {
    withRoot({ width: 500, height: 500 }, ({ renderer, render }) => {
      render(
        createElement(
          'div',
          {
            testId: 'outer',
            style: {
              width: 500,
              height: 500,
              overflowY: 'scroll',
              display: 'flex',
              flexDirection: 'column',
            },
          },
          createElement(
            'div',
            {
              testId: 'inner',
              style: {
                width: 480,
                height: 180,
                overflowY: 'scroll',
                overscrollBehavior: mode,
                flexShrink: 0,
              },
            },
            createElement('div', { style: { width: 460, height: 300 } }),
          ),
          createElement('div', { style: { width: 480, height: 1200, flexShrink: 0 } }),
        ),
      );
      renderer.flush();
      const innerBox = boundsOf(renderer, 'inner').bounds;
      const cx = innerBox.x + innerBox.width / 2;
      const cy = innerBox.y + innerBox.height / 2;

      // Hit bottom of inner scroller then continue scrolling downward in subsequent gestures.
      for (let i = 0; i < 6; i++) {
        wheel(renderer, cx, cy, 0, -60, 'started');
        wheel(renderer, cx, cy, 0, 0, 'ended');
      }
      const [, innerY] = offsetOf(renderer, 'inner');
      const [, outerY] = offsetOf(renderer, 'outer');
      assert.equal(innerY, -120, `inner should clamp at maxY=-120 in mode=${mode}, got ${innerY}`);
      if (mode === 'auto') {
        assert(outerY < -50, `overscrollBehavior='auto' must chain to outer, got outerY=${outerY}`);
      } else {
        assert.equal(
          outerY,
          0,
          `overscrollBehavior='${mode}' must contain overscroll, got outerY=${outerY}`,
        );
      }
    });
  }
}

function checkScrollPolicies(): void {
  withRoot({ width: 500, height: 400 }, ({ renderer, render }) => {
    render(
      createElement(
        'div',
        { style: { width: 500, height: 400, display: 'flex', flexDirection: 'column', gap: 10 } },
        createElement(
          'div',
          {
            testId: 'p-horiz',
            style: { width: 400, height: 110, overflow: 'scroll', scrollPolicy: 'horizontal' },
          },
          createElement('div', { style: { width: 900, height: 400 } }),
        ),
        createElement(
          'div',
          {
            testId: 'p-vert',
            style: { width: 400, height: 110, overflow: 'scroll', scrollPolicy: 'vertical' },
          },
          createElement('div', { style: { width: 900, height: 400 } }),
        ),
        createElement(
          'div',
          {
            testId: 'p-free',
            style: { width: 400, height: 110, overflow: 'scroll', scrollPolicy: 'free' },
          },
          createElement('div', { style: { width: 900, height: 400 } }),
        ),
      ),
    );
    renderer.flush();

    const hBox = boundsOf(renderer, 'p-horiz').bounds;
    wheel(renderer, hBox.x + 50, hBox.y + 40, 0, -40, 'started');
    wheel(renderer, hBox.x + 50, hBox.y + 40, 0, 0, 'ended');
    assert.deepEqual(
      offsetOf(renderer, 'p-horiz'),
      [0, 0],
      "scrollPolicy='horizontal' must block vertical scroll",
    );
    wheel(renderer, hBox.x + 50, hBox.y + 40, -35, 0, 'started');
    wheel(renderer, hBox.x + 50, hBox.y + 40, 0, 0, 'ended');
    assert.deepEqual(
      offsetOf(renderer, 'p-horiz'),
      [-35, 0],
      "scrollPolicy='horizontal' must allow X only",
    );

    const vBox = boundsOf(renderer, 'p-vert').bounds;
    wheel(renderer, vBox.x + 50, vBox.y + 40, -40, 0, 'started');
    wheel(renderer, vBox.x + 50, vBox.y + 40, 0, 0, 'ended');
    assert.deepEqual(
      offsetOf(renderer, 'p-vert'),
      [0, 0],
      "scrollPolicy='vertical' must block horizontal scroll",
    );
    wheel(renderer, vBox.x + 50, vBox.y + 40, 0, -35, 'started');
    wheel(renderer, vBox.x + 50, vBox.y + 40, 0, 0, 'ended');
    assert.deepEqual(
      offsetOf(renderer, 'p-vert'),
      [0, -35],
      "scrollPolicy='vertical' must allow Y only",
    );

    const fBox = boundsOf(renderer, 'p-free').bounds;
    wheel(renderer, fBox.x + 50, fBox.y + 40, -35, -25, 'started');
    wheel(renderer, fBox.x + 50, fBox.y + 40, 0, 0, 'ended');
    assert.deepEqual(
      offsetOf(renderer, 'p-free'),
      [-35, -25],
      "scrollPolicy='free' must allow diagonal 2D scroll",
    );
  });
}

function checkTouchPhaseAxisLockAndUnlock(): void {
  withRoot({ width: 400, height: 400 }, ({ renderer, render }) => {
    render(
      createElement(
        'div',
        {
          testId: 'pad',
          style: { width: 400, height: 400, overflow: 'scroll', scrollPolicy: 'directionLocked' },
        },
        createElement('div', { style: { width: 1200, height: 1200 } }),
      ),
    );
    renderer.flush();
    const box = boundsOf(renderer, 'pad').bounds;
    const cx = box.x + 100;
    const cy = box.y + 100;

    wheel(renderer, cx, cy, -30, -2, 'started');
    wheel(renderer, cx, cy, -10, -12, 'moved');
    wheel(renderer, cx, cy, -5, -4, 'moved');
    wheel(renderer, cx, cy, 0, 0, 'ended');
    const [oxLocked, oyLocked] = offsetOf(renderer, 'pad');
    assert.equal(oxLocked, -45, `horizontal gesture should accumulate X, got ${oxLocked}`);
    assert.equal(
      oyLocked,
      0,
      `touchPhase axis lock must hold vertical=0 during gesture, got ${oyLocked}`,
    );

    wheel(renderer, cx, cy, 0, -40, 'started');
    wheel(renderer, cx, cy, 0, 0, 'ended');
    const [oxNext, oyNext] = offsetOf(renderer, 'pad');
    assert.equal(oxNext, -45, 'new vertical gesture after ended must unlock Y');
    assert.equal(oyNext, -40, 'new vertical gesture should scroll vertically');
  });
}

function checkFractionalOffsetsAndClamp(): void {
  withRoot({ width: 300, height: 300 }, ({ renderer, render }) => {
    render(
      createElement(
        'div',
        { testId: 'clamp', style: { width: 300, height: 300, overflowY: 'scroll' } },
        createElement('div', { style: { width: 300, height: 500 } }),
      ),
    );
    renderer.flush();
    const box = boundsOf(renderer, 'clamp').bounds;
    const cx = box.x + 100;
    const cy = box.y + 100;

    wheel(renderer, cx, cy, 0, -12.375);
    const [, oyFrac] = offsetOf(renderer, 'clamp');
    assert(Math.abs(oyFrac - -12.375) < 0.01, `fractional delta must be preserved, got ${oyFrac}`);

    wheel(renderer, cx, cy, 0, 500);
    assert.equal(offsetOf(renderer, 'clamp')[1], 0, 'scrolling past top must clamp at 0');

    wheel(renderer, cx, cy, 0, -5000);
    assert.equal(
      offsetOf(renderer, 'clamp')[1],
      -200,
      'scrolling past bottom must clamp at -maxY=-200',
    );
  });
}

function checkSharedStateBindAndShadows(): void {
  withRoot({ width: 500, height: 420 }, ({ renderer, render }) => {
    let commits = 0;
    function ScrollDashboard() {
      commits++;
      return createElement(HausUiProvider, {
        contentHost: GPUIX_CONTENT_HOST,
        mode: 'dark',
        children: createElement(
          'div',
          { style: { width: 500, height: 420, display: 'flex', flexDirection: 'column', gap: 12 } },
          createElement('div', {
            testId: 'progress-bar',
            style: {
              width: 0,
              height: 8,
              backgroundColor: '#3b82f6',
              scrollBind: {
                sourceId: 'main-scroll',
                metric: 'progressY',
                property: 'width',
                inputRange: [0, 1],
                outputRange: [0, 200],
                clamp: true,
              },
            },
          }),
          createElement(
            ScrollView,
            {
              id: 'ui-scroll',
              scrollId: 'main-scroll',
              shadowSizePx: 24,
              style: { layout: { width: px(460), height: px(300) } },
            },
            createElement('div', { style: { width: 460, height: 900, flexShrink: 0 } }),
          ),
        ),
      });
    }

    render(createElement(ScrollDashboard));
    renderer.flush();
    commits = 0;

    const s0 = renderer.getScrollState('main-scroll');
    assert(s0, 'missing NativeScrollState for main-scroll');
    assert.equal(s0.maxY, 600);
    assert.equal(s0.progressY, 0);
    assert.equal(s0.canScrollTop, false);
    assert.equal(s0.canScrollBottom, true);
    assert(
      s0.topShadowOpacity === 0,
      `expected topShadowOpacity === 0 at top, got ${s0.topShadowOpacity}`,
    );
    assert(
      s0.bottomShadowOpacity > 0,
      `expected bottom shadow > 0 at top, got ${s0.bottomShadowOpacity}`,
    );

    assert.equal(renderer.scrollToId('main-scroll', 0, -300), true);
    renderer.flush();

    const sMid = renderer.getScrollState('main-scroll');
    assert(sMid);
    assert(Math.abs(sMid.progressY - 0.5) < 0.02, `expected progressY ~0.5, got ${sMid.progressY}`);
    assert.equal(sMid.canScrollTop, true);
    assert.equal(sMid.canScrollBottom, true);
    assert(
      sMid.topShadowOpacity > 0,
      `expected top shadow > 0 mid-scroll, got ${sMid.topShadowOpacity}`,
    );
    assert(
      sMid.bottomShadowOpacity > 0,
      `expected bottom shadow > 0 mid-scroll, got ${sMid.bottomShadowOpacity}`,
    );

    const barMid = boundsOf(renderer, 'progress-bar').bounds;
    assert(
      barMid.width >= 95 && barMid.width <= 105,
      `scrollBind width mid-scroll expected ~100, got ${barMid.width}`,
    );

    assert.equal(renderer.scrollToId('main-scroll', 0, -9000), true);
    renderer.flush();

    const sEnd = renderer.getScrollState('main-scroll');
    assert(sEnd);
    assert.equal(sEnd.offsetY, -600);
    assert.equal(sEnd.progressY, 1);
    assert.equal(sEnd.canScrollTop, true);
    assert.equal(sEnd.canScrollBottom, false);
    assert(
      sEnd.topShadowOpacity > 0,
      `expected top shadow > 0 at end, got ${sEnd.topShadowOpacity}`,
    );
    assert(
      sEnd.bottomShadowOpacity === 0,
      `bottom shadow must fade to 0 at bottom, got ${sEnd.bottomShadowOpacity}`,
    );

    const barEnd = boundsOf(renderer, 'progress-bar').bounds;
    assert(
      Math.abs(barEnd.width - 200) < 2,
      `scrollBind width at bottom expected 200, got ${barEnd.width}`,
    );
    assert.equal(commits, 0, `scroll must cause 0 React commits, got ${commits}`);
  });
}

checkVerticalIgnoresPureHorizontalWheel();
checkHorizontalIgnoresPureVerticalWheel();
checkNestedRailDiagonalRouting();
checkOverscrollChainingPolicies();
checkScrollPolicies();
checkTouchPhaseAxisLockAndUnlock();
checkFractionalOffsetsAndClamp();
checkSharedStateBindAndShadows();
console.log('check-scroll: all 8 deterministic scroll scenarios passed');
