/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { premultipliedIconPixels, type TaggedPixels } from './math.js';
import { APP_ICON_METRICS } from './parameters.js';

export interface PixelBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly count: number;
}

/** Computes bounding box and count of pixels at or above an alpha threshold. */
export function scanAlphaBounds(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): PixelBounds | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(x + y * width) * 4 + 3] ?? 0;
      if (alpha < threshold) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      count += 1;
    }
  }
  return count > 0 ? { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, count } : null;
}

/** Measures both outer AA fringe bounds and optically dense core glyph bounds. */
export function measureCoreContentBounds(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { visible: PixelBounds; core: PixelBounds } | null {
  const visible = scanAlphaBounds(rgba, width, height, 4);
  if (!visible) return null;
  const core =
    scanAlphaBounds(rgba, width, height, APP_ICON_METRICS.coreAlpha) ??
    scanAlphaBounds(rgba, width, height, 32) ??
    visible;
  return { visible, core };
}

/** Checks whether dense foreground artwork already forms a filled rounded-square tile. */
export function isNormalizedExistingTile(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  core: PixelBounds,
): boolean {
  // Reject small glyphs or padded logo marks that happen to have a square bbox.
  if (core.width < width * 0.76 || core.height < height * 0.76) return false;
  const ratio = core.width / Math.max(1, core.height);
  if (ratio < 0.88 || ratio > 1.14) return false;
  if (core.count / (core.width * core.height) < 0.72) return false;
  const alphaAt = (x: number, y: number) => rgba[(x + y * width) * 4 + 3] ?? 0;
  const edgeRowInset = (fraction: number): number => {
    const y = Math.min(height - 1, core.y + Math.floor((core.height - 1) * fraction));
    const centerAlpha = alphaAt(Math.floor(core.x + core.width / 2), y);
    const threshold = Math.max(32, Math.min(APP_ICON_METRICS.coreAlpha, centerAlpha));
    let first = width;
    let last = -1;
    for (let x = core.x; x < core.x + core.width; x += 1) {
      if (alphaAt(x, y) >= threshold) {
        if (x < first) first = x;
        if (x > last) last = x;
      }
    }
    return last < first ? 1 : Math.max(first - core.x, core.x + core.width - 1 - last) / core.width;
  };
  return edgeRowInset(0.1) <= 0.11 && edgeRowInset(0.9) <= 0.11;
}

function unpremultiplyChannel(
  rgba: Uint8Array | Uint8ClampedArray,
  offset: number,
  c: number,
): number {
  const alpha = rgba[offset + 3] ?? 0;
  if (alpha >= 255) return rgba[offset + c] ?? 0;
  if (alpha <= 0) return 0;
  return Math.min(255, Math.round(((rgba[offset + c] ?? 0) * 255) / alpha));
}

function sampleRimStudioColor(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): readonly [number, number, number] | null {
  const rimX = Math.max(1, Math.round(width * 0.08));
  const rimY = Math.max(1, Math.round(height * 0.08));
  const bins = new Map<string, { count: number; color: [number, number, number] }>();
  const samples: Array<readonly [number, number, number]> = [];
  let rimPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= rimX && x < width - rimX && y >= rimY && y < height - rimY) continue;
      rimPixels += 1;
      const offset = (x + y * width) * 4;
      if ((rgba[offset + 3] ?? 0) < 240) continue;
      const r = unpremultiplyChannel(rgba, offset, 0);
      const g = unpremultiplyChannel(rgba, offset, 1);
      const b = unpremultiplyChannel(rgba, offset, 2);
      samples.push([r, g, b]);
      const key = `${Math.round(r / 16)}:${Math.round(g / 16)}:${Math.round(b / 16)}`;
      const existing = bins.get(key);
      if (existing) existing.count += 1;
      else bins.set(key, { count: 1, color: [r, g, b] });
    }
  }

  const winner = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!winner || samples.length / Math.max(1, rimPixels) < 0.85) return null;

  const matching = samples.filter(
    (s) =>
      Math.max(
        Math.abs(s[0] - winner.color[0]),
        Math.abs(s[1] - winner.color[1]),
        Math.abs(s[2] - winner.color[2]),
      ) < 18,
  );
  if (matching.length / samples.length < 0.94) return null;

  const avg: [number, number, number] = [0, 0, 0];
  for (const s of matching) {
    avg[0] += s[0];
    avg[1] += s[1];
    avg[2] += s[2];
  }
  avg[0] = Math.round(avg[0] / matching.length);
  avg[1] = Math.round(avg[1] / matching.length);
  avg[2] = Math.round(avg[2] / matching.length);
  const low = Math.min(avg[0], avg[1], avg[2]);
  const high = Math.max(avg[0], avg[1], avg[2]);
  // Only strip bright, neutral studio mattes (white/light-gray JPEG/PNG cards).
  if (low < 228 || high - low > 16) return null;
  return avg;
}

