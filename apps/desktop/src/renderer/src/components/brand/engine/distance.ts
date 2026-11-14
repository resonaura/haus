/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { float16Bits, float16Value, half } from './math';
import { ICON_DISTANCE_LUT_BITS } from './luts';

const f = Math.fround;
const lengthSquared = (x: number, y: number) => f(f(x * x) + f(y * y));
const lookup = Float32Array.from(ICON_DISTANCE_LUT_BITS, float16Value);
const roundEven = (value: number) => {
  const lower = Math.floor(value);
  return value - lower === 0.5 ? lower + (lower & 1) : Math.round(value);
};

function textureHalf(value: number): number {
  const magnitude = Math.abs(value);
  const word = float16Bits(magnitude);
  const rounded = float16Value(word);
  if (!Number.isFinite(magnitude) || magnitude === rounded) return half(value);
  const other = float16Value(magnitude > rounded ? word + 1 : word - 1);
  return magnitude === (rounded + other) * 0.5
    ? Math.sign(value) * Math.max(rounded, other)
    : half(value);
}

function sampleIconAlpha(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const sx = Math.max(0, Math.min(width - 1, f(x - 0.5)));
  const sy = Math.max(0, Math.min(height - 1, f(y - 0.5)));
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = Math.round((sx - x0) * 256) / 256;
  const ty = Math.round((sy - y0) * 256) / 256;
  const a = f((rgba[(x0 + y0 * width) * 4 + 3] ?? 0) / 255);
  const b = f((rgba[(x1 + y0 * width) * 4 + 3] ?? 0) / 255);
  const c = f((rgba[(x0 + y1 * width) * 4 + 3] ?? 0) / 255);
  const d = f((rgba[(x1 + y1 * width) * 4 + 3] ?? 0) / 255);
  const value = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  return textureHalf(Math.round(value * 4080) / 4080);
}

export function sampleIconQuadraticAlpha(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = half(x - ix);
  const ty = half(y - iy);
  const xx = half(tx * tx);
  const yy = half(ty * ty);
  const wx = half(1 - xx * 0.5);
  const wy = half(1 - yy * 0.5);
  const sx = f(ix - 0.5 + half(half(half(tx - xx) + 0.5) / wx));
  const sy = f(iy - 0.5 + half(half(half(ty - yy) + 0.5) / wy));
  const a = sampleIconAlpha(rgba, width, height, sx, sy);
  const b = sampleIconAlpha(rgba, width, height, ix + 1.5, sy);
  const c = sampleIconAlpha(rgba, width, height, sx, iy + 1.5);
  const d = sampleIconAlpha(rgba, width, height, ix + 1.5, iy + 1.5);
  const top = half(wx * a + half(b - wx * b));
  const bottom = half(wx * c + half(d - wx * d));
  return half(wy * top + half(bottom - wy * bottom));
}

export interface BlurKernelSpec {
  variance: number;
  weights: number[];
  offsets: number[];
  size: number;
  shader: number;
}

export function iconDistanceBlurKernel(varianceInput: number): BlurKernelSpec {
  const variance = f(varianceInput);
  const raw: number[] = [];
  const inverse = 1 / f(variance * 2);
  let sum = 0;
  for (let x = -15; x < 0; x += 1) {
    const weight = Math.exp(-x * x * inverse);
    raw.push(weight);
    sum += weight;
  }
  raw.push(1);
  const normalization = 1 / (sum * 2 + 1);
  for (let i = 0; i < 16; i += 1) raw[i] = (raw[i] ?? 0) * normalization;
  raw[15] = (raw[15] ?? 0) * 0.5;
  const weights: number[] = [];
  const offsets: number[] = [];
  sum = 0;
  for (let i = 0; i < 8; i += 1) {
    const index = 14 - i * 2;
    const weight = f((raw[index] ?? 0) + (raw[index + 1] ?? 0));
    const offset = f((raw[index] ?? 0) / weight + i * 2);
    if (weight < 0.002 || (i > 3 && variance <= 12.25) || (i > 5 && variance <= 27.5625)) {
      weights.push(0);
      offsets.push(0);
    } else {
      weights.push(weight);
      offsets.push(offset);
      sum += weight;
    }
  }
  weights[0] = f(0.5 - sum + (weights[0] ?? 0));
  const size =
    (weights[6] ?? 0) > 0 ? 31 : (weights[4] ?? 0) > 0 ? 23 : (weights[2] ?? 0) > 0 ? 15 : 7;
  return {
    variance,
    weights,
    offsets,
    size,
    shader: size === 31 ? 7 : size === 23 ? 6 : size === 15 ? 5 : 4,
  };
}

