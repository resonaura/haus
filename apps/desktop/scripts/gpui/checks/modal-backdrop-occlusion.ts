/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createElement, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPopup, DialogPortal } from '@gpuix/react/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@gpuix/react/select';
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { defaults } from '@haus/ha/view/preferences';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { insets, px } from '@haus/ui/ir';
import {
  Box,
  HausButton,
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
assert(
  hasNativeTestRenderer,
  'GPUIX native test renderer is required for modal-backdrop-occlusion check',
);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function withRoot(
  size: { width: number; height: number },
  fn: (ctx: ReturnType<typeof createTestRoot>) => void | Promise<void>,
): Promise<void> {
  const root = createTestRoot(size);
  return Promise.resolve(fn(root)).finally(() => root.unmount());
}

function centerOf(
  renderer: ReturnType<typeof createTestRoot>['renderer'],
  testId: string,
): [number, number] {
  const el = renderer.findByTestId(testId);
  assert(el, `Missing testId="${testId}"`);
  const bounds = renderer.getElementBounds(el.id);
  assert(bounds && bounds.width > 0 && bounds.height > 0, `Missing bounds for "${testId}"`);
  return [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
}

function humanClick(
  renderer: ReturnType<typeof createTestRoot>['renderer'],
  x: number,
  y: number,
): void {
  renderer.nativeSimulateMouseDown(x, y, 0);
  renderer.dispatchNativeEvents();
  renderer.flush();
  renderer.nativeSimulateMouseUp(x, y, 0);
  renderer.dispatchNativeEvents();
  renderer.flush();
}

async function testDimHausDialogMultiFrameDismiss(): Promise<void> {
  let bgClicks = 0;
  let bgEnters = 0;
  let modalClicks = 0;

  await withRoot({ width: 900, height: 640 }, async ({ renderer, render }) => {
    function Demo() {
      const [open, setOpen] = useState(true);
      return createElement(
        HausUiProvider,
        {
          mode: 'dark',
          viewport: { width: 900, height: 640, scale: 1, reducedMotion: true },
          contentHost: GPUIX_CONTENT_HOST,
        },
        createElement(
          Box,
          { style: { layout: { width: px(900), height: px(640), position: 'relative' } } },
          createElement(
            HausScrollArea,
            { id: 'bg-scroll', style: { layout: { width: px(900), height: px(640) } } },
            createElement(
              Stack,
              { gapPx: 16, style: { layout: { padding: insets(24), minHeight: px(1600) } } },
              createElement(
                Pressable,
                {
                  id: 'bg-target',
                  onActivate: () => {
                    bgClicks += 1;
                  },
                  onPointerEnter: () => {
                    bgEnters += 1;
                  },
                  style: { layout: { width: px(220), height: px(80) } },
                },
                createElement(Text, null, 'Background action'),
              ),
            ),
          ),
          open
            ? createElement(
                HausDialog,
                { title: 'Dim Modal', backdrop: 'dim', onClose: () => setOpen(false) },
                createElement(
                  HausButton,
                  {
                    id: 'inside-modal-btn',
                    onPress: () => {
                      modalClicks += 1;
                    },
                  },
                  'Inside modal',
                ),
              )
            : null,
        ),
      );
    }

    render(createElement(Demo));
    await sleep(30);
    renderer.flush();

    const backdrop = renderer.findByTestId('dialog-backdrop');
    assert(backdrop, 'Missing dialog-backdrop');
    assert.equal(
      backdrop.style.backdropBlur,
      undefined,
      'backdrop="dim" must have NO backdropBlur',
    );
    assert(
      typeof backdrop.style.backgroundColor === 'string' &&
        backdrop.style.backgroundColor.includes('rgba('),
      `Expected semi-transparent backdrop fill, got ${String(backdrop.style.backgroundColor)}`,
    );

    const [bgX, bgY] = centerOf(renderer, 'bg-target');
    const [insideX, insideY] = centerOf(renderer, 'inside-modal-btn');

    renderer.nativeSimulateMouseMove(bgX, bgY);
    renderer.dispatchNativeEvents();
    renderer.flush();
    assert.equal(bgEnters, 0, 'Background must NOT receive hover behind dim backdrop');

    renderer.nativeSimulateScrollWheel(bgX, bgY, 0, -120);
    renderer.dispatchNativeEvents();
    renderer.flush();
    const scrollWhileOpen = renderer.getScrollState('bg-scroll');
    assert(
      !scrollWhileOpen || Math.abs(scrollWhileOpen.offsetY) <= 0.5,
      `Wheel must NOT scroll page behind dim backdrop, got ${JSON.stringify(scrollWhileOpen)}`,
    );

    humanClick(renderer, insideX, insideY);
    assert.equal(modalClicks, 1, 'Button inside modal must still click normally');
    assert.equal(bgClicks, 0, 'Clicking inside modal must not leak to background');

    // Realistic multi-frame click on semi-transparent backdrop over bg-target:
    // mouseDown closes & unmounts the modal; mouseUp must NOT click bg-target.
    humanClick(renderer, bgX, bgY);
    await sleep(20);
    renderer.flush();
    assert.equal(renderer.findByTestId('dialog-panel'), undefined, 'Backdrop click closes modal');
    assert.equal(bgClicks, 0, 'Dismissing modal over bg-target must NOT click bg-target');

    humanClick(renderer, bgX, bgY);
    assert.equal(bgClicks, 1, 'bg-target must be clickable after modal closes');
  });
}

async function testNonDismissableTransparentAndDimBackdrops(): Promise<void> {
  for (const bgFill of ['rgba(0, 0, 0, 0.35)', 'transparent']) {
    let bgClicks = 0;
    let bgEnters = 0;
    let linkClicks = 0;
    let outsideDrops = 0;
    let insideClicks = 0;

    await withRoot({ width: 800, height: 560 }, async ({ renderer, render }) => {
      render(
        createElement(
          'div',
          { style: { width: 800, height: 560, position: 'relative' } },
          createElement(
            'div',
            {
              testId: 'bg-scroll-raw',
              style: { width: 800, height: 560, overflowY: 'scroll', scrollId: 'bg-scroll-raw' },
            },
            createElement(
              'div',
              { style: { height: 1400, padding: 20, gap: 12, flexDirection: 'column' } },
              createElement(
                'div',
                {
                  testId: 'raw-bg-btn',
                  style: { width: 220, height: 70, backgroundColor: '#1e3a5f' },
                  onClick: () => {
                    bgClicks += 1;
                  },
                  onMouseEnter: () => {
                    bgEnters += 1;
                  },
                  onMouseDownOutside: () => {
                    outsideDrops += 1;
                  },
                },
                createElement('text', null, 'Selectable behind modal'),
              ),
              createElement('markdown', {
                testId: 'raw-bg-md',
                source: 'Visit [Haus](https://example.com) behind backdrop',
                onLinkClick: () => {
                  linkClicks += 1;
                },
                style: { width: 320, height: 36 },
              }),
            ),
          ),
          createElement(
            Dialog,
            { open: true, disablePointerDismissal: true },
            createElement(
              DialogPortal,
              null,
              createElement(DialogBackdrop, {
                testId: 'raw-backdrop',
                style: { backgroundColor: bgFill },
              }),
              createElement(
                DialogPopup,
                {
                  testId: 'raw-popup',
                  style: { width: 260, height: 120, padding: 16, backgroundColor: '#1e293b' },
                },
                createElement(
                  'div',
                  {
                    testId: 'raw-popup-btn',
                    style: { width: 120, height: 36, backgroundColor: '#334155' },
                    onClick: () => {
                      insideClicks += 1;
                    },
                  },
                  createElement('text', null, 'Modal action'),
                ),
              ),
            ),
          ),
        ),
      );
      await sleep(25);
      renderer.flush();

      const [btnX, btnY] = centerOf(renderer, 'raw-bg-btn');
      const [mdX, mdY] = centerOf(renderer, 'raw-bg-md');
      const [popupBtnX, popupBtnY] = centerOf(renderer, 'raw-popup-btn');

      renderer.nativeSimulateMouseMove(btnX, btnY);
      humanClick(renderer, btnX, btnY);
      renderer.nativeSimulateClick(btnX, btnY, 0);
      renderer.nativeSimulateScrollWheel(btnX, btnY, 0, -140);
      // Drag across background text behind backdrop to confirm no selection leaks.
      renderer.nativeSimulateMouseDown(btnX - 40, btnY, 0);
      renderer.nativeSimulateMouseMove(btnX + 40, btnY, 0);
      renderer.nativeSimulateMouseUp(btnX + 40, btnY, 0);
      // Click directly over background markdown link.
      humanClick(renderer, mdX - 40, mdY);
      // Click inside popup too.
      humanClick(renderer, popupBtnX, popupBtnY);
      renderer.dispatchNativeEvents();
      renderer.flush();

      assert.equal(bgClicks, 0, `bgClicks must stay 0 for backdrop fill=${bgFill}`);
      assert.equal(bgEnters, 0, `bgEnters must stay 0 for backdrop fill=${bgFill}`);
      assert.equal(linkClicks, 0, `linkClicks must stay 0 for backdrop fill=${bgFill}`);
      assert.equal(outsideDrops, 0, `lower-layer mouseDownOutside must stay 0 for fill=${bgFill}`);
      assert.equal(
        renderer.getSelectedText(),
        null,
        `text selection must stay null behind backdrop fill=${bgFill}`,
      );
      const scroll = renderer.getScrollState('bg-scroll-raw');
      assert(
        !scroll || Math.abs(scroll.offsetY) <= 0.5,
        `wheel must not scroll behind backdrop fill=${bgFill}`,
      );
      assert.equal(insideClicks, 1, `popup button must work for backdrop fill=${bgFill}`);
    });
  }
}

async function testFixedLayerWithoutAnchoredAndNestedSelect(): Promise<void> {
  let bgClicks = 0;
  let selectClosed = false;

  await withRoot({ width: 700, height: 500 }, async ({ renderer, render }) => {
    function Demo() {
      const [fixedPointerNone, setFixedPointerNone] = useState(false);
      return createElement(
        'div',
        { style: { width: 700, height: 500, position: 'relative' } },
        createElement(
          'div',
          { style: { width: 700, height: 500, overflowY: 'scroll', scrollId: 'fixed-bg-scroll' } },
          createElement(
            'div',
            { style: { height: 1200, padding: 24 } },
            createElement(
              'div',
              {
                testId: 'fixed-bg-btn',
                style: { width: 200, height: 64, backgroundColor: '#1e3a5f' },
                onClick: () => {
                  bgClicks += 1;
                },
              },
              createElement('text', null, 'Behind fixed'),
            ),
          ),
        ),
        createElement('div', {
          testId: 'fixed-scrim',
          style: {
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: 'rgba(2, 6, 23, 0.4)',
            ...(fixedPointerNone ? { pointerEvents: 'none' as const } : {}),
          },
        }),
        createElement(
          'div',
          {
            testId: 'toggle-none',
            style: { position: 'fixed', top: 420, left: 20, width: 120, height: 32 },
            onClick: () => setFixedPointerNone(true),
          },
          createElement('text', null, 'Opt out'),
        ),
      );
    }

    render(createElement(Demo));
    await sleep(20);
    renderer.flush();

    const [bx, by] = centerOf(renderer, 'fixed-bg-btn');
    humanClick(renderer, bx, by);
    renderer.nativeSimulateScrollWheel(bx, by, 0, -120);
    renderer.dispatchNativeEvents();
    renderer.flush();
    assert.equal(bgClicks, 0, 'position: fixed semi-transparent layer without blur blocks clicks');
    const scroll = renderer.getScrollState('fixed-bg-scroll');
    assert(
      !scroll || Math.abs(scroll.offsetY) <= 0.5,
      'position: fixed semi-transparent layer without blur blocks wheel scroll',
    );

    const [tx, ty] = centerOf(renderer, 'toggle-none');
    humanClick(renderer, tx, ty);
    await sleep(20);
    renderer.flush();
    humanClick(renderer, bx, by);
    assert.equal(bgClicks, 1, 'position: fixed with pointerEvents: "none" passes clicks through');
  });

  await withRoot({ width: 700, height: 500 }, async ({ renderer, render }) => {
    function NestedDemo() {
      const [selectOpen, setSelectOpen] = useState(true);
      return createElement(
        Dialog,
        { open: true, disablePointerDismissal: true },
        createElement(
          DialogPortal,
          null,
          createElement(DialogBackdrop, { style: { backgroundColor: 'rgba(0, 0, 0, 0.4)' } }),
          createElement(
            DialogPopup,
            {
              testId: 'nested-popup',
              style: { width: 340, height: 220, padding: 16, backgroundColor: '#1e293b' },
            },
            createElement(
              Select,
              {
                items: [
                  { value: 'a', label: 'Alpha' },
                  { value: 'b', label: 'Beta' },
                ],
                defaultValue: 'a',
                open: selectOpen,
                onOpenChange: (next: boolean) => {
                  setSelectOpen(next);
                  if (!next) selectClosed = true;
                },
              },
              createElement(
                SelectTrigger,
                { style: { width: 120, height: 30, backgroundColor: '#334155' } },
                createElement(SelectValue, null),
              ),
              createElement(
                SelectContent,
                { style: { width: 120, backgroundColor: '#0f172a' } },
                createElement(SelectItem, { value: 'a', style: { height: 28 } }, 'Alpha'),
                createElement(SelectItem, { value: 'b', style: { height: 28 } }, 'Beta'),
              ),
            ),
          ),
        ),
      );
    }

    render(createElement(NestedDemo));
    await sleep(20);
    renderer.flush();
    const popup = renderer.getElementBounds(renderer.findByTestId('nested-popup')!.id)!;
    humanClick(renderer, popup.x + popup.width - 12, popup.y + popup.height - 12);
    await sleep(20);
    renderer.flush();
    assert.equal(selectClosed, true, 'Select inside modal Dialog dismisses on outside click');
  });
}

async function testRealHomeWorkspaceModalBackdrop(): Promise<void> {
  const snapshot = createDemoSnapshot();
  const prefs = { ...defaults, theme: 'dark' as const };
  let controlCalls = 0;

  await withRoot({ width: 1280, height: 840 }, async ({ renderer, render }) => {
    render(
      createElement(HomeWorkspace, {
        snapshot,
        preferences: prefs,
        systemTheme: 'dark',
        reducedTransparency: true,
        demo: true,
        onControl: () => {
          controlCalls += 1;
        },
        onTheme: () => undefined,
        onGrouping: () => undefined,
      }),
    );
    await sleep(60);
    renderer.flush();

    const [searchX, searchY] = centerOf(renderer, 'home-search');
    humanClick(renderer, searchX, searchY);
    await sleep(40);
    renderer.flush();

    const backdrop = renderer.findByTestId('dialog-backdrop');
    assert(backdrop, 'Spotlight dialog-backdrop should be mounted');
    assert.equal(backdrop.style.backdropBlur, undefined, 'reducedTransparency has NO backdropBlur');

    const [bx, by] = centerOf(renderer, 'home-search');
    const panelBounds = renderer.getElementBounds(renderer.findByTestId('dialog-panel')!.id)!;
    assert(
      by < panelBounds.y || by > panelBounds.y + panelBounds.height || bx < panelBounds.x,
      'home-search should sit under backdrop outside dialog-panel',
    );

    humanClick(renderer, bx, by);
    await sleep(40);
    renderer.flush();
    assert.equal(
      renderer.findByTestId('dialog-panel'),
      undefined,
      'Clicking backdrop over home-search closes Spotlight without re-triggering home-search',
    );
    assert.equal(controlCalls, 0, 'No device controls should fire during backdrop dismissal');
  });
}

async function main(): Promise<void> {
  await testDimHausDialogMultiFrameDismiss();
  await testNonDismissableTransparentAndDimBackdrops();
  await testFixedLayerWithoutAnchoredAndNestedSelect();
  await testRealHomeWorkspaceModalBackdrop();
  console.log(JSON.stringify({ ok: true, cases: 4 }));
}

await main();
