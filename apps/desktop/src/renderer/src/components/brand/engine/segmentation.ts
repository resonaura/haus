/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  SegmentationRandom,
  almostOpaquePixel,
  bhattacharyyaDistance,
  clampedProject,
  gaussianMixture,
  pixelColor,
  pixelOpacity,
  squaredMahalanobis,
  type GaussianCluster,
  type TaggedPixels,
} from './math';
import { SEGMENTATION_CHI2_CDF } from './chi2-table';

const f32 = Math.fround;

export const FOREGROUND_SEGMENTATION_PARAMETERS = Object.freeze({
  clusters: 10,
  borderWidth: 2,
  maxSamples: 1400,
  iterations: 50,
  groupingDistance: 1,
  strict: Object.freeze({ noise: f32(4 / 255), booleanThreshold: 2 }),
  loose: Object.freeze({ noise: f32(45 / 255), booleanThreshold: 140 }),
});

function samplePixel(rgba: TaggedPixels, width: number, x: number, y: number) {
  return pixelColor(rgba, y * width + x);
}

function sampleStats(values: ReadonlyArray<readonly [number, number, number]>) {
  const mean: [number, number, number] = [0, 0, 0];
  for (const value of values) {
    mean[0] = f32(mean[0] + value[0]);
    mean[1] = f32(mean[1] + value[1]);
    mean[2] = f32(mean[2] + value[2]);
  }
  mean[0] = f32(mean[0] / values.length);
  mean[1] = f32(mean[1] / values.length);
  mean[2] = f32(mean[2] / values.length);
  let variance = 0;
  for (const value of values) {
    const d0 = f32(value[0] - mean[0]);
    const d1 = f32(value[1] - mean[1]);
    const d2 = f32(value[2] - mean[2]);
    const len = f32(Math.sqrt(f32(f32(d0 * d0) + f32(d1 * d1) + f32(d2 * d2))));
    variance = f32(variance + f32(len * len));
  }
  return { mean, variance: variance / values.length };
}

function borderInset(rgba: TaggedPixels, width: number, height: number): number {
  const thirdsX = [Math.floor(width / 3), width >> 1, Math.floor((2 * width) / 3)];
  const thirdsY = [Math.floor(height / 3), height >> 1, Math.floor((2 * height) / 3)];
  const outer: Array<readonly [number, number]> = [
    ...thirdsX.map((x) => [x, 1] as const),
    ...thirdsY.map((y) => [1, y] as const),
    ...thirdsY.map((y) => [width - 2, y] as const),
    ...thirdsX.map((x) => [x, height - 2] as const),
  ];
  const xThirds = [Math.floor(width / 3), Math.floor((2 * width) / 3)];
  const yThirds = [Math.floor(height / 3), Math.floor((2 * height) / 3)];
  const inner: Array<readonly [number, number]> = [
    ...[12, 10].flatMap((div) => xThirds.map((x) => [x, Math.floor(height / div)] as const)),
    ...[12, 10].flatMap((div) => yThirds.map((y) => [Math.floor(width / div), y] as const)),
    ...[12, 10].flatMap((div) =>
      yThirds.map((y) => [width - 1 - Math.floor(width / div), y] as const),
    ),
    ...[12, 10].flatMap((div) =>
      xThirds.map((x) => [x, height - 1 - Math.floor(height / div)] as const),
    ),
    ...[Math.floor(height / 8.5), height - 1 - Math.floor(height / 8.5)].flatMap((y) =>
      [Math.floor(width / 8.5), width - 1 - Math.floor(width / 8.5)].map((x) => [x, y] as const),
    ),
  ];
  if ([...outer, ...inner].some(([x, y]) => !almostOpaquePixel(rgba, y * width + x))) return 0;
  const edge = sampleStats(outer.map(([x, y]) => samplePixel(rgba, width, x, y)));
  const body = sampleStats(inner.map(([x, y]) => samplePixel(rgba, width, x, y)));
  const dist = Math.hypot(
    edge.mean[0] - body.mean[0],
    edge.mean[1] - body.mean[1],
    edge.mean[2] - body.mean[2],
  );
  return dist > 50 / 255 && edge.variance <= 1 / 255 && body.variance <= 1 / 255
    ? Math.floor(width / 12)
    : 0;
}