/** Separates an edge-connected near-white studio matte from opaque logo assets. */
export function stripOpaqueStudioMatte(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): TaggedPixels | null {
  const bg = sampleRimStudioColor(rgba, width, height);
  if (!bg) return null;

  const total = width * height;
  const visited = new Uint8Array(total);
  const removedMask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  let removedOpaque = 0;
  let totalOpaque = 0;

  for (let i = 0; i < total; i += 1) {
    if ((rgba[i * 4 + 3] ?? 0) >= 32) totalOpaque += 1;
  }

  const visit = (pixel: number) => {
    if (visited[pixel]) return;
    visited[pixel] = 1;
    const off = pixel * 4;
    const alpha = rgba[off + 3] ?? 0;
    if (alpha > 224) {
      const dist = Math.max(
        Math.abs(unpremultiplyChannel(rgba, off, 0) - bg[0]),
        Math.abs(unpremultiplyChannel(rgba, off, 1) - bg[1]),
        Math.abs(unpremultiplyChannel(rgba, off, 2) - bg[2]),
      );
      if (dist > 28) return;
    }
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    visit(y * width);
    visit(y * width + width - 1);
  }

  while (head < tail) {
    const pixel = queue[head]!;
    head += 1;
    removedMask[pixel] = 1;
    if ((rgba[pixel * 4 + 3] ?? 0) >= 32) removedOpaque += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) visit(pixel - 1);
    if (x < width - 1) visit(pixel + 1);
    if (y > 0) visit(pixel - width);
    if (y < height - 1) visit(pixel + width);
  }

  if (removedOpaque < totalOpaque * 0.16 || totalOpaque - removedOpaque < totalOpaque * 0.025) {
    return null;
  }

  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < total; i += 1) {
    if (!removedMask[i]) continue;
    const off = i * 4;
    out[off] = 0;
    out[off + 1] = 0;
    out[off + 2] = 0;
    out[off + 3] = 0;
  }

  // Smooth AA fringe on newly exposed inner perimeter pixels next to removed matte.
  const matteAvg = (bg[0] + bg[1] + bg[2]) / 3;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = x + y * width;
      if (removedMask[pixel]) continue;
      const touchesMatte =
        (x > 0 && removedMask[pixel - 1] === 1) ||
        (x < width - 1 && removedMask[pixel + 1] === 1) ||
        (y > 0 && removedMask[pixel - width] === 1) ||
        (y < height - 1 && removedMask[pixel + width] === 1);
      if (!touchesMatte) continue;
      const off = pixel * 4;
      const sr = unpremultiplyChannel(out, off, 0);
      const sg = unpremultiplyChannel(out, off, 1);
      const sb = unpremultiplyChannel(out, off, 2);
      const chroma = Math.max(sr, sg, sb) - Math.min(sr, sg, sb);
      const luma = (sr + sg + sb) / 3;
      if (chroma > 24 || luma >= matteAvg - 24) continue;
      const cov = Math.max(0, Math.min(1, (matteAvg - luma) / Math.max(32, matteAvg - 32)));
      if (cov < 0.99 && cov > 0) {
        const nextAlpha = Math.round((out[off + 3] ?? 255) * cov);
        const k = nextAlpha / 255;
        out[off] = Math.round(Math.max(0, (sr - bg[0] * (1 - cov)) / cov) * k);
        out[off + 1] = Math.round(Math.max(0, (sg - bg[1] * (1 - cov)) / cov) * k);
        out[off + 2] = Math.round(Math.max(0, (sb - bg[2] * (1 - cov)) / cov) * k);
        out[off + 3] = nextAlpha;
      }
    }
  }
  return premultipliedIconPixels(out);
}

/**
 * Crops around visible pixels while optically centering the dense core bounds
 * and computing the exact foreground scale factor for the enclosure slot.
 */
export function prepareDistinctForegroundCrop(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  core: PixelBounds,
  visible: PixelBounds,
): { rgba: TaggedPixels; width: number; height: number; scale: number } {
  const cx = core.x + core.width * 0.5;
  const cy = core.y + core.height * 0.5;
  const halfW = Math.ceil(Math.max(cx - visible.x, visible.x + visible.width - cx)) + 1;
  const halfH = Math.ceil(Math.max(cy - visible.y, visible.y + visible.height - cy)) + 1;
  const outW = Math.max(2, halfW * 2);
  const outH = Math.max(2, halfH * 2);
  const srcLeft = Math.round(cx - halfW);
  const srcTop = Math.round(cy - halfH);
  const out = new Uint8ClampedArray(outW * outH * 4);

  for (let y = 0; y < outH; y += 1) {
    const sy = srcTop + y;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < outW; x += 1) {
      const sx = srcLeft + x;
      if (sx < 0 || sx >= width) continue;
      const srcOff = (sx + sy * width) * 4;
      const dstOff = (x + y * outW) * 4;
      out[dstOff] = rgba[srcOff] ?? 0;
      out[dstOff + 1] = rgba[srcOff + 1] ?? 0;
      out[dstOff + 2] = rgba[srcOff + 2] ?? 0;
      out[dstOff + 3] = rgba[srcOff + 3] ?? 0;
    }
  }

  const coreExtent = Math.max(1, core.width, core.height);
  const cropSide = Math.max(outW, outH);
  const scale = APP_ICON_METRICS.foregroundFraction * (cropSide / coreExtent);
  return {
    rgba: premultipliedIconPixels(out),
    width: outW,
    height: outH,
    scale,
  };
}
