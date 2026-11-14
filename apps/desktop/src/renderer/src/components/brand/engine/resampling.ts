/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { float16Bits, float16Value, half } from './math';
import { ICON_CUBIC_WEIGHTS } from './luts';

const f = Math.fround;
const clampMax = (value: number, max: number) => Math.max(0, Math.min(max, value));

const RECTILINEAR_WEIGHTS = [
  0x18, 0x14, 0x14, 0x12, 0x12, 0x11, 0x11, 0, 0, 0x0f, 0x0f, 0x0e, 0x0e, 0x0c, 0x0c, 8,
] as const;
const FIXED_ONE = 4294967296;

function sampledHalf(value: number): number {
  const word = float16Bits(value);
  const rounded = float16Value(word);
  if (value === rounded) return word;
  const otherWord = value > rounded ? word + 1 : word - 1;
  const other = float16Value(otherWord);
  return value === (rounded + other) * 0.5 ? Math.max(word, otherWord) : word;
}

/** Averages 2x2 premultiplied byte blocks before format conversion. */
export function iconMipmap2x2(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { rgba: Uint8Array; width: number; height: number } {
  const w = Math.max(1, Math.floor(width / 2));
  const h = Math.max(1, Math.floor(height / 2));
  const output = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        const x0 = x * 2;
        const y0 = y * 2;
        const x1 = Math.min(width - 1, x0 + 1);
        const y1 = Math.min(height - 1, y0 + 1);
        const sum =
          (rgba[(x0 + y0 * width) * 4 + c] ?? 0) +
          (rgba[(x1 + y0 * width) * 4 + c] ?? 0) +
          (rgba[(x0 + y1 * width) * 4 + c] ?? 0) +
          (rgba[(x1 + y1 * width) * 4 + c] ?? 0);
        output[(x + y * w) * 4 + c] = (sum + 2) >>> 2;
      }
    }
  }
  return { rgba: output, width: w, height: h };
}

/** Fixed-point rectilinear image draw used for preparing mip levels. */
export function resampleIconRectilinear(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
): { rgba: Uint8Array; width: number; height: number } {
  if (rgba.length !== width * height * 4 || outputWidth < 1 || outputHeight < 1) {
    throw new Error('Invalid icon raster dimensions');
  }
  const rectilinear = Math.min(1 / f(outputWidth / width), 1 / f(outputHeight / height)) < 4;
  const buildAxis = (size: number, outSize: number) => {
    const inverse = 1 / f(outSize / size);
    const step = Math.trunc(inverse * FIXED_ONE);
    const origin = Math.trunc(inverse * 0.5 * FIXED_ONE);
    return Array.from({ length: outSize }, (_, index) => {
      const coordinate = origin + index * step;
      let pixel = Math.floor(coordinate / FIXED_ONE);
      let weight = 0;
      if (rectilinear && coordinate >= origin && coordinate <= size * FIXED_ONE - origin) {
        const phase = Math.floor((coordinate - pixel * FIXED_ONE) / 268435456);
        const packed = RECTILINEAR_WEIGHTS[phase] ?? 0;
        pixel -= packed >>> 4;
        weight = packed & 15;
      }
      if (pixel < 0) {
        pixel = 0;
        weight = 0;
      }
      if (pixel >= size - (weight > 0 ? 1 : 0)) {
        pixel = size - 1;
        weight = 0;
      }
      return { pixel, weight };
    });
  };
  const xs = buildAxis(width, outputWidth);
  const ys = buildAxis(height, outputHeight);
  const output = new Uint8Array(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const { pixel: sx, weight: wx } = xs[x]!;
      const { pixel: sy, weight: wy } = ys[y]!;
      const x1 = wx ? sx + 1 : sx;
      const y1 = wy ? sy + 1 : sy;
      for (let c = 0; c < 4; c += 1) {
        const p00 = rgba[(sx + sy * width) * 4 + c] ?? 0;
        const p10 = rgba[(x1 + sy * width) * 4 + c] ?? 0;
        const p01 = rgba[(sx + y1 * width) * 4 + c] ?? 0;
        const p11 = rgba[(x1 + y1 * width) * 4 + c] ?? 0;
        const top = p00 * wx + p10 * (16 - wx);
        const bottom = p01 * wx + p11 * (16 - wx);
        output[(x + y * outputWidth) * 4 + c] = (top * wy + bottom * (16 - wy) + 128) >>> 8;
      }
    }
  }
  return { rgba: output, width: outputWidth, height: outputHeight };
}

export function createIconMip(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  level: number,
): { rgba: Uint8Array; width: number; height: number } {
  if (!Number.isInteger(level) || level < 0) {
    throw new Error('Invalid icon mip level');
  }
  const divisor = 2 ** level;
  return resampleIconRectilinear(
    rgba,
    width,
    height,
    Math.max(1, Math.floor(width / divisor)),
    Math.max(1, Math.floor(height / divisor)),
  );
}

