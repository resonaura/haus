/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing';
import { createDemoSnapshot } from '@haus/ha/view/demo/snapshot';
import { defaults } from '@haus/ha/view/preferences';
import { HomeWorkspace } from '../../src/gpui/home/workspace.js';

assert(hasNativeTestRenderer, 'The native GPUIX test renderer is required');

// Normal host containers exercise native clipping without declaring row indices
// or listening to scroll events in React.
{
  const root = createTestRoot({ width: 500, height: 400 });
  try {
    let layouts = 0;
    root.render(
      createElement(
        'div',
        { testId: 'outer', style: { width: 500, height: 400, overflowY: 'scroll' } },
        createElement('div', { style: { height: 520 } }),
        createElement(
          'div',
          {
            testId: 'inner',
            style: { width: 470, height: 100, overflowX: 'scroll' },
            onLayout: () => layouts++,
          },
          createElement(
            'div',
            {
              testId: 'offscreen-button',
              tabIndex: 0,
              role: 'button',
              style: { width: 800, height: 90 },
            },
            createElement('text', null, 'Controls'),
          ),
        ),
        createElement(
          'div',
          { style: { height: 400, display: 'grid', gridTemplateColumns: 2 } },
          createElement('div', { style: { height: 160 } }, 'Left'),
          createElement('div', { style: { height: 160 } }, 'Right'),
        ),
      ),
    );
    const { renderer } = root;
    renderer.dispatchNativeEvents();
    renderer.flush();
    assert(layouts > 0, 'A clipped node still reports its layout');
    const outer = renderer.findByTestId('outer');
    const inner = renderer.findByTestId('inner');
    const button = renderer.findByTestId('offscreen-button');
    assert(outer && inner && button);
    renderer.focusElement(button.id);
    assert.equal(renderer.getFocusedElementId(), button.id);
    renderer.resetPerfMetrics();
    renderer.nativeSimulateScrollWheel(250, 200, 0, -380);
    renderer.dispatchNativeEvents();
    assert.equal(renderer.getScrollOffset(outer.id)?.[1], -380);
    renderer.nativeSimulateScrollWheel(250, 180, -140, 0);
    renderer.dispatchNativeEvents();
    assert.equal(renderer.getScrollOffset(inner.id)?.[0], -140);
    assert.equal(renderer.getScrollOffset(outer.id)?.[1], -380);
    assert.equal(renderer.getPerfMetrics().applyBatchCount, 0);
  } finally {
    root.unmount();
  }
}

// Verify Tab focus traversal across collapsed offscreen grid runs and
// self-healing re-materialization when an upstream header shrinks.
{
  const root = createTestRoot({ width: 500, height: 320 });
  const renderGridPage = (headerHeight: number) =>
    createElement(
      'div',
      {
        testId: 'grid-scroller',
        style: { width: 500, height: 320, overflowY: 'scroll' },
      },
      createElement('div', {
        testId: 'lead-header',
        tabIndex: 0,
        style: { height: headerHeight },
      }),
      createElement(
        'div',
        {
          testId: 'card-grid',
          style: { display: 'grid', gridTemplateColumns: 2, gap: 10 },
        },
        ...Array.from({ length: 40 }, (_, index) =>
          createElement(
            'div',
            {
              key: index,
              testId: `card-${index}`,
              tabIndex: 0,
              style: { height: 100 },
            },
            createElement('text', null, `Card ${index}`),
          ),
        ),
      ),
    );
  try {
    const { renderer } = root;
    root.render(renderGridPage(40));
    renderer.flush();
    // Second flush engages viewport virtualization after initial layout capture.
    renderer.flush();
    const header = renderer.findByTestId('lead-header');
    const lastCard = renderer.findByTestId('card-39');
    assert(header && lastCard);
    // Focus header, Shift+Tab wraps directly into the last collapsed offscreen card.
    renderer.focusElement(header.id);
    assert.equal(renderer.getFocusedElementId(), header.id);
    renderer.focusPrevious();
    renderer.flush();
    assert.equal(
      renderer.getFocusedElementId(),
      lastCard.id,
      'Shift+Tab from the header should wrap to the final collapsed grid card',
    );
    // Expanding header pushes cards offscreen, then shrinking header brings card-0 back cleanly.
    root.render(renderGridPage(900));
    renderer.flush();
    renderer.flush();
    root.render(renderGridPage(40));
    renderer.flush();
    renderer.flush();
    const firstCard = renderer.findByTestId('card-0');
    assert(firstCard);
    const firstBounds = renderer.getElementBounds(firstCard.id);
    assert(
      firstBounds && Math.abs(firstBounds.y - 40) <= 1,
      `Shrinking the upstream header should rematerialize card-0 at y=40 (got ${firstBounds?.y})`,
    );
  } finally {
    root.unmount();
  }
}