function edgeDistance(coverage: number, slope: number): number {
  const x = Math.max(0, Math.min(15, f(f(coverage * 16) - 0.5)));
  const y = Math.max(0, Math.min(15, f(f(slope * 16) - 0.5)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(15, x0 + 1);
  const y1 = Math.min(15, y0 + 1);
  const tx = Math.round((x - x0) * 256) / 256;
  const ty = Math.round((y - y0) * 256) / 256;
  const a = lookup[x0 + y0 * 16] ?? 0;
  const b = lookup[x1 + y0 * 16] ?? 0;
  const c = lookup[x0 + y1 * 16] ?? 0;
  const d = lookup[x1 + y1 * 16] ?? 0;
  const top = f(a + f((b - a) * tx));
  const bottom = f(c + f((d - c) * tx));
  return textureHalf(f(top + f((bottom - top) * ty)));
}

export function iconDistanceSeedPass(
  input: Float32Array,
  width: number,
  height: number,
): Uint16Array {
  const output = new Uint16Array(width * height * 4);
  const alpha = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : (input[(x + y * width) * 4 + 3] ?? 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (x + y * width) * 4;
      const coverage = alpha(x, y);
      const nw = alpha(x - 1, y - 1);
      const n = alpha(x, y - 1);
      const ne = alpha(x + 1, y - 1);
      const w = alpha(x - 1, y);
      const e = alpha(x + 1, y);
      const sw = alpha(x - 1, y + 1);
      const s = alpha(x, y + 1);
      const se = alpha(x + 1, y + 1);
      let nx = half(half(half(e * 2 + half(-w * 2 - nw)) + ne) - sw);
      nx = half(nx + se);
      let ny = half(s * 2 + half(half(-n * 2 - nw) - ne));
      ny = half(half(ny + sw) + se);
      const squared = half(half(nx * nx) + ny * ny);
      if (squared !== 0) {
        const inverse = half(1 / Math.sqrt(squared));
        nx = half(nx * inverse);
        ny = half(ny * inverse);
      }
      if (
        squared > 15 ||
        (squared > 0.5 && coverage > float16Value(0x1955) && coverage < float16Value(0x3bfb))
      ) {
        const slope = half(
          Math.min(Math.abs(nx), Math.abs(ny)) / Math.max(Math.abs(nx), Math.abs(ny)),
        );
        const distance = edgeDistance(coverage, slope);
        output[pixel] = float16Bits(half(nx * distance));
        output[pixel + 1] = float16Bits(half(ny * distance));
      } else {
        output[pixel] = 0x7bff;
        output[pixel + 1] = 0x7bff;
      }
    }
  }
  return output;
}

function sampleNearest(
  input: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  const sx = Math.max(0, Math.min(width - 1, Math.floor(x + 0.5)));
  const sy = Math.max(0, Math.min(height - 1, Math.floor(y + 0.5)));
  return input[(sx + sy * width) * 4 + channel] ?? 0;
}

function sampleLinearAxis(
  input: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  offset: number,
  vertical: boolean,
  channel: number,
): number {
  const coordinate = f(f((vertical ? y : x) + 0.5) + offset);
  const position = f(Math.max(0.5, Math.min((vertical ? height : width) - 0.5, coordinate)) - 0.5);
  const start = Math.floor(position);
  const end = Math.min((vertical ? height : width) - 1, start + 1);
  const fraction = Math.round((position - start) * 256) / 256;
  const a = input[(vertical ? x + start * width : start + y * width) * 4 + channel] ?? 0;
  const b = input[(vertical ? x + end * width : end + y * width) * 4 + channel] ?? 0;
  return textureHalf(a + (b - a) * fraction);
}

export function iconDistanceBlurPass(
  input: Float32Array,
  width: number,
  height: number,
  kernel: BlurKernelSpec,
  vertical = false,
): Uint16Array {
  const output = new Uint16Array(width * height * 4);
  const count = kernel.shader === 7 ? 8 : kernel.shader === 6 ? 6 : kernel.shader === 5 ? 4 : 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let sum = 0;
        for (let i = 0; i < count; i += 1) {
          const offset = kernel.offsets[i] ?? 0;
          const weight = kernel.weights[i] ?? 0;
          const a = sampleLinearAxis(input, width, height, x, y, -offset, vertical, c);
          const b = sampleLinearAxis(input, width, height, x, y, offset, vertical, c);
          sum = f(a * weight + sum);
          sum = f(b * weight + sum);
        }
        output[(x + y * width) * 4 + c] = float16Bits(sum);
      }
    }
  }
  return output;
}

