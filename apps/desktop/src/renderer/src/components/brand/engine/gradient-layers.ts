/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { almostOpaquePixel, clampedProject, pixelColor, type TaggedPixels } from './math';
import {
  clamp01,
  colorDistance,
  connectedBackgroundFlags,
  dot3,
  extendColorConfidence,
  foregroundRatioAndAlpha,
  hasEyeFeature,
  mix3,
  subtract3,
} from './generation-helpers';

const f = Math.fround;

export function rgbHSV(color: readonly number[]) {
  const max = Math.max(...color);
  const min = Math.min(...color);
  return { saturation: max === 0 ? 0 : f(f(max - min) / max), value: max };
}

export function periodicForeground(flags: Uint8Array, width: number, height: number): boolean {
  for (let grid = 11; grid <= 17; grid += 1) {
    const sums = [0, 0];
    const positive = [0, 0];
    const negative = [0, 0];
    for (let axis = 0; axis < 2; axis += 1) {
      for (let i = 0; i < grid; i += 1) {
        let line = 0;
        const sign = i & 1 ? 1 : -1;
        for (let j = 0; j < grid; j += 1) {
          const x = Math.trunc((((axis ? i : j) + 0.5) * width) / grid);
          const y = Math.trunc((((axis ? j : i) + 0.5) * height) / grid);
          line += (flags[x + y * width] ?? 0) & 1 ? sign : -sign;
        }
        sums[axis] = (sums[axis] ?? 0) + line;
        if (line === grid) positive[axis] = (positive[axis] ?? 0) + 1;
        if (line === -grid) negative[axis] = (negative[axis] ?? 0) + 1;
      }
    }
    const halfGrid = grid >> 1;
    const majority = (grid * grid) >> 1;
    if (
      (sums[0]! >= majority && positive[0]! >= halfGrid && !negative[0]) ||
      (sums[0]! <= -majority && negative[0]! >= halfGrid && !positive[0]) ||
      (sums[1]! >= majority && positive[1]! >= halfGrid && !negative[1]) ||
      (sums[1]! <= -majority && negative[0]! >= halfGrid && !positive[1])
    ) {
      return true;
    }
  }
  return false;
}

export function singleForegroundGradientClassification(
  rgba: TaggedPixels,
  width: number,
  height: number,
  flags: Uint8Array,
  foreground: readonly number[],
  backgroundSamples: ReadonlyArray<readonly number[]>,
) {
  const getColor = (x: number, y: number) => pixelColor(rgba, x + y * width);
  const hsv = rgbHSV(foreground);
  if (!(hsv.saturation < 0.5 || hsv.value < 0.5)) {
    return { success: false as const, reason: 'colored-foreground-over-gradient' };
  }
  let radius = 3.4028234663852886e38;
  for (const color of backgroundSamples)
    radius = Math.min(radius, colorDistance(foreground, color));
  if (radius < f(37 / 255)) {
    return { success: false as const, reason: 'insufficient-gradient-contrast' };
  }
  extendColorConfidence(flags, width, height, true);
  const corners: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  let bilinear = corners.every(([x, y]) => ((flags[x + y * width] ?? 0) & 3) === 2);
  let errors = 0;
  if (bilinear) {
    const cornerColors = corners.map(([x, y]) => getColor(x, y));
    for (let y = 0; y < height && errors <= 60; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (((flags[x + y * width] ?? 0) & 9) !== 8) continue;
        const horizontal = f(x / (width - 1));
        const vertical = f(y / (height - 1));
        const expected = mix3(
          mix3(cornerColors[0]!, cornerColors[1]!, horizontal),
          mix3(cornerColors[2]!, cornerColors[3]!, horizontal),
          vertical,
        );
        if (colorDistance(getColor(x, y), expected) > f(52 / 255)) errors += 1;
      }
    }
    bilinear = errors <= 60;
  }
  if (!bilinear) {
    for (const x of [2, width - 3]) {
      let previous: readonly [number, number, number] | null = null;
      for (let y = Math.floor(width / 10); y < height - Math.floor(width / 10); y += 1) {
        if (((flags[x + y * width] ?? 0) & 9) !== 8) continue;
        if (!almostOpaquePixel(rgba, x + y * width)) continue;
        const color = getColor(x, y);
        if (previous) {
          const delta = subtract3(color, previous);
          if (dot3(delta, delta) > 0.0784) {
            return { success: false as const, reason: 'non-continuous-background-edge' };
          }
        }
        previous = color;
      }
    }
  }
  let curved = 0;
  let discontinuous = 0;
  const border = Math.floor(Math.min(width, height) / 10);
  for (let x = 2; x < width - 2; x += 1) {
    for (let y = 2; y < height - 2; y += 1) {
      const i = x + y * width;
      if (
        [i, i - 1, i + 1, i - width, i + width].some(
          (j) => ((flags[j] ?? 0) & 9) !== 8 || !almostOpaquePixel(rgba, j),
        )
      ) {
        continue;
      }
      const color = getColor(x, y);
      const left = getColor(x - 1, y);
      const right = getColor(x + 1, y);
      const up = getColor(x, y - 1);
      const down = getColor(x, y + 1);
      const horizontal = color.map((v, c) => f(v * -2 + f((left[c] ?? 0) + (right[c] ?? 0))));
      const vertical = color.map((v, c) => f(v * -2 + f((up[c] ?? 0) + (down[c] ?? 0))));
      const curvature = f(f(dot3(horizontal, horizontal) + dot3(vertical, vertical)) * 0.25);
      if (curvature > f(0.0027450979687273502)) curved += 1;
      if (
        x >= border &&
        y >= border &&
        x < width - border &&
        y < height - border &&
        [left, right, up, down].some((candidate) => {
          const delta = subtract3(color, candidate);
          return dot3(delta, delta) > f(0.2025);
        })
      ) {
        discontinuous += 1;
      }
    }
  }
  if (curved > Math.floor((width * height) / 2000) || discontinuous > 0) {
    return { success: false as const, reason: 'non-continuous-background' };
  }
  return { success: true as const, bilinear, radius };
}