export function borderClusteringSamples(
  rgba: TaggedPixels,
  width: number,
  height: number,
  strict = true,
  inset = borderInset(rgba, width, height),
): Array<[number, number, number]> {
  const random = new SegmentationRandom(10);
  const params = strict
    ? FOREGROUND_SEGMENTATION_PARAMETERS.strict
    : FOREGROUND_SEGMENTATION_PARAMETERS.loose;
  const near = inset || 2;
  const bw = FOREGROUND_SEGMENTATION_PARAMETERS.borderWidth;
  const regions: ReadonlyArray<readonly [number, number, number, number]> = [
    [inset, width - inset, near, near + bw],
    [width - near - bw, width - near, inset, height - inset],
    [inset, width - inset, height - near - bw, height - near],
    [near, near + bw, inset, height - inset],
  ];
  const result: Array<[number, number, number]> = [];
  for (const [left, right, top, bottom] of regions) {
    for (
      let attempt = 0;
      attempt < FOREGROUND_SEGMENTATION_PARAMETERS.maxSamples / 4;
      attempt += 1
    ) {
      const x = random.integer(left, right);
      const y = random.integer(top, bottom);
      if (!almostOpaquePixel(rgba, y * width + x)) continue;
      const color = samplePixel(rgba, width, x, y);
      const luma = f32(
        f32(f32(color[0] * f32(0.2126)) + f32(color[1] * f32(0.7152))) +
          f32(color[2] * f32(0.0722)),
      );
      if (f32(random.next()) / 2147483648 > f32(f32(-0.476190447807312) * luma + 1)) continue;
      let consistent = 0;
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
        for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
          const neighbor = samplePixel(rgba, width, nx, ny);
          if (!almostOpaquePixel(rgba, ny * width + nx)) continue;
          const d0 = f32(color[0] - neighbor[0]);
          const d1 = f32(color[1] - neighbor[1]);
          const d2 = f32(color[2] - neighbor[2]);
          const len = f32(Math.sqrt(f32(f32(d0 * d0) + f32(d1 * d1) + f32(d2 * d2))));
          if (len <= 11 / 255) consistent += 1;
        }
      }
      if (consistent <= 5) continue;
      result.push([
        f32(f32(random.normal() * params.noise) + color[0]),
        f32(f32(random.normal() * params.noise) + color[1]),
        f32(f32(random.normal() * params.noise) + color[2]),
      ]);
    }
  }
  return result;
}

function colorDistance3(a: readonly number[], b: readonly number[]) {
  const d0 = f32((a[0] ?? 0) - (b[0] ?? 0));
  const d1 = f32((a[1] ?? 0) - (b[1] ?? 0));
  const d2 = f32((a[2] ?? 0) - (b[2] ?? 0));
  return f32(Math.sqrt(f32(f32(f32(d0 * d0) + f32(d1 * d1)) + f32(d2 * d2))));
}

export function segmentationFlags(
  rgba: TaggedPixels,
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const flags = new Uint8Array(width * height);
  const visitNeighbors = (x: number, y: number, visit: (nx: number, ny: number) => void) => {
    let count = 0;
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
        if (nx === x && ny === y) continue;
        visit(nx, ny);
        count += 1;
      }
    }
    return count;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      let foreground = 0;
      const count = visitNeighbors(x, y, (nx, ny) => {
        foreground += (mask[ny * width + nx] ?? 0) & 1;
      });
      flags[at] = ((mask[at] ?? 0) & 1) | Number(foreground === count);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      let foreground = (flags[at] ?? 0) & 1;
      const count =
        1 +
        visitNeighbors(x, y, (nx, ny) => {
          foreground += (flags[ny * width + nx] ?? 0) & 1;
        });
      if (foreground === 0 || foreground === count) flags[at] = (flags[at] ?? 0) | 2;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (!((flags[at] ?? 0) & 1)) {
        flags[at] = (flags[at] ?? 0) | 16;
        continue;
      }
      const color = samplePixel(rgba, width, x, y);
      if (!almostOpaquePixel(rgba, at)) continue;
      let consistent = 0;
      visitNeighbors(x, y, (nx, ny) => {
        if (
          almostOpaquePixel(rgba, ny * width + nx) &&
          colorDistance3(color, samplePixel(rgba, width, nx, ny)) <= 10 / 255
        ) {
          consistent += 1;
        }
      });
      if (consistent >= 5) flags[at] = (flags[at] ?? 0) | 16;
    }
  }
  return flags;
}