export function iconDistanceCoveragePass(
  input: Float32Array,
  width: number,
  height: number,
): Uint16Array {
  const output = new Uint16Array(width * height * 4);
  const alpha = (x: number, y: number) => half((input[(x + y * width) * 4 + 3] ?? 0) - 0.5);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x0 = x & ~1;
      const y0 = y & ~1;
      const dx = half(alpha(Math.min(width - 1, x0 + 1), y) - alpha(x0, y));
      const dy = half(alpha(x, Math.min(height - 1, y0 + 1)) - alpha(x, y0));
      const derivative = half(Math.abs(dx) + Math.abs(dy));
      const coverage = Math.max(0, Math.min(1, half(half(alpha(x, y) / derivative) + 0.5)));
      output.fill(float16Bits(coverage), (x + y * width) * 4, (x + y * width) * 4 + 4);
    }
  }
  return output;
}

export function iconDistanceValuePass(
  input: Float32Array,
  width: number,
  height: number,
  scaleInput: number,
  zeroInput: number,
  dualChannels = false,
): Uint16Array {
  const output = new Uint16Array(width * height * 4);
  const scale = f(scaleInput);
  const zero = f(zeroInput);
  for (let i = 0; i < width * height; i += 1) {
    const pixel = i * 4;
    const length = f(Math.sqrt(lengthSquared(input[pixel] ?? 0, input[pixel + 1] ?? 0)));
    const signed = (input[pixel + 3] ?? 0) < 0.5 ? -length : length;
    const value = Math.max(0, Math.min(1, f(signed * scale + zero)));
    if (dualChannels) {
      output[pixel] = float16Bits(f(value - zero));
      output[pixel + 1] = float16Bits(value);
    } else {
      output.fill(float16Bits(value), pixel, pixel + 4);
    }
  }
  return output;
}

export function iconDistanceJumpPass(
  input: Float32Array,
  width: number,
  height: number,
  step: number,
  correct = false,
): Uint16Array {
  const output = new Uint16Array(width * height * 4);
  const neighbors: ReadonlyArray<readonly [number, number]> = [
    [0, -step],
    [-step, 0],
    [step, 0],
    [0, step],
    [-step, -step],
    [step, -step],
    [-step, step],
    [step, step],
  ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (x + y * width) * 4;
      let vx = input[pixel] ?? 0;
      let vy = input[pixel + 1] ?? 0;
      let squared = lengthSquared(vx, vy);
      for (const [dx, dy] of neighbors) {
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        const source = (sx + sy * width) * 4;
        const cx = f((input[source] ?? 0) + dx);
        const cy = f((input[source + 1] ?? 0) + dy);
        const candidate = lengthSquared(cx, cy);
        if (candidate < squared) {
          vx = cx;
          vy = cy;
          squared = candidate;
        }
      }
      if (correct && squared < 4) {
        const nx = sampleNearest(input, width, height, f(x + vx), f(y + vy), 0);
        const ny = sampleNearest(input, width, height, f(x + vx), f(y + vy), 1);
        const inverse = f(1 / Math.sqrt(lengthSquared(nx, ny)));
        const tx = f(-f(ny * inverse));
        const ty = f(nx * inverse);
        const projection = f(f(-vx * tx) + f(-vy * ty));
        if (Math.abs(projection) < 1) {
          vx = f(tx * projection + vx);
          vy = f(ty * projection + vy);
        }
      }
      output[pixel] = float16Bits(vx);
      output[pixel + 1] = float16Bits(vy);
    }
  }
  return output;
}

export function iconDistanceNormalPass(
  input: Float32Array,
  width: number,
  height: number,
): Uint16Array {
  const output = new Uint16Array(width * height * 4);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = (x + y * width) * 4;
      const center = input[pixel + 1] ?? 0;
      if (center === 0) continue;
      let nx = half((input[pixel + 4] ?? 0) - (input[pixel - 4] ?? 0));
      let ny = half((input[pixel + width * 4] ?? 0) - (input[pixel - width * 4] ?? 0));
      if (nx !== 0 || ny !== 0) {
        const inverse = f(1 / Math.sqrt(lengthSquared(nx, ny)));
        nx = f(nx * inverse);
        ny = f(ny * inverse);
      }
      output[pixel] = float16Bits(center);
      output[pixel + 1] = float16Bits(f(nx * 0.5 + 0.5));
      output[pixel + 2] = float16Bits(f(ny * 0.5 + 0.5));
      output[pixel + 3] = 0x3c00;
    }
  }
  return output;
}

