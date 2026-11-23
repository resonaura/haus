/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Renderer-agnostic dimensional unit suitable for Web CSS, React Native, Taffy (Rust), and Yoga (C++). */
export type LengthValue =
  | { readonly unit: 'px'; readonly value: number }
  | { readonly unit: 'pct'; readonly value: number }
  | { readonly unit: 'vw'; readonly value: number }
  | { readonly unit: 'vh'; readonly value: number }
  | { readonly unit: 'rem'; readonly value: number }
  | { readonly unit: 'fr'; readonly value: number }
  | { readonly unit: 'auto' }
  | { readonly unit: 'fill' }
  | { readonly unit: 'min-content' }
  | {
      readonly unit: 'clamp';
      readonly min: LengthValue;
      readonly preferred: LengthValue;
      readonly max: LengthValue;
    };

export const px = (value: number): LengthValue => ({ unit: 'px', value });
export const pct = (value: number): LengthValue => ({ unit: 'pct', value });
export const vw = (value: number): LengthValue => ({ unit: 'vw', value });
export const vh = (value: number): LengthValue => ({ unit: 'vh', value });
export const rem = (value: number): LengthValue => ({ unit: 'rem', value });
export const fr = (value: number): LengthValue => ({ unit: 'fr', value });
export const autoLength: LengthValue = { unit: 'auto' };
export const fillLength: LengthValue = { unit: 'fill' };
export const clampLength = (
  min: LengthValue,
  preferred: LengthValue,
  max: LengthValue,
): LengthValue => ({ unit: 'clamp', min, preferred, max });

/** Structured renderer-agnostic color value (no CSS parsing required by native/Rust backends). */
export type ColorValue =
  | { readonly kind: 'rgba'; readonly r: number; readonly g: number; readonly b: number; readonly a: number }
  | { readonly kind: 'oklch'; readonly l: number; readonly c: number; readonly h: number; readonly a: number }
  | { readonly kind: 'token'; readonly name: SemanticColorToken; readonly alpha?: number }
  | { readonly kind: 'mix'; readonly base: ColorValue; readonly target: ColorValue; readonly ratio: number }
  | { readonly kind: 'transparent' }
  | { readonly kind: 'current' };

export type SemanticColorToken =
  | 'canvas'
  | 'background'
  | 'surface'
  | 'surfaceSecondary'
  | 'surfaceElevated'
  | 'surfaceHover'
  | 'surfaceActive'
  | 'card'
  | 'soft'
  | 'border'
  | 'borderSubtle'
  | 'ink'
  | 'textPrimary'
  | 'textSecondary'
  | 'textMuted'
  | 'accent'
  | 'accentForeground'
  | 'accentHover'
  | 'success'
  | 'successForeground'
  | 'warning'
  | 'warningForeground'
  | 'critical'
  | 'criticalForeground'
  | 'offline'
  | 'materialTop'
  | 'materialBottom'
  | 'materialEdge'
  | 'materialRim'
  | 'materialShadow';

export const rgba = (r: number, g: number, b: number, a = 1): ColorValue => ({
  kind: 'rgba',
  r: Math.max(0, Math.min(255, Math.round(r))),
  g: Math.max(0, Math.min(255, Math.round(g))),
  b: Math.max(0, Math.min(255, Math.round(b))),
  a: Math.max(0, Math.min(1, a)),
});

export const oklch = (l: number, c: number, h: number, a = 1): ColorValue => ({
  kind: 'oklch',
  l: Math.max(0, Math.min(1, l)),
  c: Math.max(0, c),
  h: ((h % 360) + 360) % 360,
  a: Math.max(0, Math.min(1, a)),
});

export const colorToken = (name: SemanticColorToken, alpha?: number): ColorValue => ({
  kind: 'token',
  name,
  ...(alpha !== undefined ? { alpha: Math.max(0, Math.min(1, alpha)) } : {}),
});

export const mixColor = (base: ColorValue, target: ColorValue, ratio: number): ColorValue => ({
  kind: 'mix',
  base,
  target,
  ratio: Math.max(0, Math.min(1, ratio)),
});

export const transparentColor: ColorValue = { kind: 'transparent' };
export const currentColor: ColorValue = { kind: 'current' };

export type CornerShapeKind = 'round' | 'superellipse' | 'bevel';

export interface CornerRadius {
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomRight: number;
  readonly bottomLeft: number;
  readonly shape: CornerShapeKind;
  /** Superellipse exponent (1.4 matches Apple HIG continuous corners; 1.5 matches Haus icons). */
  readonly exponent?: number;
}

export function corners(
  radius: number,
  shape: CornerShapeKind = 'superellipse',
  exponent = 1.4,
): CornerRadius {
  return {
    topLeft: radius,
    topRight: radius,
    bottomRight: radius,
    bottomLeft: radius,
    shape,
    ...(shape === 'superellipse' ? { exponent } : {}),
  };
}

export interface EdgeInsets {
  readonly top?: LengthValue;
  readonly right?: LengthValue;
  readonly bottom?: LengthValue;
  readonly left?: LengthValue;
}

