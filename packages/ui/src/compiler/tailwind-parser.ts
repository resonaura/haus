/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  autoLength,
  colorToken,
  corners,
  fillLength,
  insets,
  mergeStyleSpecs,
  pct,
  px,
  rgba,
  vh,
  vw,
  type ColorValue,
  type EdgeInsets,
  type LayoutStyle,
  type LengthValue,
  type TypographyStyle,
  type UiStyleSpec,
} from '../ir/index.js';
import { BackdropMaterial, BlurMaterial, SolidMaterial } from '../ir/materials.js';

const TAILWIND_SPACING_PX: Readonly<Record<string, number>> = {
  '0': 0,
  '0.5': 2,
  '1': 4,
  '1.5': 6,
  '2': 8,
  '2.5': 10,
  '3': 12,
  '3.5': 14,
  '4': 16,
  '5': 20,
  '6': 24,
  '7': 28,
  '8': 32,
  '9': 36,
  '10': 40,
  '11': 44,
  '12': 48,
  '14': 56,
  '16': 64,
  '20': 80,
  '24': 96,
};

const TAILWIND_RADIUS_PX: Readonly<Record<string, number>> = {
  none: 0,
  xs: 4,
  sm: 6,
  DEFAULT: 8,
  md: 10,
  lg: 14,
  xl: 18,
  '2xl': 22,
  '3xl': 26,
  '4xl': 34,
  full: 9999,
};

const TAILWIND_TEXT_SIZE: Readonly<Record<string, { size: number; lineHeight: number }>> = {
  xs: { size: 11, lineHeight: 1.35 },
  sm: { size: 13, lineHeight: 1.45 },
  base: { size: 14, lineHeight: 1.5 },
  lg: { size: 16, lineHeight: 1.45 },
  xl: { size: 20, lineHeight: 1.3 },
  '2xl': { size: 24, lineHeight: 1.25 },
  '3xl': { size: 28, lineHeight: 1.2 },
};

const TAILWIND_BLUR_PX: Readonly<Record<string, number>> = {
  none: 0,
  xs: 4,
  sm: 8,
  DEFAULT: 12,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 40,
  '3xl': 64,
};

const SEMANTIC_BG_MAP: Readonly<Record<string, ColorValue>> = {
  transparent: { kind: 'transparent' },
  surface: colorToken('surface'),
  card: colorToken('card'),
  canvas: colorToken('canvas'),
  soft: colorToken('soft'),
  accent: colorToken('accent'),
  primary: colorToken('accent'),
  danger: colorToken('critical'),
  critical: colorToken('critical'),
  success: colorToken('success'),
  warning: colorToken('warning'),
  white: rgba(255, 255, 255, 1),
  black: rgba(0, 0, 0, 1),
};

const SEMANTIC_TEXT_MAP: Readonly<Record<string, ColorValue>> = {
  foreground: colorToken('textPrimary'),
  ink: colorToken('ink'),
  primary: colorToken('textPrimary'),
  secondary: colorToken('textSecondary'),
  muted: colorToken('textMuted'),
  accent: colorToken('accent'),
  danger: colorToken('critical'),
  success: colorToken('success'),
  warning: colorToken('warning'),
  current: { kind: 'current' },
};

function parseSpacingPx(token: string): number | undefined {
  if (token in TAILWIND_SPACING_PX) return TAILWIND_SPACING_PX[token];
  const bracket = /^\[(\d+(?:\.\d+)?)px\]$/.exec(token);
  if (bracket) return Number(bracket[1]);
  return undefined;
}

function parseLengthToken(token: string): LengthValue | undefined {
  if (token === 'full') return pct(100);
  if (token === 'screen') return vw(100);
  if (token === 'fit' || token === 'auto') return autoLength;
  if (token === 'fill') return fillLength;
  const pxVal = parseSpacingPx(token);
  if (pxVal !== undefined) return px(pxVal);
  const pctBracket = /^\[(\d+(?:\.\d+)?)%\]$/.exec(token);
  if (pctBracket) return pct(Number(pctBracket[1]));
  const vwBracket = /^\[(\d+(?:\.\d+)?)vw\]$/.exec(token);
  if (vwBracket) return vw(Number(vwBracket[1]));
  const vhBracket = /^\[(\d+(?:\.\d+)?)vh\]$/.exec(token);
  if (vhBracket) return vh(Number(vhBracket[1]));
  return undefined;
}

function mergePadding(current: EdgeInsets | undefined, next: EdgeInsets): EdgeInsets {
  return { ...current, ...next };
}

/**
 * Pure TypeScript OOP compiler converting Tailwind CSS v4 utility classes and
 * HeroUI `@apply` directives into renderer-agnostic `@haus/ui` `UiStyleSpec` objects.
 */
export class TailwindAstCompiler {
  compileClassList(classList: string | readonly string[]): UiStyleSpec {
    const tokens = (typeof classList === 'string' ? classList.split(/\s+/) : classList)
      .map((item) => item.trim())
      .filter(Boolean);
    let result: UiStyleSpec = {};
    for (const raw of tokens) {
      result = mergeStyleSpecs(result, this.compileToken(raw));
    }
    return result;
  }

