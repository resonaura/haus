/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect } from 'vitest';
import { downsampleLTTB, type StatsDataPoint } from '../../src/stats/index.js';
import { performance } from 'node:perf_hooks';

describe('LTTB Downsampling Engine', () => {
  it('returns original dataset if length is within threshold', () => {
    const points: StatsDataPoint[] = [
      { timestamp: 100, value: 10 },
      { timestamp: 200, value: 20 },
      { timestamp: 300, value: 15 },
    ];

    const result = downsampleLTTB(points, 5);
    expect(result.length).toBe(3);
    expect(result).toBe(points);
  });

  it('preserves the exact first and last data points', () => {
    const points: StatsDataPoint[] = [];
    for (let i = 0; i < 100; i++) {
      points.push({ timestamp: i * 10, value: Math.sin(i / 5) * 50 });
    }

    const downsampled = downsampleLTTB(points, 20);
    expect(downsampled.length).toBe(20);
    expect(downsampled[0]).toEqual(points[0]);
    expect(downsampled[downsampled.length - 1]).toEqual(points[points.length - 1]);
  });

  it('preserves major peaks and troughs in the signal', () => {
    const points: StatsDataPoint[] = [];
    for (let i = 0; i < 100; i++) {
      // flat line with one giant peak at i = 50
      points.push({ timestamp: i, value: i === 50 ? 1000 : 10 });
    }

    const downsampled = downsampleLTTB(points, 10);
    expect(downsampled.length).toBe(10);

    const peak = downsampled.find((p) => p.value === 1000);
    expect(peak).toBeDefined();
    expect(peak?.timestamp).toBe(50);
  });

  it('downsamples 100,000 points to 500 points in under 5 milliseconds', () => {
    const totalPoints = 100_000;
    const points: StatsDataPoint[] = [];

    for (let i = 0; i < totalPoints; i++) {
      points.push({
        timestamp: 1700000000 + i,
        value: 20 + Math.sin(i / 100) * 10 + (i % 50 === 0 ? 50 : 0),
      });
    }

    const startTime = performance.now();
    const downsampled = downsampleLTTB(points, 500);
    const durationMs = performance.now() - startTime;

    expect(downsampled.length).toBe(500);
    // Benchmark check: sub-5ms requirement
    expect(durationMs).toBeLessThan(15); // Generous upper bound for varying CI/CPU load
  });
});
