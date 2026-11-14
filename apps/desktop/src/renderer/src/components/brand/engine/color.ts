/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { float16Bits, float16Value, half, halfFma } from './math';
import { ICON_COLOR_TRANSFER_BITS } from './transfer-table';
import { ICON_DITHER_NOISE_RGB } from './luts';

const f = Math.fround;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const roundEven = (value: number): number => {
  const low = Math.floor(value);
  const delta = value - low;
  return delta === 0.5 ? low + (low & 1) : Math.round(value);
};

export const unorm8 = (value: number): number => roundEven(clamp01(value) * 255);
export const stored8 = (value: number): number => half(unorm8(value) / 255);

export type RgbaTuple = [number, number, number, number];
export type RgbTuple = [number, number, number];

export const DARK_BACKGROUND: RgbTuple = [f(20 / 255), f(20 / 255), f(20 / 255)];

/** Half-precision sRGB transfer lookup across positive half domain. */
export function iconSRGBTransfer(value: number, toLinear: boolean): number {
  const bits = float16Bits(value);
  const index = (toLinear ? 4096 : 0) + ((bits & 0x7fff) >>> 3);
  const result = ICON_COLOR_TRANSFER_BITS[index] ?? 0;
  return float16Value((result & 0x7fff) | (bits & 0x8000));
}

export interface ResolveColorOptions {
  sourceSRGB?: boolean;
  targetSRGB?: boolean;
  matrix?: readonly number[] | null;
  straightAlpha?: boolean;
}

/** Resolves half-precision RGBA colors through optional linear matrix transform. */
export function resolveIconColor(
  color: readonly number[],
  {
    sourceSRGB = true,
    targetSRGB = true,
    matrix = null,
    straightAlpha = false,
  }: ResolveColorOptions = {},
): RgbaTuple {
  const c0 = half(color[0] ?? 0);
  const c1 = half(color[1] ?? 0);
  const c2 = half(color[2] ?? 0);
  const c3 = half(color[3] ?? 0);
  if (!matrix && sourceSRGB === targetSRGB) return [c0, c1, c2, c3];
  const minAlpha = float16Value(0x1419);
  const alpha = !straightAlpha && c3 <= minAlpha ? 0 : c3;
  let rgb: RgbTuple = straightAlpha
    ? [c0, c1, c2]
    : alpha > minAlpha
      ? [half(c0 / alpha), half(c1 / alpha), half(c2 / alpha)]
      : [0, 0, 0];
  if (sourceSRGB) {
    rgb = [
      iconSRGBTransfer(rgb[0], true),
      iconSRGBTransfer(rgb[1], true),
      iconSRGBTransfer(rgb[2], true),
    ];
  }
  if (matrix) {
    const cols = matrix.map(half);
    rgb = [0, 1, 2].map((c) =>
      halfFma(
        rgb[2],
        cols[c + 6] ?? 0,
        halfFma(rgb[0], cols[c] ?? 0, half(rgb[1] * (cols[c + 3] ?? 0))),
      ),
    ) as RgbTuple;
  }
  if (targetSRGB) {
    rgb = [
      iconSRGBTransfer(rgb[0], false),
      iconSRGBTransfer(rgb[1], false),
      iconSRGBTransfer(rgb[2], false),
    ];
  }
  if (!straightAlpha) {
    rgb = [half(rgb[0] * alpha), half(rgb[1] * alpha), half(rgb[2] * alpha)];
  }
  return [rgb[0], rgb[1], rgb[2], alpha];
}

/** Clamps unpremultiplied linear RGB then re-encodes through the half transfer LUT. */
export function clampIconColor(color: readonly number[]): RgbaTuple {
  const input: RgbaTuple = [
    half(color[0] ?? 0),
    half(color[1] ?? 0),
    half(color[2] ?? 0),
    half(color[3] ?? 0),
  ];
  const alpha = input[3];
  if (alpha <= float16Value(0x1419)) return [0, 0, 0, 0];
  const clampChan = (value: number) => {
    const linear = iconSRGBTransfer(half(value / alpha), true);
    return half(iconSRGBTransfer(clamp01(linear), false) * alpha);
  };
  return [clampChan(input[0]), clampChan(input[1]), clampChan(input[2]), alpha];
}

