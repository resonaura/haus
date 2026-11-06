/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { StatsDataPoint } from './types.js';

function getY(pt: StatsDataPoint): number {
  return pt.value ?? pt.mean ?? pt.last ?? 0;
}

/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling algorithm.
 * Reduces timeseries data to a target threshold while preserving visual shapes, peaks, and troughs.
 * Executes in O(N) linear time with minimal memory allocations.
 *
 * @param data Array of timeseries data points sorted chronologically.
 * @param threshold Target number of data points to retain (>= 2).
 * @returns Downsampled array of data points with length <= threshold.
 */
export function downsampleLTTB(
  data: readonly StatsDataPoint[],
  threshold: number,
): readonly StatsDataPoint[] {
  if (threshold >= data.length || threshold <= 2) {
    return data;
  }

  const first = data[0];
  if (!first) return data;

  const sampled: StatsDataPoint[] = [first];
  const bucketSize = (data.length - 2) / (threshold - 2);
  let aIndex = 0;

  for (let i = 0; i < threshold - 2; i++) {
    // 1. Calculate the average point for the next bucket (i + 1)
    const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextBucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);

    let avgX = 0;
    let avgY = 0;
    let validNextCount = 0;

    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      const pt = data[j];
      if (pt) {
        avgX += pt.timestamp;
        avgY += getY(pt);
        validNextCount++;
      }
    }

    if (validNextCount > 0) {
      avgX /= validNextCount;
      avgY /= validNextCount;
    } else {
      const fallback = data[Math.min(nextBucketStart, data.length - 1)];
      avgX = fallback?.timestamp ?? 0;
      avgY = fallback ? getY(fallback) : 0;
    }

    // 2. Find the point in current bucket i that maximizes triangle area
    const currBucketStart = Math.floor(i * bucketSize) + 1;
    const currBucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length);

    const aPoint = data[aIndex];
    if (!aPoint) continue;
    const aVal = getY(aPoint);

    let maxArea = -1;
    let maxAreaIndex = currBucketStart;

    for (let j = currBucketStart; j < currBucketEnd; j++) {
      const curr = data[j];
      if (!curr) continue;
      const currVal = getY(curr);

      const area =
        Math.abs(
          (aPoint.timestamp - avgX) * (currVal - aVal) -
            (aPoint.timestamp - curr.timestamp) * (avgY - aVal),
        ) * 0.5;

      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    const selectedPoint = data[maxAreaIndex];
    if (selectedPoint) {
      sampled.push(selectedPoint);
      aIndex = maxAreaIndex;
    }
  }

  // Always include the last point
  const last = data[data.length - 1];
  if (last && last !== first) {
    sampled.push(last);
  }

  return sampled;
}