export interface DistanceFieldSettings {
  maxDistance: number;
  smoothing: number;
  pixelFormat: 'rgb10a2' | 'rgba16float';
  padding?: number;
  alpha?: Float32Array;
}

export function nativeIconDistanceSettings(width: number, height: number): DistanceFieldSettings {
  const size = Math.min(width, height);
  return {
    maxDistance: size * 0.2,
    smoothing: size * 0.005,
    pixelFormat: size > 256 ? 'rgba16float' : 'rgb10a2',
  };
}

export function generateIconDistanceField(
  rgba: Uint8Array | Uint8ClampedArray | null,
  width: number,
  height: number,
  settings: Partial<DistanceFieldSettings> = {},
): Uint16Array {
  const padding = settings.padding ?? 2;
  const w = width + padding * 2;
  const h = height + padding * 2;
  const distance = f(settings.maxDistance ?? Math.min(width, height) * 0.2);
  const smoothing = f(settings.smoothing ?? Math.min(width, height) * 0.005);
  const input = new Float32Array(w * h * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = settings.alpha
        ? (settings.alpha[x + y * width] ?? 0)
        : (rgba?.[(x + y * width) * 4 + 3] ?? 0) / 255;
      input[(x + padding + (y + padding) * w) * 4 + 3] = half(a);
    }
  }
  const decode = (words: Uint16Array) => Float32Array.from(words, float16Value);
  const coverage = decode(iconDistanceCoveragePass(input, w, h));
  if (settings.pixelFormat === 'rgb10a2') {
    for (let i = 0; i < w * h; i += 1) {
      const value = half(roundEven((coverage[i * 4] ?? 0) * 255) / 255);
      coverage.fill(value, i * 4, i * 4 + 4);
    }
  }
  let field = decode(iconDistanceSeedPass(coverage, w, h));
  const exponent = Math.max(2, Math.min(12, Math.ceil(Math.log2(distance))));
  for (let step = 2 ** (exponent - 1); step >= 1; step /= 2) {
    field = decode(iconDistanceJumpPass(field, w, h, step, step === 1));
  }
  for (let i = 0; i < w * h; i += 1) {
    field[i * 4 + 3] = coverage[i * 4 + 3] ?? 0;
  }
  field = decode(iconDistanceValuePass(field, w, h, f(1 / f(distance * 2)), 0.5, true));
  const distanceValues = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) distanceValues[i] = field[i * 4 + 1] ?? 0;
  let variance = f(smoothing * smoothing);
  while (variance > 0.001) {
    const kernel = iconDistanceBlurKernel(Math.min(variance, 12.25));
    field = decode(iconDistanceBlurPass(field, w, h, kernel));
    field = decode(iconDistanceBlurPass(field, w, h, kernel, true));
    variance = f(Math.max(0, variance - 12.25));
  }
  for (let i = 0; i < w * h; i += 1) field[i * 4 + 1] = distanceValues[i] ?? 0;
  const normals = iconDistanceNormalPass(field, w, h);
  const result = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    result.set(
      normals.subarray(
        ((y + padding) * w + padding) * 4,
        ((y + padding) * w + padding + width) * 4,
      ),
      y * width * 4,
    );
  }
  return result;
}

export function packIconDistanceField(field: Uint16Array): Uint32Array {
  const output = new Uint32Array(field.length / 4);
  const unorm = (word: number) => {
    const xr = half((roundEven(float16Value(word) * 510 + 384) - 384) / 510);
    return roundEven(Math.min(1, Math.max(0, xr)) * 1023);
  };
  for (let i = 0; i < output.length; i += 1) {
    const p = i * 4;
    output[i] =
      (unorm(field[p] ?? 0) |
        (unorm(field[p + 1] ?? 0) << 10) |
        (unorm(field[p + 2] ?? 0) << 20) |
        (Math.round(float16Value(field[p + 3] ?? 0) * 3) << 30)) >>>
      0;
  }
  return output;
}