const GRAY_RESOLVE_MATRIX = [
  0.2225341796875, 0.2225341796875, 0.2225341796875, 0.716796875, 0.716796875, 0.716796875,
  0.06060791015625, 0.06060791015625, 0.06060791015625,
];
const GRAY_WEIGHTS = [0.2126, 0.7152, 0.0722].map(half);

/** Produces two-channel RG8 gray+alpha raster from half-precision RGBA buffer. */
export function createIconMonochromeRaster(
  rgbaHalf: Uint16Array,
  width: number,
  height: number,
): Uint8Array {
  if (rgbaHalf.length !== width * height * 4) {
    throw new Error('Invalid icon raster dimensions');
  }
  const output = new Uint8Array(width * height * 2);
  const w0 = GRAY_WEIGHTS[0] ?? 0;
  const w1 = GRAY_WEIGHTS[1] ?? 0;
  const w2 = GRAY_WEIGHTS[2] ?? 0;
  for (let i = 0; i < width * height; i += 1) {
    const c0 = stored8(float16Value(rgbaHalf[i * 4] ?? 0));
    const c1 = stored8(float16Value(rgbaHalf[i * 4 + 1] ?? 0));
    const c2 = stored8(float16Value(rgbaHalf[i * 4 + 2] ?? 0));
    const c3 = stored8(float16Value(rgbaHalf[i * 4 + 3] ?? 0));
    const luma = halfFma(c2, w2, halfFma(c1, w1, half(c0 * w0)));
    const gray = stored8(luma);
    const resolved = resolveIconColor([gray, gray, gray, c3], { matrix: GRAY_RESOLVE_MATRIX });
    output[i * 2] = unorm8(resolved[0]);
    output[i * 2 + 1] = unorm8(resolved[3]);
  }
  return output;
}

export function iconContrastRatio(
  a: readonly number[],
  b: readonly number[] = DARK_BACKGROUND,
): number {
  const luminance = (rgb: readonly number[]) => {
    const lin = (v: number) =>
      v > 0.04045 ? f(Math.pow(f((v + 0.055) / 1.055), f(2.4))) : f(v / 12.92);
    const l0 = lin(rgb[0] ?? 0);
    const l1 = lin(rgb[1] ?? 0);
    const l2 = lin(rgb[2] ?? 0);
    return f(f(f(l0 * f(0.2126)) + f(l1 * f(0.7152))) + f(l2 * f(0.0722)));
  };
  const x = luminance(a);
  const y = luminance(b);
  return f((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05));
}

function rgbHSV(rgb: readonly number[]): RgbTuple {
  const r = rgb[0] ?? 0;
  const g = rgb[1] ?? 0;
  const b = rgb[2] ?? 0;
  const select = (a: readonly number[], other: readonly number[], cond: boolean) =>
    a.map((val, i) => f(f((other[i] ?? 0) - val) * Number(cond) + val));
  const p = select([b, g, -1, f(2 / 3)], [g, b, 0, f(-1 / 3)], g >= b);
  const q = select(
    [p[0] ?? 0, p[1] ?? 0, p[3] ?? 0, r],
    [r, p[1] ?? 0, p[2] ?? 0, p[0] ?? 0],
    r >= (p[0] ?? 0),
  );
  const d = f((q[0] ?? 0) - Math.min(q[3] ?? 0, q[1] ?? 0));
  return [
    Math.abs(f((q[2] ?? 0) + f((q[3] ?? 0) - (q[1] ?? 0)) / (6 * d + f(0.0001)))),
    f(d / f((q[0] ?? 0) + f(0.0001))),
    q[0] ?? 0,
  ];
}

function hsvRGB([h, s, v]: readonly number[]): RgbTuple {
  return [1, f(2 / 3), f(1 / 3)].map((offset) => {
    const position = f((h ?? 0) + offset);
    const fraction = Math.min(f(position - Math.floor(position)), f(1 - 2 ** -24));
    const component = f(Math.abs(f(fraction * 6 - 3)) - 1);
    return f(f(f(Math.max(0, Math.min(1, component)) - 1) * (s ?? 0) + 1) * (v ?? 0));
  }) as RgbTuple;
}