// Verify wheel scrolling suppresses intermediate mouseEnter storms on cards
// passing under a stationary pointer, then restores hover on pointer movement.
{
  const root = createTestRoot({ width: 400, height: 260 });
  const entered: number[] = [];
  const left: number[] = [];
  try {
    root.render(
      createElement(
        'div',
        {
          testId: 'hover-scroller',
          style: { width: 400, height: 260, overflowY: 'scroll' },
        },
        ...Array.from({ length: 12 }, (_, index) =>
          createElement('div', {
            key: index,
            testId: `hover-card-${index}`,
            style: { height: 100 },
            onMouseEnter: () => entered.push(index),
            onMouseLeave: () => left.push(index),
          }),
        ),
      ),
    );
    const { renderer } = root;
    renderer.flush();
    renderer.nativeSimulateMouseMove(120, 50);
    renderer.dispatchNativeEvents();
    renderer.flush();
    assert.deepEqual(entered, [0], 'Pointer move should hover card 0');

    for (let step = 0; step < 5; step++) {
      renderer.nativeSimulateScrollWheel(120, 50, 0, -100);
      renderer.dispatchNativeEvents();
      renderer.flush();
    }
    assert.deepEqual(left, [0], 'Scrolling should cleanly unhover the previously hovered card');
    assert.deepEqual(
      entered,
      [0],
      'Scrolling past cards under a stationary pointer must not fire intermediate mouseEnter events',
    );

    renderer.nativeSimulateMouseMove(125, 50);
    renderer.dispatchNativeEvents();
    renderer.flush();
    assert.equal(
      entered.length,
      2,
      'Moving the pointer after scrolling should immediately restore mouseEnter on the card underneath',
    );
    assert(
      entered[1] >= 4,
      `Expected pointer move to hover a scrolled-in card (got ${entered[1]})`,
    );
  } finally {
    root.unmount();
  }
}

const snapshot = createDemoSnapshot();
const deviceCount = Number(process.argv[2] ?? 1200);
const sampleCount = Number(process.argv[3] ?? 24);
assert(Number.isSafeInteger(deviceCount) && deviceCount > 0);
assert(Number.isSafeInteger(sampleCount) && sampleCount >= 2);
for (let index = 0; index < deviceCount; index++) {
  const id = `fixture_${String(index).padStart(4, '0')}`;
  const name = `Fixture outlet ${id.slice(-4)}`;
  const entity_id = `switch.${id}`;
  snapshot.devices.push({ id, name, area_id: 'living_room' });
  snapshot.entities.push({ entity_id, device_id: id, original_name: name });
  snapshot.states.push({
    entity_id,
    state: index % 2 === 0 ? 'on' : 'off',
    attributes: { friendly_name: name },
    last_changed: '2026-11-25T12:00:00Z',
  });
}

const { renderer, render, unmount } = createTestRoot({ width: 1280, height: 800 });
try {
  const initialRssMiB = process.memoryUsage.rss() / (1024 * 1024);
  const start = performance.now();
  render(
    <HomeWorkspace
      snapshot={snapshot}
      preferences={defaults}
      demo
      onControl={() => {}}
      onFavorite={() => {}}
      onTheme={() => {}}
      onGrouping={() => {}}
    />,
  );
  renderer.flush();
  const mountMs = performance.now() - start;
  const scroller = renderer.findByType('div').find(({ id }) => {
    const bounds = renderer.getElementBounds(id);
    return bounds && bounds.width > 720 && bounds.height > 540 && renderer.getScrollOffset(id);
  });
  assert(scroller, 'Home should use a native scrollable content area');
  const viewport = renderer.getElementBounds(scroller.id);
  assert(viewport);
  const originalOffset = renderer.getScrollOffset(scroller.id)?.[1];
  assert.equal(originalOffset, 0);
  const size = 1024 * 1024;
  const mountRssMiB = process.memoryUsage.rss() / size;
  renderer.resetPerfMetrics();
  const samples: number[] = [];
  const drawSamples: number[] = [];
  const cpuSamples: number[] = [];
  for (let step = 0; step < sampleCount; step++) {
    const cpuStart = process.cpuUsage();
    const frameStart = performance.now();
    // Keep the pointer in the content inset so card hover updates are outside the sample.
    renderer.nativeSimulateScrollWheel(viewport.x + 5, viewport.y + viewport.height / 2, 0, -170);
    renderer.dispatchNativeEvents();
    renderer.flush();
    samples.push(performance.now() - frameStart);
    const cpu = process.cpuUsage(cpuStart);
    cpuSamples.push((cpu.user + cpu.system) / 1000);
    drawSamples.push(renderer.getPerfMetrics().totalDrawMs);
  }
  const perf = renderer.getPerfMetrics();
  const offset = renderer.getScrollOffset(scroller.id)?.[1];
  assert(offset !== undefined && offset < -100, 'Native input should scroll the dashboard');
  samples.sort((a, b) => a - b);
  drawSamples.sort((a, b) => a - b);
  cpuSamples.sort((a, b) => a - b);
  const percentile = (values: number[], fraction: number) =>
    values[Math.ceil(fraction * values.length) - 1];
  console.log(
    JSON.stringify(
      {
        deviceCount,
        sampleCount,
        mountMs,
        initialRssMiB,
        mountRssMiB,
        finalRssMiB: process.memoryUsage.rss() / size,
        p50Ms: percentile(samples, 0.5),
        p95Ms: percentile(samples, 0.95),
        p99Ms: percentile(samples, 0.99),
        cpuP50Ms: percentile(cpuSamples, 0.5),
        cpuP95Ms: percentile(cpuSamples, 0.95),
        nativeDrawP50Ms: percentile(drawSamples, 0.5),
        nativeDrawP95Ms: percentile(drawSamples, 0.95),
        scrollOffset: offset,
        ...perf,
      },
      null,
      2,
    ),
  );
} finally {
  unmount();
}