export function representativeColorSamples(
  rgba: TaggedPixels,
  flags: Uint8Array,
  width: number,
  height: number,
): { foreground: Array<[number, number, number]>; background: Array<[number, number, number]> } {
  const random = new SegmentationRandom(10);
  const foreground: Array<[number, number, number]> = [];
  const background: Array<[number, number, number]> = [];
  for (let attempt = 0; attempt < 8000; attempt += 1) {
    const x = random.integer(0, width);
    const y = random.integer(0, height);
    const at = y * width + x;
    if (((flags[at] ?? 0) & 18) === 18 && almostOpaquePixel(rgba, at)) {
      const color = samplePixel(rgba, width, x, y);
      if ((flags[at] ?? 0) & 1) foreground.push(color);
      else background.push(color);
    }
    if (foreground.length >= 1100 && background.length >= 1100) break;
  }
  return { foreground, background: background.reverse() };
}

export function selectBackgroundClusters(clusters: readonly GaussianCluster[]): number[] {
  let dominant = 0;
  for (let k = 1; k < clusters.length; k += 1) {
    if ((clusters[k]?.weight ?? 0) > (clusters[dominant]?.weight ?? 0)) dominant = k;
  }
  const center = Array.from(clusters[dominant]!.mean);
  const visited = new Set<number>();
  const pending: number[] = [];
  for (let k = 0; k < clusters.length; k += 1) {
    const point = Array.from(clusters[k]!.mean);
    for (const end of [
      [1, 1, 1],
      [0, 0, 0],
    ]) {
      const projected = clampedProject(point, center, end);
      if (
        colorDistance3(point, projected) < 5 / 255 &&
        colorDistance3(center, projected) < colorDistance3(center, end) * 0.19
      ) {
        visited.add(k);
        pending.push(k);
        break;
      }
    }
  }
  const selected: number[] = [];
  while (pending.length) {
    const current = pending.pop()!;
    selected.push(current);
    for (let k = 0; k < clusters.length; k += 1) {
      if (!visited.has(k) && bhattacharyyaDistance(clusters[current]!, clusters[k]!) <= 1) {
        visited.add(k);
        pending.push(k);
      }
    }
  }
  return selected;
}

export interface ForegroundMaskResult {
  mode: string;
  success?: boolean;
  mask: Uint8Array | null;
  reason?: string;
  inset?: number;
  samples?: number;
  selected?: number[];
  clusters?: GaussianCluster[];
  background?: number[];
  threshold?: number;
}

function clusteredMask(
  rgba: TaggedPixels,
  width: number,
  height: number,
  strict: boolean,
  inset: number,
): ForegroundMaskResult {
  const samples = borderClusteringSamples(rgba, width, height, strict, inset);
  if (!samples.length) {
    return {
      mode: 'gaussian-mixture',
      success: false,
      mask: null,
      reason: 'no-opaque-border-samples',
    };
  }
  const mixture = gaussianMixture(samples);
  const selected = selectBackgroundClusters(mixture.clusters);
  const threshold = (
    strict ? FOREGROUND_SEGMENTATION_PARAMETERS.strict : FOREGROUND_SEGMENTATION_PARAMETERS.loose
  ).booleanThreshold;
  const cache = new Map<number, number>();
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    const key =
      ((rgba[i * 4] ?? 0) |
        ((rgba[i * 4 + 1] ?? 0) << 8) |
        ((rgba[i * 4 + 2] ?? 0) << 16) |
        (rgba.alphaMode === 'premultiplied' ? (rgba[i * 4 + 3] ?? 0) << 24 : 0)) >>>
      0;
    let value = cache.get(key);
    if (value === undefined) {
      const color = samplePixel(rgba, width, i % width, Math.floor(i / width));
      let probability = 1;
      for (const k of selected) {
        const cluster = mixture.clusters[k]!;
        const delta = [
          f32(color[0] - (cluster.mean[0] ?? 0)),
          f32(color[1] - (cluster.mean[1] ?? 0)),
          f32(color[2] - (cluster.mean[2] ?? 0)),
        ];
        const index = Math.min(
          4000,
          Math.max(0, Math.trunc(f32(squaredMahalanobis(delta, cluster.inverse) * 200))),
        );
        probability = f32(probability * (SEGMENTATION_CHI2_CDF[index] ?? 1));
      }
      value = (
        rgba.alphaMode === 'premultiplied'
          ? threshold < f32(pixelOpacity(rgba, i) * f32(probability * 255))
          : threshold < Math.trunc(f32(probability * 255))
      )
        ? 255
        : 0;
      cache.set(key, value);
    }
    mask[i] = value;
  }
  let foreground = 0;
  let background = 0;
  const countPixel = (x: number, y: number) => {
    if ((mask[y * width + x] ?? 0) > threshold) foreground += 1;
    else background += 1;
  };
  const near = inset || 2;
  for (let x = 0; x < width; x += 1) {
    for (let d = 0; d < 2; d += 1) {
      countPixel(x, near + d);
      countPixel(x, height - near - 2 + d);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let d = 0; d < 2; d += 1) {
      countPixel(near + d, y);
      countPixel(width - near - 2 + d, y);
    }
  }
  return {
    mode: 'gaussian-mixture',
    mask,
    inset,
    samples: samples.length,
    selected,
    clusters: mixture.clusters,
    success: foreground <= background,
  };
}