/** Linear UNORM8-to-RGBA16F raster resample. */
export function resampleIconLinear(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
): Uint16Array {
  const output = new Uint16Array(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const sx = Math.max(0, Math.min(width - 1, f(f((x + 0.5) / outputWidth) * width) - 0.5));
      const sy = Math.max(0, Math.min(height - 1, f(f((y + 0.5) / outputHeight) * height) - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const tx = Math.round((sx - x0) * 256);
      const ty = Math.round((sy - y0) * 256);
      for (let c = 0; c < 4; c += 1) {
        const a = rgba[(x0 + y0 * width) * 4 + c] ?? 0;
        const b = rgba[(x1 + y0 * width) * 4 + c] ?? 0;
        const d = rgba[(x0 + y1 * width) * 4 + c] ?? 0;
        const e = rgba[(x1 + y1 * width) * 4 + c] ?? 0;
        const weighted =
          ((a * (256 - tx) + b * tx) * (256 - ty) + (d * (256 - tx) + e * tx) * ty) / 65536;
        output[(x + y * outputWidth) * 4 + c] = sampledHalf(Math.round(weighted * 16) / 4080);
      }
    }
  }
  return output;
}

export interface CubicResampleOptions {
  sourceScale?: readonly [number, number] | null;
  sourceOffset?: readonly [number, number];
}

/** Fixed-point 4x4 Catmull-Rom cubic resample into RGBA16F. */
export function resampleIconCubic(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
  { sourceScale = null, sourceOffset = [0, 0] }: CubicResampleOptions = {},
): Uint16Array {
  const output = new Uint16Array(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const sx =
        (sourceScale
          ? f(f((x + 0.5) * sourceScale[0]) + sourceOffset[0])
          : f(f((x + 0.5) / outputWidth) * width)) - 0.5;
      const sy =
        (sourceScale
          ? f(f((y + 0.5) * sourceScale[1]) + sourceOffset[1])
          : f(f((y + 0.5) / outputHeight) * height)) - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const tx = Math.round((sx - x0) * 256) / 256;
      const ty = Math.round((sy - y0) * 256) / 256;
      const phaseX = Math.round(tx * 256) * 4;
      const phaseY = Math.round(ty * 256) * 4;
      for (let c = 0; c < 4; c += 1) {
        let value = 0;
        for (let dy = -1; dy <= 2; dy += 1) {
          for (let dx = -1; dx <= 2; dx += 1) {
            const sourceX = Math.max(0, Math.min(width - 1, x0 + dx));
            const sourceY = Math.max(0, Math.min(height - 1, y0 + dy));
            const wx = (ICON_CUBIC_WEIGHTS[phaseX + dx + 1] ?? 0) / 65536;
            const wy = (ICON_CUBIC_WEIGHTS[phaseY + dy + 1] ?? 0) / 65536;
            value += (rgba[(sourceX + sourceY * width) * 4 + c] ?? 0) * wx * wy;
          }
        }
        value = Math.min(255, Math.max(0, value));
        output[(x + y * outputWidth) * 4 + c] = sampledHalf(Math.round(value * 16) / 4080);
      }
    }
  }
  return output;
}

export function sampleIconHalfLinear(
  { width, height, pixels }: { width: number; height: number; pixels: Uint16Array },
  x: number,
  y: number,
): [number, number, number, number] {
  const px = f(x - 0.5);
  const py = f(y - 0.5);
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const tx = Math.round((px - ix) * 256) / 256;
  const ty = Math.round((py - iy) * 256) / 256;
  const read = (sx: number, sy: number, c: number) =>
    float16Value(pixels[(clampMax(sx, width - 1) + clampMax(sy, height - 1) * width) * 4 + c] ?? 0);
  return [0, 1, 2, 3].map((c) => {
    const a = read(ix, iy, c);
    const b = read(ix + 1, iy, c);
    const d = read(ix, iy + 1, c);
    const e = read(ix + 1, iy + 1, c);
    const top = f(a + f((b - a) * tx));
    const bottom = f(d + f((e - d) * tx));
    const value = f(top + f((bottom - top) * ty));
    const magnitude = Math.abs(value);
    const word = float16Bits(magnitude);
    const rounded = float16Value(word);
    if (magnitude === rounded || !Number.isFinite(magnitude)) return half(value);
    const other = float16Value(magnitude > rounded ? word + 1 : word - 1);
    return magnitude === (rounded + other) / 2
      ? Math.sign(value) * Math.max(rounded, other)
      : half(value);
  }) as [number, number, number, number];
}

const CHANNEL_BITS = {
  rgb10a2: [10, 10, 10, 8],
  rgba8: [8, 8, 8, 8],
} as const;

export interface UnormTexture {
  width: number;
  height: number;
  pixelFormat: 'rgb10a2' | 'rgba8';
  pixels: Uint8Array | Uint8ClampedArray | Uint32Array;
}

export function sampleIconUnormLinear(
  texture: UnormTexture,
  x: number,
  y: number,
): [number, number, number, number] {
  const { width, height, pixelFormat, pixels } = texture;
  const bits = CHANNEL_BITS[pixelFormat];
  const px = f(x - 0.5);
  const py = f(y - 0.5);
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const tx = Math.round((px - ix) * 256);
  const ty = Math.round((py - iy) * 256);
  const read = (sx: number, sy: number, channel: number): number => {
    const i = clampMax(sx, width - 1) + clampMax(sy, height - 1) * width;
    if (pixelFormat === 'rgba8') return pixels[i * 4 + channel] ?? 0;
    const word = pixels[i] ?? 0;
    return channel === 3 ? (word >>> 30) * 85 : (word >>> (channel * 10)) & 1023;
  };
  return bits.map((count, c) => {
    const top = read(ix, iy, c) * (256 - tx) + read(ix + 1, iy, c) * tx;
    const bottom = read(ix, iy + 1, c) * (256 - tx) + read(ix + 1, iy + 1, c) * tx;
    const numerator = top * (256 - ty) + bottom * ty;
    const fractionalScale = 2 ** (12 - count);
    const stored = Math.floor((numerator * fractionalScale) / 65536 + 0.5);
    return half(stored / (fractionalScale * (2 ** count - 1)));
  }) as [number, number, number, number];
}
