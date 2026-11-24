/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createElement, useState } from 'react';
import { createTestRoot } from '@gpuix/react/testing';
import { GPUIX_CONTENT_HOST } from '@haus/ui/gpui';
import { HausUiProvider } from '@haus/ui/primitives';
import { Preview } from '../../src/gpui/preview.js';
import { requireGpuiBun } from '../../src/gpui/bun.js';

requireGpuiBun();

interface PercentileStats {
  readonly minMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly avgMs: number;
}

interface BenchResult {
  readonly name: string;
  readonly samples: number;
  readonly stats: PercentileStats;
  readonly extra?: Record<string, unknown>;
}

function statsFor(values: readonly number[]): PercentileStats {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number): number => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
    return Number((sorted[idx] ?? 0).toFixed(3));
  };
  const total = sorted.reduce((acc, v) => acc + v, 0);
  return {
    minMs: pick(0),
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    p99Ms: pick(0.99),
    maxMs: pick(1),
    avgMs: Number((sorted.length ? total / sorted.length : 0).toFixed(3)),
  };
}

function measureSteps(count: number, fn: (i: number) => void): PercentileStats {
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const t0 = performance.now();
    fn(i);
    times.push(performance.now() - t0);
  }
  return statsFor(times);
}

function readRssMb(): number {
  return Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
}

function benchPreviewHome(): BenchResult[] {
  const results: BenchResult[] = [];
  const tMount0 = performance.now();
  const { renderer, render, unmount } = createTestRoot({ width: 1280, height: 900 });
  render(
    createElement(HausUiProvider, {
      contentHost: GPUIX_CONTENT_HOST,
      mode: 'dark',
      children: createElement(Preview, {}),
    }),
  );
  renderer.flush();
  const mountMs = Number((performance.now() - tMount0).toFixed(3));

  const divs = renderer.findByType('div');
  const mainScroller = divs
    .map((d) => ({ id: d.id, b: renderer.getElementBounds(d.id), so: renderer.getScrollOffset(d.id) }))
    .filter((x) => x.b && x.so !== null && x.b.width > 700 && x.b.height > 500)
    .at(-1);
  const railScroller = divs
    .map((d) => ({ id: d.id, b: renderer.getElementBounds(d.id), so: renderer.getScrollOffset(d.id) }))
    .find((x) => x.b && x.so !== null && x.b.width > 500 && x.b.height >= 40 && x.b.height <= 90);

  results.push({
    name: 'preview_home_mount',
    samples: 1,
    stats: statsFor([mountMs]),
    extra: {
      divCount: divs.length,
      textCount: renderer.findByType('text').length,
      svgCount: renderer.findByType('svg').length,
      imgCount: renderer.findByType('img').length,
      rssMb: readRssMb(),
    },
  });

  // Check unwanted vertical scroll on pure horizontal gesture over main vertical scroller
  if (mainScroller?.b) {
    const cx = mainScroller.b.x + mainScroller.b.width / 2;
    const cy = mainScroller.b.y + mainScroller.b.height / 2;
    for (let i = 0; i < 4; i++) {
      renderer.nativeSimulateScrollWheel(cx, cy, -50, 0);
    }
    renderer.dispatchNativeEvents();
    renderer.flush();
    const afterPureHoriz = renderer.getScrollOffset(mainScroller.id);
    results.push({
      name: 'scroll_horiz_over_vert_bug_check',
      samples: 4,
      stats: statsFor([0]),
      extra: { mainOffsetAfterPureHoriz: afterPureHoriz },
    });

    const wheelStats = measureSteps(40, () => {
      renderer.nativeSimulateScrollWheel(cx, cy, 0, -24);
      renderer.dispatchNativeEvents();
      renderer.flush();
    });
    results.push({
      name: 'preview_home_vertical_scroll',
      samples: 40,
      stats: wheelStats,
      extra: { rssMb: readRssMb() },
    });
  }

  if (railScroller?.b && mainScroller) {
    const rx = railScroller.b.x + 120;
    const ry = railScroller.b.y + railScroller.b.height / 2;
    const beforeMain = renderer.getScrollOffset(mainScroller.id);
    for (let i = 0; i < 6; i++) {
      renderer.nativeSimulateScrollWheel(rx, ry, -40, -3);
    }
    renderer.dispatchNativeEvents();
    renderer.flush();
    results.push({
      name: 'scroll_diag_horiz_dominant_over_rail',
      samples: 6,
      stats: statsFor([0]),
      extra: {
        railAfter: renderer.getScrollOffset(railScroller.id),
        mainBefore: beforeMain,
        mainAfter: renderer.getScrollOffset(mainScroller.id),
      },
    });
  }

  // Hover sweep across pressables in Preview
  const buttons = renderer.findByType('div').slice(0, 30);
  const points = buttons
    .map((b) => renderer.getElementBounds(b.id))
    .filter((b): b is NonNullable<typeof b> => b !== null && b.width > 20 && b.height > 20);
  if (points.length > 0) {
    const hoverStats = measureSteps(30, (i) => {
      const box = points[i % points.length];
      if (!box) return;
      renderer.nativeSimulateMouseMove(box.x + box.width / 2, box.y + box.height / 2);
      renderer.dispatchNativeEvents();
      renderer.flush();
    });
    results.push({
      name: 'preview_hover_sweep',
      samples: 30,
      stats: hoverStats,
      extra: { rssMb: readRssMb() },
    });
  }

  unmount();
  return results;
}