export function foregroundMask(
  rgba: TaggedPixels,
  width: number,
  height: number,
  strict = true,
): ForegroundMaskResult {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 8 ||
    height < 8 ||
    rgba.length !== width * height * 4
  ) {
    return { mode: 'invalid-image', mask: null };
  }
  const inset = borderInset(rgba, width, height);
  const near = inset || FOREGROUND_SEGMENTATION_PARAMETERS.borderWidth;
  const farX = width - 1 - inset;
  const farY = height - 1 - inset;
  const referenceIndex = near * width + near;
  if (rgba.alphaMode === 'premultiplied' && rgba[referenceIndex * 4 + 3] !== 255) {
    return clusteredMask(rgba, width, height, strict, inset);
  }
  const reference = Array.from(rgba.subarray(referenceIndex * 4, referenceIndex * 4 + 3));
  const matches = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    if (rgba.alphaMode === 'premultiplied' && rgba[at + 3] !== 255) return true;
    return reference.every((v, c) => rgba[at + c] === v);
  };
  const borderWidth = FOREGROUND_SEGMENTATION_PARAMETERS.borderWidth;
  for (let x = inset; x < farX; x += 1) {
    for (let dy = 0; dy < borderWidth; dy += 1) {
      if (!matches(x, near + dy) || !matches(x, farY - borderWidth + dy)) {
        return clusteredMask(rgba, width, height, strict, inset);
      }
    }
  }
  for (let y = inset; y < farY; y += 1) {
    for (let dx = 0; dx < borderWidth; dx += 1) {
      if (!matches(near + dx, y) || !matches(farX - borderWidth + dx, y)) {
        return clusteredMask(rgba, width, height, strict, inset);
      }
    }
  }
  const mean = f32(
    f32(
      f32((reference[0] ?? 0) / 255) +
        f32((reference[1] ?? 0) / 255) +
        f32((reference[2] ?? 0) / 255),
    ) / 3,
  );
  const threshold = strict
    ? f32(f32(7.409999847412109) + f32(f32(-1.0999999046325684) * mean))
    : f32(f32(139.5229949951172) + f32(f32(-36.99999237060547) * mean));
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    if (rgba.alphaMode === 'premultiplied') {
      const color = pixelColor(rgba, i).map((v) => f32(v * 255));
      const d0 = f32((color[0] ?? 0) - (reference[0] ?? 0));
      const d1 = f32((color[1] ?? 0) - (reference[1] ?? 0));
      const d2 = f32((color[2] ?? 0) - (reference[2] ?? 0));
      const length = f32(Math.sqrt(f32(f32(d2 * d2) + f32(f32(d0 * d0) + f32(d1 * d1)))));
      mask[i] = threshold < f32(pixelOpacity(rgba, i) * length) ? 255 : 0;
      continue;
    }
    const dr = (rgba[i * 4] ?? 0) - (reference[0] ?? 0);
    const dg = (rgba[i * 4 + 1] ?? 0) - (reference[1] ?? 0);
    const db = (rgba[i * 4 + 2] ?? 0) - (reference[2] ?? 0);
    mask[i] = threshold < f32(Math.sqrt(dr * dr + dg * dg + db * db)) ? 255 : 0;
  }
  return { mode: 'uniform-border', inset, background: reference, threshold, mask, success: true };
}