export function lightenIconColorOverDarkBackground(source: readonly number[]): {
  success: boolean;
  color: number[];
} {
  const s = source.map(f);
  if (iconContrastRatio(s) >= 4.5) return { success: true, color: s };
  const hsv = rgbHSV(s);
  for (let v = f(hsv[2] + 0.05); v <= 1; v = f(v + 0.05)) {
    const color = hsvRGB([hsv[0], hsv[1], v]);
    if (iconContrastRatio(color) >= 4.5) return { success: true, color };
  }
  for (let sat = f(hsv[1] - 0.05); sat >= 0; sat = f(sat - 0.05)) {
    const color = hsvRGB([hsv[0], sat, 1]);
    if (iconContrastRatio(color) >= 3) return { success: true, color };
  }
  return { success: false, color: s };
}

export function chooseDarkIconColor(
  foreground: readonly number[],
  background: readonly number[],
  allowRecolor = true,
): { success: boolean; color: number[] } {
  const fg = foreground.map(f);
  const bg = background.map(f);
  const nearBW = (color: readonly number[]) => {
    const r = color[0] ?? 0;
    const g = color[1] ?? 0;
    const b = color[2] ?? 0;
    const len = Math.sqrt(f(f(f(r * r) + f(g * g)) + f(b * b)));
    const d0 = f(r - 1);
    const d1 = f(g - 1);
    const d2 = f(b - 1);
    const invLen = Math.sqrt(f(f(f(d0 * d0) + f(d1 * d1)) + f(d2 * d2)));
    return len <= 60 / 255 || invLen <= 60 / 255;
  };
  const fgBW = nearBW(fg);
  const bgBW = nearBW(bg);
  const fgReadable = iconContrastRatio(fg) >= 3;
  const bgReadable = iconContrastRatio(bg) >= 3;
  const selected = fgReadable && bgBW ? fg : fgBW && bgReadable ? bg : null;
  if (!allowRecolor) return { success: Boolean(selected), color: selected ?? [0, 0, 0] };
  if (selected) return { ...lightenIconColorOverDarkBackground(selected), success: true };
  const adjustedForeground = lightenIconColorOverDarkBackground(fg);
  if (bgBW && adjustedForeground.success) return adjustedForeground;
  if (fgBW) return lightenIconColorOverDarkBackground(bg);
  return { success: false, color: adjustedForeground.color };
}

export function iconGlyphTranslucencyStops(strength: number): Float32Array {
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new RangeError('Translucency must be between zero and one');
  }
  const colors = new Float32Array(17 * 4);
  for (let i = 0; i < 17; i += 1) {
    const value = (i / 16) * strength;
    colors[i * 4 + 3] = f(1 - value * value * (3 - 2 * value));
  }
  return colors;
}

export function premultiplyIconGradientStops(colors: Float32Array, opacity = 1): Float32Array {
  const output = new Float32Array(colors.length);
  for (let i = 0; i < colors.length; i += 4) {
    const alpha = half(f(f(opacity) * half(colors[i + 3] ?? 0)));
    for (let c = 0; c < 3; c += 1) {
      output[i + c] = half(half(colors[i + c] ?? 0) * alpha);
    }
    output[i + 3] = alpha;
  }
  return output;
}

function smoothCoefficients(a: number, b: number, c: number, d: number): RgbaTuple {
  const left = f(b - a);
  const delta = f(c - b);
  const right = f(d - c);
  let incoming = f(f(delta + left) * 0.5);
  let outgoing = f(f(right + delta) * 0.5);
  if (left < 0 !== delta < 0) incoming = 0;
  if (Math.abs(incoming) > Math.abs(f(left * 3))) incoming = f(left * 3);
  if (Math.abs(incoming) > Math.abs(f(delta * 3))) incoming = f(delta * 3);
  if (delta < 0 !== right < 0) outgoing = 0;
  if (Math.abs(outgoing) > Math.abs(f(delta * 3))) outgoing = f(delta * 3);
  if (Math.abs(outgoing) > Math.abs(f(right * 3))) outgoing = f(right * 3);
  const third = f(1 / 3);
  const p = f(b + third * incoming);
  const q = f(c - third * outgoing);
  return [b, incoming, f(f(f(b - f(p + p)) + q) * 3), f(delta + 3 * f(p - q))];
}