export function insets(all: number): EdgeInsets;
export function insets(vertical: number, horizontal: number): EdgeInsets;
export function insets(top: number, right: number, bottom: number, left: number): EdgeInsets;
export function insets(a: number, b?: number, c?: number, d?: number): EdgeInsets {
  if (b === undefined) return { top: px(a), right: px(a), bottom: px(a), left: px(a) };
  if (c === undefined) return { top: px(a), right: px(b), bottom: px(a), left: px(b) };
  return { top: px(a), right: px(b), bottom: px(c), left: px(d ?? b) };
}

export interface BorderSpec {
  readonly width: number;
  readonly style?: 'solid' | 'dashed' | 'dotted' | 'none';
  readonly color: ColorValue;
}

export interface ShadowSpec {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blurRadius: number;
  readonly spreadRadius?: number;
  readonly color: ColorValue;
  readonly inset?: boolean;
}

export interface TransformSpec {
  readonly translateX?: number;
  readonly translateY?: number;
  readonly scale?: number;
  readonly rotateDeg?: number;
}

export type BreakpointName = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface BreakpointScale {
  readonly xs: number;
  readonly sm: number;
  readonly md: number;
  readonly lg: number;
  readonly xl: number;
  readonly '2xl': number;
}

export const DEFAULT_BREAKPOINTS: BreakpointScale = {
  xs: 0,
  sm: 560,
  md: 768,
  lg: 1024,
  xl: 1360,
  '2xl': 1680,
};

export interface ViewportMetrics {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly reducedMotion: boolean;
  readonly reducedTransparency: boolean;
  readonly highContrast: boolean;
}

export const DEFAULT_VIEWPORT: ViewportMetrics = {
  width: 1280,
  height: 840,
  dpr: 2,
  reducedMotion: false,
  reducedTransparency: false,
  highContrast: false,
};

export interface ResponsiveValue<T> {
  readonly base: T;
  readonly sm?: T;
  readonly md?: T;
  readonly lg?: T;
  readonly xl?: T;
  readonly '2xl'?: T;
}

const ORDERED_BREAKPOINTS: readonly BreakpointName[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];

/** Pure OOP breakpoint & responsive value evaluator shared by Web, RN, and Rust/C++ layouts. */
export class BreakpointResolver {
  constructor(private readonly scale: BreakpointScale = DEFAULT_BREAKPOINTS) {}

  activeFor(width: number): BreakpointName {
    let active: BreakpointName = 'xs';
    for (const bp of ORDERED_BREAKPOINTS) {
      if (width >= this.scale[bp]) active = bp;
    }
    return active;
  }

  matches(width: number, minBreakpoint: BreakpointName): boolean {
    return width >= this.scale[minBreakpoint];
  }

  resolve<T>(value: T | ResponsiveValue<T>, width: number): T {
    if (!isResponsiveValue<T>(value)) return value;
    let resolved = value.base;
    for (const bp of ORDERED_BREAKPOINTS) {
      if (bp === 'xs') continue;
      if (width >= this.scale[bp] && value[bp] !== undefined) {
        resolved = value[bp] as T;
      }
    }
    return resolved;
  }
}

export function isResponsiveValue<T>(value: unknown): value is ResponsiveValue<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'base' in value &&
    !('unit' in value) &&
    !('kind' in value)
  );
}

export interface LayoutStyle {
  readonly display?: 'flex' | 'inline-flex' | 'grid' | 'block' | 'none';
  readonly direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  readonly wrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  readonly alignItems?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  readonly alignSelf?: 'auto' | 'start' | 'center' | 'end' | 'stretch';
  readonly justifyContent?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
  readonly justifyItems?: 'start' | 'center' | 'end' | 'stretch';
  readonly gap?: LengthValue;
  readonly rowGap?: LengthValue;
  readonly columnGap?: LengthValue;
  readonly gridColumns?: number | readonly LengthValue[];
  readonly gridMinColumnWidth?: LengthValue;
  readonly padding?: EdgeInsets;
  readonly margin?: EdgeInsets;
  readonly width?: LengthValue;
  readonly minWidth?: LengthValue;
  readonly maxWidth?: LengthValue;
  readonly height?: LengthValue;
  readonly minHeight?: LengthValue;
  readonly maxHeight?: LengthValue;
  readonly flexGrow?: number;
  readonly flexShrink?: number;
  readonly position?: 'relative' | 'absolute' | 'fixed' | 'sticky';
  readonly inset?: EdgeInsets;
  readonly overflow?: 'visible' | 'hidden' | 'scroll' | 'auto';
  readonly overflowX?: 'visible' | 'hidden' | 'scroll' | 'auto';
  readonly overflowY?: 'visible' | 'hidden' | 'scroll' | 'auto';
  readonly zIndex?: number;
  readonly aspectRatio?: number;
}

export interface TypographyStyle {
  readonly fontFamily?: 'sans' | 'mono' | 'display';
  readonly size?: number;
  readonly weight?: 400 | 500 | 600 | 700;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly align?: 'left' | 'center' | 'right';
  readonly color?: ColorValue;
  readonly uppercase?: boolean;
  readonly tabularNums?: boolean;
  readonly truncate?: boolean;
  readonly maxLines?: number;
  readonly whiteSpace?: 'normal' | 'nowrap' | 'pre-wrap';
}
