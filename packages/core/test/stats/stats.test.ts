/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  alignTo5m,
  alignTo1h,
  alignToBucket,
  combineRollups,
  computeRollup,
  type RawStatisticSample,
  type StatisticRollup,
} from '../../src/stats/index.js';

describe('Stats Rollup & Alignment Engine', () => {
  it('aligns Unix epoch seconds to enclosing 5m and 1h intervals', () => {
    // 1700000123: 1700000000 + 123
    const ts = 1700000123;
    const aligned5m = alignTo5m(ts);
    expect(aligned5m % 300).toBe(0);
    expect(aligned5m).toBe(Math.floor(ts / 300) * 300);

    const aligned1h = alignTo1h(ts);
    expect(aligned1h % 3600).toBe(0);
    expect(aligned1h).toBe(Math.floor(ts / 3600) * 3600);

    expect(alignToBucket(ts, 60)).toBe(Math.floor(ts / 60) * 60);
  });

  it('computes accurate rollups for gauge metrics with min, max, mean, first, last', () => {
    const samples: RawStatisticSample[] = [
      { metadataId: 'meta_temp', timestamp: 1700000010, value: 20.5 },
      { metadataId: 'meta_temp', timestamp: 1700000050, value: 22.0 },
      { metadataId: 'meta_temp', timestamp: 1700000100, value: 19.5 },
      { metadataId: 'meta_temp', timestamp: 1700000200, value: 21.0 },
    ];

    const rollup = computeRollup('meta_temp', 1700000000, samples, 'gauge');
    expect(rollup).not.toBeNull();
    expect(rollup!.metadataId).toBe('meta_temp');
    expect(rollup!.startTs).toBe(1700000000);
    expect(rollup!.min).toBe(19.5);
    expect(rollup!.max).toBe(22.0);
    expect(rollup!.first).toBe(20.5);
    expect(rollup!.last).toBe(21.0);
    expect(rollup!.count).toBe(4);
    // Mean = (20.5 + 22.0 + 19.5 + 21.0) / 4 = 83 / 4 = 20.75
    expect(rollup!.mean).toBe(20.75);
    expect(rollup!.sum).toBeNull();
  });

  it('computes accurate rollups for counter metrics with net sum delta', () => {
    const samples: RawStatisticSample[] = [
      { metadataId: 'meta_energy', timestamp: 1700000010, value: 100.0 },
      { metadataId: 'meta_energy', timestamp: 1700000100, value: 102.5 },
      { metadataId: 'meta_energy', timestamp: 1700000250, value: 105.2 },
    ];

    const rollup = computeRollup('meta_energy', 1700000000, samples, 'counter');
    expect(rollup).not.toBeNull();
    expect(rollup!.min).toBe(100.0);
    expect(rollup!.max).toBe(105.2);
    expect(rollup!.first).toBe(100.0);
    expect(rollup!.last).toBe(105.2);
    expect(rollup!.sum).toBe(5.2); // 105.2 - 100.0
    expect(rollup!.mean).toBeNull();
  });

  it('combines multiple 5-minute rollups into an accurate 1-hour rollup', () => {
    const rollups: StatisticRollup[] = [
      {
        metadataId: 'meta_temp',
        startTs: 1700000000,
        min: 19.0,
        max: 21.0,
        mean: 20.0,
        first: 19.5,
        last: 20.5,
        sum: null,
        count: 10,
      },
      {
        metadataId: 'meta_temp',
        startTs: 1700000300,
        min: 20.0,
        max: 23.0,
        mean: 22.0,
        first: 20.5,
        last: 22.5,
        sum: null,
        count: 20,
      },
    ];

    const hourRollup = combineRollups('meta_temp', 1700000000, rollups);
    expect(hourRollup).not.toBeNull();
    expect(hourRollup!.min).toBe(19.0);
    expect(hourRollup!.max).toBe(23.0);
    expect(hourRollup!.first).toBe(19.5);
    expect(hourRollup!.last).toBe(22.5);
    expect(hourRollup!.count).toBe(30);
    // Weighted mean = (20.0 * 10 + 22.0 * 20) / 30 = (200 + 440) / 30 = 640 / 30 = 21.333
    expect(hourRollup!.mean).toBe(21.333);
  });

  it('returns null when given empty sample arrays', () => {
    expect(computeRollup('meta_x', 1700000000, [])).toBeNull();
    expect(combineRollups('meta_x', 1700000000, [])).toBeNull();
  });
});