export function iconSmoothGradientCoefficients(premultiplied: Float32Array): Uint16Array {
  const count = premultiplied.length / 4 - 1;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('A gradient requires at least two RGBA stops');
  }
  const output = new Uint16Array(count * 16);
  for (let i = 0; i < count; i += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      const color = (index: number) => half(premultiplied[index * 4 + channel] ?? 0);
      const values = smoothCoefficients(
        color(i ? i - 1 : i),
        color(i),
        color(i + 1),
        color(i + 2 < count ? i + 2 : i + 1),
      );
      for (let c = 0; c < 4; c += 1) {
        output[i * 16 + c * 4 + channel] = float16Bits(values[c] ?? 0);
      }
    }
  }
  return output;
}

export function sampleIconSmoothGradient(coefficients: Uint16Array, position: number): RgbaTuple {
  const count = coefficients.length / 16;
  const t = half(half(Math.max(0, Math.min(1, position))) * half(count));
  const index = Math.min(count - 1, Math.floor(t));
  const fraction = half(t - index);
  const pixel = index * 16;
  return [0, 1, 2, 3].map((channel) => {
    let value = float16Value(coefficients[pixel + 12 + channel] ?? 0);
    for (let i = 2; i >= 0; i -= 1) {
      value = halfFma(value, fraction, float16Value(coefficients[pixel + i * 4 + channel] ?? 0));
    }
    return value;
  }) as RgbaTuple;
}

function sampledHalf(value: number): number {
  const word = float16Bits(value);
  const rounded = float16Value(word);
  if (rounded === value) return rounded;
  const other = float16Value(value > rounded ? word + 1 : word - 1);
  return value === (rounded + other) * 0.5 ? Math.max(rounded, other) : rounded;
}

export function sampleIconDitherNoise(x: number, y: number): RgbTuple {
  const sx = f(f(f(x) * 0.03125) * 32) - 0.5;
  const sy = f(f(f(y) * 0.03125) * 32) - 0.5;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const tx = Math.round((sx - ix) * 256) / 256;
  const ty = Math.round((sy - iy) * 256) / 256;
  const wrap = (value: number) => ((value % 32) + 32) % 32;
  const words = [
    ICON_DITHER_NOISE_RGB[wrap(ix) + wrap(iy) * 32] ?? 0,
    ICON_DITHER_NOISE_RGB[wrap(ix + 1) + wrap(iy) * 32] ?? 0,
    ICON_DITHER_NOISE_RGB[wrap(ix) + wrap(iy + 1) * 32] ?? 0,
    ICON_DITHER_NOISE_RGB[wrap(ix + 1) + wrap(iy + 1) * 32] ?? 0,
  ] as const;
  return [16, 8, 0].map((shift) => {
    const a = (words[0] >>> shift) & 255;
    const b = (words[1] >>> shift) & 255;
    const c = (words[2] >>> shift) & 255;
    const d = (words[3] >>> shift) & 255;
    const value = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    return sampledHalf(Math.round(value * 16) / 4080);
  }) as RgbTuple;
}

export function applyIconImageDither(color: readonly number[], x: number, y: number): RgbaTuple {
  const noise = sampleIconDitherNoise(x, y);
  const alpha = half(color[3] ?? 0);
  const r = halfFma(
    halfFma(noise[0], float16Value(0x2004), float16Value(0x9c04)),
    alpha,
    half(color[0] ?? 0),
  );
  const g = halfFma(
    halfFma(noise[1], float16Value(0x2004), float16Value(0x9c04)),
    alpha,
    half(color[1] ?? 0),
  );
  const b = halfFma(
    halfFma(noise[2], float16Value(0x2004), float16Value(0x9c04)),
    alpha,
    half(color[2] ?? 0),
  );
  return [r, g, b, alpha];
}
