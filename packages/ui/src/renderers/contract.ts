/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  ColorValue,
  LengthValue,
  ViewportMetrics,
} from '../ir/geometry.js';
import type { ShaderRegistry } from '../ir/materials.js';
import type { UiNode, UiTheme } from '../ir/node.js';

export type RendererTarget = 'react-dom' | 'react-native' | 'native-ir';

export interface RenderContext {
  readonly theme: UiTheme;
  readonly viewport: ViewportMetrics;
  readonly shaderRegistry: ShaderRegistry;
}

/**
 * Common OOP renderer contract implemented by Web/React DOM, React Native,
 * and Native (Rust wgpu/Taffy & C++ Skia/Yoga) backends.
 */
export interface UiRenderer<TOutput> {
  readonly target: RendererTarget;
  render(node: UiNode, context: RenderContext): TOutput;
}

/** Converts an OKLCH color to sRGB `[0..255, 0..255, 0..255, 0..1]`. */
function oklchToSrgb(
  l: number,
  c: number,
  hDeg: number,
  alpha: number,
): readonly [number, number, number, number] {
  const hRad = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const rLin = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  const toGamma = (v: number): number => {
    const clamped = Math.max(0, Math.min(1, v));
    const srgb =
      clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  };

  return [toGamma(rLin), toGamma(gLin), toGamma(bLin), Math.max(0, Math.min(1, alpha))];
}

/** Resolves any `ColorValue` to 8-bit sRGB + alpha `[r(0..255), g(0..255), b(0..255), a(0..1)]`. */
export function resolveColorToSrgb(
  color: ColorValue,
  theme: UiTheme,
): readonly [number, number, number, number] {
  switch (color.kind) {
    case 'rgba':
      return [
        Math.round(Math.max(0, Math.min(255, color.r))),
        Math.round(Math.max(0, Math.min(255, color.g))),
        Math.round(Math.max(0, Math.min(255, color.b))),
        Math.max(0, Math.min(1, color.a)),
      ];
    case 'oklch':
      return oklchToSrgb(color.l, color.c, color.h, color.a);
    case 'token': {
      const base = resolveColorToSrgb(theme.color(color.name), theme);
      const nextAlpha = color.alpha !== undefined ? color.alpha : base[3];
      return [base[0], base[1], base[2], Math.max(0, Math.min(1, nextAlpha))];
    }
    case 'mix': {
      const first = resolveColorToSrgb(color.base, theme);
      const second = resolveColorToSrgb(color.target, theme);
      const t = Math.max(0, Math.min(1, color.ratio));
      return [
        Math.round(first[0] * (1 - t) + second[0] * t),
        Math.round(first[1] * (1 - t) + second[1] * t),
        Math.round(first[2] * (1 - t) + second[2] * t),
        Number((first[3] * (1 - t) + second[3] * t).toFixed(4)),
      ];
    }
    case 'transparent':
      return [0, 0, 0, 0];
    case 'current':
      return resolveColorToSrgb(theme.color('textPrimary'), theme);
  }
}

/**
 * Resolves any `ColorValue` into normalized `[r, g, b, a]` (`0..1` float32 tuple)
 * for Rust `wgpu` / C++ Skia shader uniforms and vertex buffers.
 */
export function resolveColorToRgbaTuple(
  color: ColorValue,
  theme: UiTheme,
): readonly [number, number, number, number] {
  const [r, g, b, a] = resolveColorToSrgb(color, theme);
  return [
    Number((r / 255).toFixed(4)),
    Number((g / 255).toFixed(4)),
    Number((b / 255).toFixed(4)),
    Number(a.toFixed(4)),
  ];
}

/** Resolves any `ColorValue` into a CSS / React Native color string. */
export function resolveColorToCss(
  color: ColorValue,
  theme: UiTheme,
  allowModernOklch = true,
): string {
  if (color.kind === 'transparent') return 'transparent';
  if (color.kind === 'current') return 'currentColor';
  if (color.kind === 'oklch' && allowModernOklch) {
    return `oklch(${color.l} ${color.c} ${color.h} / ${color.a})`;
  }
  const [r, g, b, a] = resolveColorToSrgb(color, theme);
  if (a >= 0.999) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

/** Resolves a `LengthValue` into CSS string or pixel number. */
export function resolveLengthToCss(length: LengthValue): string | number {
  switch (length.unit) {
    case 'px':
      return `${length.value}px`;
    case 'pct':
      return `${length.value}%`;
    case 'vw':
      return `${length.value}vw`;
    case 'vh':
      return `${length.value}vh`;
    case 'rem':
      return `${length.value}rem`;
    case 'fr':
      return `${length.value}fr`;
    case 'auto':
      return 'auto';
    case 'fill':
      return '100%';
    case 'min-content':
      return 'min-content';
    case 'clamp':
      return `clamp(${resolveLengthToCss(length.min)}, ${resolveLengthToCss(length.preferred)}, ${resolveLengthToCss(length.max)})`;
  }
}

/** Resolves a `LengthValue` into concrete logical pixels for React Native / Rust Taffy / C++ Yoga. */
export function resolveLengthToPx(
  length: LengthValue | undefined,
  viewport: ViewportMetrics,
): number | `${number}%` | 'auto' | undefined {
  if (!length) return undefined;
  switch (length.unit) {
    case 'px':
      return length.value;
    case 'rem':
      return length.value * 16;
    case 'vw':
      return Number(((length.value / 100) * viewport.width).toFixed(2));
    case 'vh':
      return Number(((length.value / 100) * viewport.height).toFixed(2));
    case 'pct':
      return `${length.value}%`;
    case 'fill':
      return '100%';
    case 'fr':
    case 'auto':
    case 'min-content':
      return 'auto';
    case 'clamp': {
      const min =
        typeof resolveLengthToPx(length.min, viewport) === 'number'
          ? (resolveLengthToPx(length.min, viewport) as number)
          : 0;
      const pref =
        typeof resolveLengthToPx(length.preferred, viewport) === 'number'
          ? (resolveLengthToPx(length.preferred, viewport) as number)
          : min;
      const max =
        typeof resolveLengthToPx(length.max, viewport) === 'number'
          ? (resolveLengthToPx(length.max, viewport) as number)
          : pref;
      return Math.max(min, Math.min(max, pref));
    }
  }
}