function benchHoverRoundTripSynthetic(): BenchResult {
  let commits = 0;
  function InteractiveRows() {
    const [hoveredIndex, setHoveredIndex] = useState(-1);
    return createElement(
      'div',
      { style: { width: 1000, height: 700, overflowY: 'scroll', display: 'flex', flexDirection: 'column', gap: 6 } },
      Array.from({ length: 120 }, (_, i) =>
        createElement(
          'div',
          {
            key: i,
            onMouseEnter: () => {
              commits++;
              setHoveredIndex(i);
            },
            style: {
              height: 44,
              backgroundColor: hoveredIndex === i ? '#2a3342' : '#181c24',
              borderRadius: 10,
            },
          },
          `Item ${i}`,
        ),
      ),
    );
  }
  const { renderer, render, unmount } = createTestRoot({ width: 1000, height: 700 });
  render(createElement(InteractiveRows));
  renderer.flush();
  const stats = measureSteps(24, (i) => {
    renderer.nativeSimulateMouseMove(200, 20 + (i % 12) * 50);
    renderer.dispatchNativeEvents();
    renderer.flush();
  });
  unmount();
  return { name: 'synthetic_hover_120_cards_js_state', samples: 24, stats, extra: { commits } };
}

function benchLongList(itemCount: number): BenchResult {
  const { renderer, render, unmount } = createTestRoot({ width: 1000, height: 800 });
  render(
    createElement(
      'div',
      { style: { width: 1000, height: 800, overflowY: 'scroll', display: 'flex', flexDirection: 'column', gap: 4 } },
      Array.from({ length: itemCount }, (_, i) =>
        createElement('div', { key: i, style: { height: 36, backgroundColor: '#1a1e26' } }, `Row ${i} · Active`),
      ),
    ),
  );
  renderer.flush();
  const stats = measureSteps(30, () => {
    renderer.nativeSimulateScrollWheel(400, 300, 0, -48);
    renderer.dispatchNativeEvents();
    renderer.flush();
  });
  const rssMb = readRssMb();
  unmount();
  return { name: `scroll_long_list_${itemCount}`, samples: 30, stats, extra: { rssMb } };
}

const outPath = resolve(process.argv[2] ?? '../../artifacts/gpui-bench-baseline.json');
const results: BenchResult[] = [
  ...benchPreviewHome(),
  benchHoverRoundTripSynthetic(),
  benchLongList(1000),
  benchLongList(5000),
];

const report = {
  timestamp: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  rssEndMb: readRssMb(),
  results,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