  compileToken(rawToken: string): UiStyleSpec {
    const bpMatch = /^(sm|md|lg|xl|2xl):(.+)$/.exec(rawToken);
    if (bpMatch) {
      const bp = bpMatch[1] as 'sm' | 'md' | 'lg' | 'xl' | '2xl';
      const inner = this.compileToken(bpMatch[2]!);
      const { responsive: _nested, ...cleanInner } = inner;
      return { responsive: { [bp]: cleanInner } };
    }

    const stateMatch = /^(hover|active|focus|disabled|selected):(.+)$/.exec(rawToken);
    if (stateMatch) {
      const rawState = stateMatch[1]!;
      const stateKey = rawState === 'active' ? 'pressed' : (rawState as 'hover' | 'focus' | 'disabled' | 'selected');
      const inner = this.compileToken(stateMatch[2]!);
      return {
        states: {
          [stateKey]: {
            ...(inner.material ? { material: inner.material } : {}),
            ...(inner.border ? { border: inner.border } : {}),
            ...(inner.opacity !== undefined ? { opacity: inner.opacity } : {}),
            ...(inner.transform ? { transform: inner.transform } : {}),
            ...(inner.typography?.color ? { textColor: inner.typography.color } : {}),
          },
        },
      };
    }

    let layout: LayoutStyle | undefined;
    let typography: TypographyStyle | undefined;

    if (rawToken === 'flex') layout = { display: 'flex' };
    else if (rawToken === 'inline-flex') layout = { display: 'inline-flex' };
    else if (rawToken === 'grid') layout = { display: 'grid' };
    else if (rawToken === 'block' || rawToken === 'inline-block') layout = { display: 'block' };
    else if (rawToken === 'hidden') layout = { display: 'none' };
    else if (rawToken === 'flex-row') layout = { direction: 'row' };
    else if (rawToken === 'flex-col') layout = { direction: 'column' };
    else if (rawToken === 'flex-wrap') layout = { wrap: 'wrap' };
    else if (rawToken === 'flex-nowrap') layout = { wrap: 'nowrap' };
    else if (rawToken === 'items-center') layout = { alignItems: 'center' };
    else if (rawToken === 'items-start') layout = { alignItems: 'start' };
    else if (rawToken === 'items-end') layout = { alignItems: 'end' };
    else if (rawToken === 'items-stretch') layout = { alignItems: 'stretch' };
    else if (rawToken === 'justify-center') layout = { justifyContent: 'center' };
    else if (rawToken === 'justify-between') layout = { justifyContent: 'between' };
    else if (rawToken === 'justify-start') layout = { justifyContent: 'start' };
    else if (rawToken === 'justify-end') layout = { justifyContent: 'end' };
    else if (rawToken === 'relative') layout = { position: 'relative' };
    else if (rawToken === 'absolute') layout = { position: 'absolute' };
    else if (rawToken === 'fixed') layout = { position: 'fixed' };
    else if (rawToken === 'inset-0') layout = { inset: insets(0) };
    else if (rawToken === 'shrink-0') layout = { flexShrink: 0 };
    else if (rawToken === 'grow' || rawToken === 'flex-1') layout = { flexGrow: 1 };
    else if (rawToken === 'overflow-hidden') layout = { overflow: 'hidden' };
    else if (rawToken === 'overflow-auto') layout = { overflow: 'auto' };
    else if (rawToken === 'select-none') return { selectNone: true };
    else if (rawToken === 'pointer-events-none') return { pointerEvents: 'none' };
    else if (rawToken === 'cursor-pointer') return { cursor: 'pointer' };
    else if (rawToken === 'cursor-not-allowed') return { cursor: 'not-allowed' };
    else if (rawToken === 'whitespace-nowrap') typography = { whiteSpace: 'nowrap' };
    else if (rawToken === 'truncate') typography = { truncate: true, whiteSpace: 'nowrap' };
    else if (rawToken === 'uppercase') typography = { uppercase: true };
    else if (rawToken === 'tabular-nums') typography = { tabularNums: true };
    else if (rawToken === 'font-normal') typography = { weight: 400 };
    else if (rawToken === 'font-medium') typography = { weight: 500 };
    else if (rawToken === 'font-semibold') typography = { weight: 600 };
    else if (rawToken === 'font-bold') typography = { weight: 700 };
    else if (rawToken === 'font-mono') typography = { fontFamily: 'mono' };
    else if (rawToken === 'text-left') typography = { align: 'left' };
    else if (rawToken === 'text-center') typography = { align: 'center' };
    else if (rawToken === 'text-right') typography = { align: 'right' };

    if (layout || typography) {
      return {
        ...(layout ? { layout } : {}),
        ...(typography ? { typography } : {}),
      };
    }

    const gapMatch = /^gap-(.+)$/.exec(rawToken);
    if (gapMatch) {
      const gapPx = parseSpacingPx(gapMatch[1]!);
      if (gapPx !== undefined) return { layout: { gap: px(gapPx) } };
    }

    const padMatch = /^(p|px|py|pt|pr|pb|pl)-(.+)$/.exec(rawToken);
    if (padMatch) {
      const dir = padMatch[1]!;
      const val = parseSpacingPx(padMatch[2]!);
      if (val !== undefined) {
        const len = px(val);
        const edge: EdgeInsets =
          dir === 'p'
            ? insets(val)
            : dir === 'px'
              ? { left: len, right: len }
              : dir === 'py'
                ? { top: len, bottom: len }
                : dir === 'pt'
                  ? { top: len }
                  : dir === 'pr'
                    ? { right: len }
                    : dir === 'pb'
                      ? { bottom: len }
                      : { left: len };
        return { layout: { padding: mergePadding(undefined, edge) } };
      }
    }

    const sizeMatch = /^(w|h|min-w|max-w|min-h|max-h|size)-(.+)$/.exec(rawToken);
    if (sizeMatch) {
      const prop = sizeMatch[1]!;
      const len = parseLengthToken(sizeMatch[2]!);
      if (len) {
        if (prop === 'size') return { layout: { width: len, height: len } };
        if (prop === 'w') return { layout: { width: len } };
        if (prop === 'h') return { layout: { height: len } };
        if (prop === 'min-w') return { layout: { minWidth: len } };
        if (prop === 'max-w') return { layout: { maxWidth: len } };
        if (prop === 'min-h') return { layout: { minHeight: len } };
        if (prop === 'max-h') return { layout: { maxHeight: len } };
      }
    }

    const gridColsMatch = /^grid-cols-(\d+)$/.exec(rawToken);
    if (gridColsMatch) {
      return { layout: { display: 'grid', gridColumns: Number(gridColsMatch[1]) } };
    }

    if (rawToken === 'rounded' || rawToken.startsWith('rounded-')) {
      const key = rawToken === 'rounded' ? 'DEFAULT' : rawToken.slice('rounded-'.length);
      const rad = TAILWIND_RADIUS_PX[key];
      if (rad !== undefined) {
        return { corners: corners(rad, rad >= 999 ? 'round' : 'superellipse', 1.4) };
      }
    }

    const textMatch = /^text-(.+)$/.exec(rawToken);
    if (textMatch) {
      const key = textMatch[1]!;
      const sizeSpec = TAILWIND_TEXT_SIZE[key];
      if (sizeSpec) {
        return { typography: { size: sizeSpec.size, lineHeight: sizeSpec.lineHeight } };
      }
      const color = SEMANTIC_TEXT_MAP[key];
      if (color) return { typography: { color } };
    }

    const bgMatch = /^bg-([a-z]+)(?:\/(\d+))?$/.exec(rawToken);
    if (bgMatch) {
      const baseColor = SEMANTIC_BG_MAP[bgMatch[1]!];
      if (baseColor) {
        const opacity = bgMatch[2] ? Number(bgMatch[2]) / 100 : undefined;
        const resolvedColor =
          opacity !== undefined && baseColor.kind === 'token'
            ? colorToken(baseColor.name, opacity)
            : opacity !== undefined && baseColor.kind === 'rgba'
              ? rgba(baseColor.r, baseColor.g, baseColor.b, opacity)
              : baseColor;
        return { material: new SolidMaterial(resolvedColor) };
      }
    }

    if (rawToken === 'backdrop-blur' || rawToken.startsWith('backdrop-blur-')) {
      const key =
        rawToken === 'backdrop-blur' ? 'DEFAULT' : rawToken.slice('backdrop-blur-'.length);
      const radius = TAILWIND_BLUR_PX[key] ?? 16;
      return {
        material: new BackdropMaterial({
          blurRadius: radius,
          saturation: 1.3,
          vibrancy: 'regular',
          tintColor: colorToken('materialTop'),
          tintOpacity: 0.72,
        }),
      };
    }

    if (rawToken === 'blur' || rawToken.startsWith('blur-')) {
      const key = rawToken === 'blur' ? 'DEFAULT' : rawToken.slice('blur-'.length);
      const radius = TAILWIND_BLUR_PX[key] ?? 12;
      return { material: new BlurMaterial({ radius, quality: 'medium' }) };
    }

    const opacityMatch = /^opacity-(\d+)$/.exec(rawToken);
    if (opacityMatch) {
      return { opacity: Math.max(0, Math.min(1, Number(opacityMatch[1]) / 100)) };
    }

    const scaleMatch = /^scale-(\d+)$/.exec(rawToken);
    if (scaleMatch) {
      return { transform: { scale: Number(scaleMatch[1]) / 100 } };
    }

    if (rawToken === 'border') {
      return { border: { width: 1, style: 'solid', color: colorToken('border') } };
    }

    return {};
  }
}