export function gradientForegroundSolidLayers(
  rgba: TaggedPixels,
  width: number,
  height: number,
  background: readonly [number, number, number],
  flags: Uint8Array,
  grayscale: readonly [number, number, number],
  {
    gradientBackground = false,
    backgroundEnd = background,
    additionalFlags = flags,
  }: {
    gradientBackground?: boolean;
    backgroundEnd?: readonly [number, number, number];
    additionalFlags?: Uint8Array;
  } = {},
) {
  const foreground = new Uint8Array(rgba.length);
  const highlightMask = new Uint8Array(rgba.length);
  const checkEyes = colorDistance(background, [1, 1, 1]) < 30 / 255;
  if (checkEyes) connectedBackgroundFlags(flags, width, height);
  const getColor = (x: number, y: number) => pixelColor(rgba, x + y * width);
  let min = 1;
  let max = 0;
  for (let i = 0; i < flags.length; i += 1) {
    if ((flags[i] ?? 0) & 1 && (additionalFlags[i] ?? 0) & 8 && almostOpaquePixel(rgba, i)) {
      const color = getColor(i % width, Math.floor(i / width));
      const luminance = clamp01(dot3(color, grayscale));
      min = Math.min(min, luminance);
      max = Math.max(max, luminance);
    }
  }
  const range = f(max - Math.min(min, f(max + f(-1e-5))));
  const floor = Math.max(0.5, f(1 - f(Math.min(f(0.5 / range), f(1.6)) * range)));
  const radius = Math.floor(Math.min(width, height) / 200) + 7;
  const project = (color: readonly number[], subject: readonly number[]) => {
    if (!gradientBackground) {
      return { background, projected: clampedProject(color, background, subject) };
    }
    const solution = foregroundRatioAndAlpha(
      subtract3(color, subject),
      subtract3(background, subject),
      subtract3(backgroundEnd, subject),
    );
    const bg = mix3(background, backgroundEnd, clamp01(solution.ratio));
    return { background: bg, projected: mix3(bg, subject, clamp01(f(1 - solution.alpha))) };
  };
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const index = x + y * width;
      const offset = index * 4;
      const color = getColor(x, y);
      if (!almostOpaquePixel(rgba, index)) continue;
      if (checkEyes && hasEyeFeature(rgba, width, height, x, y, flags)) {
        return { success: false as const, reason: 'eye-feature' };
      }
      const bg = gradientBackground ? clampedProject(color, background, backgroundEnd) : background;
      let subject: readonly [number, number, number] = [0, 0, 0];
      let selectedBackground: readonly [number, number, number] = bg;
      let alpha = 0;
      if (colorDistance(color, bg) >= 2 / 255) {
        if ((flags[index] ?? 0) & 1 && (additionalFlags[index] ?? 0) & 4) {
          subject = color;
        } else {
          let nearestDistance = 2147483647;
          let count = 0;
          let matches = false;
          const sum: [number, number, number] = [0, 0, 0];
          const visit = (callback: (xx: number, yy: number, i: number) => void) => {
            for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
              for (
                let yy = Math.max(0, y - radius);
                yy <= Math.min(height - 1, y + radius);
                yy += 1
              ) {
                callback(xx, yy, xx + yy * width);
              }
            }
          };
          visit((xx, yy, i) => {
            if (
              !((flags[i] ?? 0) & 1) ||
              !((additionalFlags[i] ?? 0) & 4) ||
              !almostOpaquePixel(rgba, i)
            ) {
              return;
            }
            const dist = Math.abs(xx - x) + Math.abs(yy - y);
            if (dist > nearestDistance) return;
            if (dist < nearestDistance) {
              count = 0;
              sum.fill(0);
              matches = false;
              nearestDistance = dist;
            }
            const candidate = getColor(xx, yy);
            count += 1;
            for (let c = 0; c < 3; c += 1) sum[c] = f(sum[c]! + (candidate[c] ?? 0));
            matches ||= colorDistance(color, candidate) < 2 / 255;
          });
          let error = 3.4028234663852886e38;
          if (count > 0) {
            subject = matches
              ? color
              : [f(sum[0] / f(count)), f(sum[1] / f(count)), f(sum[2] / f(count))];
            const projected = project(color, subject);
            selectedBackground = projected.background;
            error = colorDistance(color, projected.projected);
          }
          visit((_xx, _yy, i) => {
            if (
              !((flags[i] ?? 0) & 1) ||
              !((additionalFlags[i] ?? 0) & 8) ||
              !almostOpaquePixel(rgba, i)
            ) {
              return;
            }
            const candidate = getColor(i % width, Math.floor(i / width));
            const projected = project(color, candidate);
            const candidateError = colorDistance(color, projected.projected);
            if (candidateError < error) {
              subject = candidate;
              selectedBackground = projected.background;
              error = candidateError;
            }
          });
          if (error > f(1.2)) {
            return { success: false as const, reason: 'gradient-projection-error' };
          }
        }
        const direction = subtract3(subject, selectedBackground);
        alpha = clamp01(
          f(dot3(direction, subtract3(color, selectedBackground)) / dot3(direction, direction)),
        );
      }
      const alphaByte = Math.trunc(f(alpha * 255));
      for (let c = 0; c < 3; c += 1) {
        foreground[offset + c] = Math.trunc(f(f((subject[c] ?? 0) * 255) * alpha));
      }
      foreground[offset + 3] = alphaByte;
      const luminance = clamp01(dot3(subject, grayscale));
      const relative = clamp01(f(1 - f(f(max - luminance) / range)));
      const brightness = f(f(1 - floor) * relative + floor);
      const white = Math.trunc(f(f(brightness * 255) * alpha));
      highlightMask[offset] = white;
      highlightMask[offset + 1] = white;
      highlightMask[offset + 2] = white;
      highlightMask[offset + 3] = alphaByte;
    }
  }
  return { foreground, highlightMask, success: true as const };
}

export function singleForegroundGradientLayers(
  rgba: TaggedPixels,
  foregroundColor: readonly [number, number, number],
  backgroundSamples: ReadonlyArray<readonly number[]>,
) {
  let radius = 3.4028234663852886e38;
  for (const color of backgroundSamples) {
    radius = Math.min(radius, colorDistance(foregroundColor, color));
  }
  const foreground = new Uint8Array(rgba.length);
  const highlightMask = new Uint8Array(rgba.length);
  const colorBytes = foregroundColor.map((value) => f(value * 255));
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (!almostOpaquePixel(rgba, offset / 4)) continue;
    const color = pixelColor(rgba, offset / 4);
    const normalized = f(colorDistance(color, foregroundColor) / radius);
    const alpha = f(1 - Math.min(1, Math.max(0, normalized)));
    const alphaByte = Math.trunc(f(alpha * 255));
    for (let c = 0; c < 3; c += 1) {
      foreground[offset + c] = Math.trunc(f((colorBytes[c] ?? 0) * alpha));
    }
    foreground[offset + 3] = alphaByte;
    highlightMask.fill(alphaByte, offset, offset + 4);
  }
  return { foreground, highlightMask, foregroundColor, radius };
}
