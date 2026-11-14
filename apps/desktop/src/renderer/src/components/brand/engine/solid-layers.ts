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
  foregroundRatioAndAlpha,
  hasEyeFeature,
  mix3,
  subtract3,
} from './generation-helpers';

const f = Math.fround;

export function multipleForegroundSolidLayers(
  rgba: TaggedPixels,
  width: number,
  height: number,
  colors: ReadonlyArray<readonly [number, number, number]>,
  background: readonly [number, number, number],
  flags: Uint8Array,
  grayscale: readonly [number, number, number],
  { generateHighlightMask = true }: { generateHighlightMask?: boolean } = {},
) {
  if (!colors.length) return { success: false as const, reason: 'empty-palette' };
  const foreground = new Uint8Array(rgba.length);
  const highlightMask = new Uint8Array(rgba.length);
  const getColor = (x: number, y: number) => pixelColor(rgba, x + y * width);
  const closest = (color: readonly number[]) => {
    let index = 0;
    let dist = 3.4028234663852886e38;
    colors.forEach((candidate, i) => {
      const d = colorDistance(color, candidate);
      if (d < dist) {
        dist = d;
        index = i;
      }
    });
    return { index, distance: dist };
  };
  const groups = colors.map((color) => {
    const dir = subtract3(color, background);
    const length = f(Math.sqrt(dot3(dir, dir)));
    const normalized = dir.map((v) => f(v * f(1 / length)));
    let index = 0;
    let dist = 0;
    colors.forEach((candidate, i) => {
      const delta = subtract3(candidate, background);
      const size = f(Math.sqrt(dot3(delta, delta)));
      const normalizedCandidate = delta.map((v) => f(v * f(1 / size)));
      if (dot3(normalized, normalizedCandidate) > 0.9 && size > dist) {
        dist = size;
        index = i;
      }
    });
    return index;
  });
  const duplicates = new Set<number>();
  for (let i = 0; i < colors.length; i += 1) {
    for (let j = i + 1; j < colors.length; j += 1) {
      if (groups[i] === groups[j]) {
        duplicates.add(i);
        duplicates.add(j);
      }
    }
  }
  const luminances = colors.map((color) => clamp01(dot3(color, grayscale)));
  const checkEyes = colors.length >= 3 && colorDistance(background, [1, 1, 1]) < 30 / 255;
  if (checkEyes) connectedBackgroundFlags(flags, width, height);
  const maxLuma = Math.max(...luminances);
  const minLuma = Math.min(...luminances);
  const range = f(maxLuma - Math.min(minLuma, f(maxLuma + f(-1e-5))));
  const floor = Math.max(0.5, f(1 - f(Math.min(f(0.5 / range), f(1.6)) * range)));
  const neighborhood = (x: number, y: number, radius: number) => {
    const counts = new Uint32Array(colors.length);
    let total = 0;
    for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
      for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 1) {
        if (
          ((flags[xx + yy * width] ?? 0) & 3) !== 3 ||
          !almostOpaquePixel(rgba, xx + yy * width)
        ) {
          continue;
        }
        const nearest = closest(getColor(xx, yy));
        if (nearest.distance <= 10 / 255) {
          counts[nearest.index] = (counts[nearest.index] ?? 0) + 1;
          total += 1;
        }
      }
    }
    return { counts, total };
  };
  const candidates = (color: readonly number[], counts: Uint32Array | null) => {
    let projectedError = 3.4028234663852886e38;
    let opaqueError = projectedError;
    let projectedColor: readonly [number, number, number] = colors[0]!;
    let opaqueColor: readonly [number, number, number] = colors[0]!;
    for (let i = 0; i < colors.length; i += 1) {
      if (counts && !counts[i]) continue;
      for (let j = i + 1; j < colors.length; j += 1) {
        if (counts && !counts[j]) continue;
        const solution = foregroundRatioAndAlpha(
          subtract3(color, background),
          subtract3(colors[i]!, background),
          subtract3(colors[j]!, background),
        );
        const mixed = mix3(colors[i]!, colors[j]!, clamp01(solution.ratio));
        const projected = mix3(background, mixed, clamp01(solution.alpha));
        const pe = colorDistance(color, projected);
        const oe = colorDistance(color, mixed);
        if (pe < projectedError) {
          projectedError = pe;
          projectedColor = mixed;
        }
        if (oe < opaqueError) {
          opaqueError = oe;
          opaqueColor = mixed;
        }
      }
    }
    if (projectedError === 3.4028234663852886e38 && opaqueError === projectedError) {
      colors.forEach((candidate, i) => {
        if (counts && !counts[i]) return;
        const pe = colorDistance(color, clampedProject(color, background, candidate));
        const oe = colorDistance(color, candidate);
        if (pe < projectedError) {
          projectedError = pe;
          projectedColor = candidate;
        }
        if (oe < opaqueError) {
          opaqueError = oe;
          opaqueColor = candidate;
        }
      });
    }
    return opaqueError <= f(35 / 255)
      ? { color: opaqueColor, error: opaqueError }
      : { color: projectedColor, error: projectedError };
  };
  let rejectedPixels = 0;
  const border = Math.floor(width / 60);
  const maximumRejected = Math.floor((width * height) / 2500);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const index = x + y * width;
      const offset = index * 4;
      const color = getColor(x, y);
      if (!almostOpaquePixel(rgba, index)) continue;
      if (checkEyes && hasEyeFeature(rgba, width, height, x, y, flags)) {
        return { success: false as const, reason: 'eye-feature' };
      }
      let alpha = 0;
      let subject: readonly [number, number, number] = colors[0]!;
      if (colorDistance(color, background) >= 2 / 255) {
        let selected: { color: readonly [number, number, number]; error: number } = {
          color: colors[0]!,
          error: colorDistance(color, clampedProject(color, background, colors[0]!)),
        };
        if (colors.length > 1) {
          const dBg = subtract3(color, background);
          if (
            dot3(dBg, dBg) >= 0.27 &&
            colors.every((candidate) => {
              const d = subtract3(color, candidate);
              return dot3(d, d) >= 0.27;
            })
          ) {
            let count = 0;
            let equal = 0;
            for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
              for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
                if (((flags[xx + yy * width] ?? 0) & 9) === 9) {
                  count += 1;
                  if (getColor(xx, yy).every((v, c) => v === color[c])) equal += 1;
                }
              }
            }
            if (count > 7 && equal === count) {
              return { success: false as const, reason: 'unrepresented-flat-color' };
            }
          }
          const nearby = neighborhood(x, y, 2);
          selected =
            nearby.total > 0
              ? candidates(color, nearby.counts)
              : { color: colors[0]!, error: 3.4028234663852886e38 };
          const projectAll = () => {
            let nearest = 0;
            let error = 3.4028234663852886e38;
            colors.forEach((candidate, i) => {
              const d = colorDistance(color, clampedProject(color, background, candidate));
              if (d < error) {
                error = d;
                nearest = i;
              }
            });
            return { color: colors[nearest]!, error, index: nearest };
          };
          if (!duplicates.size && selected.error > f(10 / 255)) {
            const all = projectAll();
            if (all.error < selected.error) selected = all;
          }
          let allowed = ((flags[index] ?? 0) & 9) === 9 || !duplicates.size;
          if (allowed && selected.error > f(10 / 255)) {
            const all = candidates(color, null);
            if (all.error < selected.error) selected = all;
          }
          if (selected.error <= f(10 / 255)) allowed = true;
          if (!allowed) {
            const all = projectAll();
            let best = all.index;
            if (duplicates.has(best)) {
              const votes = neighborhood(x, y, 3).counts;
              for (let i = 0; i < colors.length; i += 1) {
                if (groups[i] === groups[all.index] && (votes[i] ?? 0) > (votes[best] ?? 0)) {
                  best = i;
                }
              }
            }
            const err = colorDistance(color, clampedProject(color, background, colors[best]!));
            if (err < selected.error) selected = { color: colors[best]!, error: err };
          }
        }
        const interior = x >= border && y >= border && x < width - border && y < height - border;
        if (
          interior &&
          (selected.error > f(0.235) ||
            (generateHighlightMask && colors.length > 1 && selected.error > 1))
        ) {
          if (generateHighlightMask || rejectedPixels >= maximumRejected) {
            return { success: false as const, reason: 'projection-error' };
          }
          rejectedPixels += 1;
        }
        subject = selected.color;
        const direction = subtract3(subject, background);
        alpha = clamp01(
          f(dot3(direction, subtract3(color, background)) / dot3(direction, direction)),
        );
      }
      const alphaByte = Math.trunc(f(alpha * 255));
      for (let c = 0; c < 3; c += 1) {
        foreground[offset + c] = Math.trunc(f(f((subject[c] ?? 0) * 255) * alpha));
      }
      foreground[offset + 3] = alphaByte;
      const luminance = clamp01(dot3(subject, grayscale));
      const relative = clamp01(f(1 - f(f(maxLuma - luminance) / range)));
      const brightness = f(f(1 - floor) * relative + floor);
      const white = Math.trunc(f(f(brightness * 255) * alpha));
      highlightMask[offset] = white;
      highlightMask[offset + 1] = white;
      highlightMask[offset + 2] = white;
      highlightMask[offset + 3] = alphaByte;
    }
  }
  return { foreground, highlightMask, success: true as const, rejectedPixels };
}
