/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { premultipliedIconPixels, type TaggedPixels } from './math.js';

const SOLID_TILE_ALPHA = 250;
const OUTPAINT_SEED_ALPHA = 252;

function unpremultiplyChannel(
  rgba: Uint8Array | Uint8ClampedArray,
  offset: number,
  channel: number,
): number {
  const alpha = rgba[offset + 3] ?? 0;
  if (alpha >= 255) return rgba[offset + channel] ?? 0;
  if (alpha <= 0) return 0;
  return Math.min(255, Math.round(((rgba[offset + channel] ?? 0) * 255) / alpha));
}

/**
 * Extends solid interior tile colors smoothly across edge-connected rounded corners
 * and semi-transparent perimeter AA fringes so pre-rounded icons fill the continuous
 * enclosure cleanly without a 1px gap or double-AA rim.
 */
export function outpaintFullBleedTile(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): TaggedPixels {
  const total = width * height;
  if (width < 2 || height < 2 || rgba.length < total * 4) {
    return premultipliedIconPixels(Uint8ClampedArray.from(rgba));
  }

  let solidCount = 0;
  for (let i = 0; i < total; i += 1) {
    if ((rgba[i * 4 + 3] ?? 0) >= OUTPAINT_SEED_ALPHA) solidCount += 1;
  }
  if (solidCount === total) {
    return premultipliedIconPixels(Uint8ClampedArray.from(rgba));
  }

  const seedThreshold = solidCount >= total / 2 ? OUTPAINT_SEED_ALPHA : 240;
  const exterior = new Uint8Array(total);
  const bfs: number[] = [];

  const enqueueExterior = (px: number) => {
    if (exterior[px]) return;
    if ((rgba[px * 4 + 3] ?? 0) >= seedThreshold) return;
    exterior[px] = 1;
    bfs.push(px);
  };

  for (let x = 0; x < width; x += 1) {
    enqueueExterior(x);
    enqueueExterior((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueueExterior(y * width);
    enqueueExterior(y * width + (width - 1));
  }

  for (let head = 0; head < bfs.length; head += 1) {
    const px = bfs[head]!;
    const x = px % width;
    const y = Math.floor(px / width);
    if (x > 0) enqueueExterior(px - 1);
    if (x < width - 1) enqueueExterior(px + 1);
    if (y > 0) enqueueExterior(px - width);
    if (y < height - 1) enqueueExterior(px + width);
  }
  if (bfs.length === 0) {
    return premultipliedIconPixels(Uint8ClampedArray.from(rgba));
  }

  const out = new Uint8ClampedArray(rgba);
  const state = new Int32Array(total);
  for (let i = 0; i < total; i += 1) {
    if (!exterior[i] && (rgba[i * 4 + 3] ?? 0) >= seedThreshold) state[i] = 1;
  }

  const queued = new Uint8Array(total);
  let frontier: number[] = [];
  for (const px of bfs) {
    const x = px % width;
    const y = Math.floor(px / width);
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    const x0 = Math.max(0, x - 1);
    const x1 = Math.min(width - 1, x + 1);
    let touchesSeed = false;
    for (let ny = y0; ny <= y1 && !touchesSeed; ny += 1) {
      for (let nx = x0; nx <= x1; nx += 1) {
        if ((state[ny * width + nx] ?? 0) === 1) {
          touchesSeed = true;
          break;
        }
      }
    }
    if (touchesSeed) {
      queued[px] = 1;
      frontier.push(px);
    }
  }

  let wave = 1;
  while (frontier.length > 0) {
    const prevWave = wave;
    wave += 1;
    const nextFrontier: number[] = [];

    for (const px of frontier) {
      const x = px % width;
      const y = Math.floor(px / width);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(height - 1, y + 1);
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let wSum = 0;
      for (let ny = y0; ny <= y1; ny += 1) {
        for (let nx = x0; nx <= x1; nx += 1) {
          const nIdx = ny * width + nx;
          const s = state[nIdx] ?? 0;
          if (s <= 0 || s > prevWave) continue;
          const wt = nx === x || ny === y ? 2 : 1;
          const nOff = nIdx * 4;
          sumR += unpremultiplyChannel(out, nOff, 0) * wt;
          sumG += unpremultiplyChannel(out, nOff, 1) * wt;
          sumB += unpremultiplyChannel(out, nOff, 2) * wt;
          wSum += wt;
        }
      }
      if (wSum <= 0) continue;
      const off = px * 4;
      out[off] = Math.min(255, Math.max(0, Math.round(sumR / wSum)));
      out[off + 1] = Math.min(255, Math.max(0, Math.round(sumG / wSum)));
      out[off + 2] = Math.min(255, Math.max(0, Math.round(sumB / wSum)));
      out[off + 3] = 255;
    }

    for (const px of frontier) state[px] = wave;

    for (const px of frontier) {
      const x = px % width;
      const y = Math.floor(px / width);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(height - 1, y + 1);
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      for (let ny = y0; ny <= y1; ny += 1) {
        for (let nx = x0; nx <= x1; nx += 1) {
          const nIdx = ny * width + nx;
          if (!exterior[nIdx] || (state[nIdx] ?? 0) !== 0 || queued[nIdx]) continue;
          queued[nIdx] = 1;
          nextFrontier.push(nIdx);
        }
      }
    }

    frontier = nextFrontier;
  }

  return premultipliedIconPixels(out);
}

/**
 * Tightens a detected tile bounding box past any 1-3px semi-transparent AA/shadow
 * border rows, crops to a centered square, and outpaints all rounded corners solid.
 */
export function cropAndOutpaintTile(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  box: readonly [number, number, number, number],
): { rgba: TaggedPixels; width: number; height: number } {
  let left = Math.max(0, Math.min(Math.max(0, width - 1), box[0]));
  let top = Math.max(0, Math.min(Math.max(0, height - 1), box[1]));
  let right = Math.max(left + 1, Math.min(width, box[0] + box[2]));
  let bottom = Math.max(top + 1, Math.min(height, box[1] + box[3]));

  const bw = right - left;
  const bh = bottom - top;
  const maxTrim = Math.min(3, Math.floor(Math.min(bw, bh) / 16));
  const alphaAt = (x: number, y: number) => rgba[(x + y * width) * 4 + 3] ?? 0;

  if (maxTrim > 0 && bw >= 16 && bh >= 16) {
    const midX0 = left + Math.floor(bw * 0.3);
    const midX1 = Math.max(midX0 + 1, left + Math.floor(bw * 0.7));
    const midY0 = top + Math.floor(bh * 0.3);
    const midY1 = Math.max(midY0 + 1, top + Math.floor(bh * 0.7));

    const isSolidRow = (y: number): boolean => {
      let solid = 0;
      const len = midX1 - midX0;
      for (let x = midX0; x < midX1; x += 1) {
        if (alphaAt(x, y) >= SOLID_TILE_ALPHA) solid += 1;
      }
      return solid * 100 >= len * 85;
    };

    const isSolidCol = (x: number): boolean => {
      let solid = 0;
      const len = midY1 - midY0;
      for (let y = midY0; y < midY1; y += 1) {
        if (alphaAt(x, y) >= SOLID_TILE_ALPHA) solid += 1;
      }
      return solid * 100 >= len * 85;
    };

    for (let t = 0; t < maxTrim && bottom - top > 16 && !isSolidRow(top); t += 1) top += 1;
    for (let t = 0; t < maxTrim && bottom - top > 16 && !isSolidRow(bottom - 1); t += 1) {
      bottom -= 1;
    }
    for (let t = 0; t < maxTrim && right - left > 16 && !isSolidCol(left); t += 1) left += 1;
    for (let t = 0; t < maxTrim && right - left > 16 && !isSolidCol(right - 1); t += 1) right -= 1;
  }

  const tw = right - left;
  const th = bottom - top;
  const side = Math.max(1, Math.min(tw, th));
  const cx = left + Math.trunc((tw - side) / 2);
  const cy = top + Math.trunc((th - side) / 2);
  const cropped = new Uint8ClampedArray(side * side * 4);
  for (let row = 0; row < side; row += 1) {
    const srcStart = ((cy + row) * width + cx) * 4;
    cropped.set(rgba.subarray(srcStart, srcStart + side * 4), row * side * 4);
  }
  return {
    rgba: outpaintFullBleedTile(cropped, side, side),
    width: side,
    height: side,
  };
}
