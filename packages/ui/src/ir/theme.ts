/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  DEFAULT_BREAKPOINTS,
  oklch,
  rgba,
  type BreakpointScale,
  type ColorValue,
  type SemanticColorToken,
} from './geometry.js';
import { UiTheme, type StyleRecipe, type ThemeMode, type ThemePalette } from './node.js';

export type ThemeAppearance = ThemeMode;

export interface ThemeChromaSpec {
  /** OKLCH hue angle in degrees (`0..360`). Ignored when `chroma === 0`. */
  readonly hue: number;
  /** OKLCH chroma (`0` = pure achromatic neutral without color cast). */
  readonly chroma: number;
}

export type ThemeAccentSpec =
  | { readonly mode: 'monochrome' }
  | { readonly mode: 'chromatic'; readonly hue: number; readonly chroma: number };

export interface ThemeBackdropSpec {
  /** Base RGB channels for modal backdrops; defaults to pure neutral black `[0, 0, 0]`. */
  readonly tint?: readonly [number, number, number];
  readonly blurAlphaDark?: number;
  readonly blurAlphaLight?: number;
  readonly dimAlphaDark?: number;
  readonly dimAlphaLight?: number;
  readonly fallbackAlphaDark?: number;
  readonly fallbackAlphaLight?: number;
}

export interface ThemeSemanticSpecs {
  readonly info?: ThemeChromaSpec;
  readonly success?: ThemeChromaSpec;
  readonly warning?: ThemeChromaSpec;
  readonly critical?: ThemeChromaSpec;
}

/**
 * Single mode-agnostic theme definition.
 * Both `'dark'` and `'light'` appearances are derived algorithmically from one definition
 * so themes never have to duplicate every color token twice.
 */
export interface ThemeDefinition {
  readonly id: string;
  readonly name: string;
  readonly neutral: ThemeChromaSpec;
  readonly accent: ThemeAccentSpec;
  readonly semantics?: ThemeSemanticSpecs;
  readonly backdrop?: ThemeBackdropSpec;
  readonly fontFamilies?: Partial<ThemePalette['fontFamilies']>;
  readonly radii?: Partial<ThemePalette['radii']>;
  readonly blur?: Partial<ThemePalette['blur']>;
  readonly breakpoints?: Partial<BreakpointScale>;
  /** Optional per-appearance escape hatch for theme-specific fine tuning. */
  readonly overrides?: {
    readonly dark?: Partial<Record<SemanticColorToken, ColorValue>>;
    readonly light?: Partial<Record<SemanticColorToken, ColorValue>>;
  };
}

export const DEFAULT_THEME_FONT_FAMILIES: ThemePalette['fontFamilies'] = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
  mono: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
  display: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
};

export const DEFAULT_THEME_RADII: ThemePalette['radii'] = {
  control: 14,
  field: 14,
  inset: 14,
  card: 26,
  panel: 34,
  pill: 999,
};

export const DEFAULT_THEME_BLUR: ThemePalette['blur'] = {
  sm: 10,
  md: 18,
  lg: 28,
  glass: 22,
};

const DEFAULT_SEMANTICS: Required<ThemeSemanticSpecs> = {
  info: { hue: 245, chroma: 0.17 },
  success: { hue: 152, chroma: 0.16 },
  warning: { hue: 68, chroma: 0.17 },
  critical: { hue: 26, chroma: 0.21 },
};

const DEFAULT_BACKDROP: Required<ThemeBackdropSpec> = {
  tint: [0, 0, 0],
  blurAlphaDark: 0.56,
  blurAlphaLight: 0.28,
  dimAlphaDark: 0.68,
  dimAlphaLight: 0.36,
  fallbackAlphaDark: 0.62,
  fallbackAlphaLight: 0.34,
};

export const HAUS_THEME_DEFINITION: ThemeDefinition = {
  id: 'haus',
  name: 'Haus',
  neutral: { hue: 0, chroma: 0 },
  accent: { mode: 'monochrome' },
  backdrop: { tint: [0, 0, 0] },
};

export const THEME_PRESET_DEFINITIONS = {
  haus: HAUS_THEME_DEFINITION,
  graphite: {
    id: 'graphite',
    name: 'Graphite',
    neutral: { hue: 260, chroma: 0.004 },
    accent: { mode: 'monochrome' },
    backdrop: { tint: [0, 0, 0] },
  } satisfies ThemeDefinition,
  warm: {
    id: 'warm',
    name: 'Warm Stone',
    neutral: { hue: 72, chroma: 0.008 },
    accent: { mode: 'chromatic', hue: 52, chroma: 0.14 },
    backdrop: { tint: [0, 0, 0] },
  } satisfies ThemeDefinition,
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    neutral: { hue: 235, chroma: 0.009 },
    accent: { mode: 'chromatic', hue: 242, chroma: 0.17 },
    backdrop: { tint: [0, 0, 0] },
  } satisfies ThemeDefinition,
} as const;

export type ThemePresetId = keyof typeof THEME_PRESET_DEFINITIONS;

function neutralColor(
  spec: ThemeChromaSpec,
  lightness: number,
  alpha = 1,
  chromaScale = 1,
): ColorValue {
  const c = spec.chroma <= 0 ? 0 : Number((spec.chroma * chromaScale).toFixed(4));
  if (c === 0) {
    if (lightness <= 0.001) return rgba(0, 0, 0, alpha);
    if (lightness >= 0.999) return rgba(255, 255, 255, alpha);
  }
  return oklch(lightness, c, spec.hue, alpha);
}

function semanticColor(spec: ThemeChromaSpec, appearance: ThemeAppearance): ColorValue {
  const dark = appearance === 'dark';
  const lightness = dark ? 0.68 : 0.52;
  const chroma = dark ? spec.chroma : spec.chroma * 0.96;
  return oklch(lightness, chroma, spec.hue, 1);
}

function derivePalette(definition: ThemeDefinition, appearance: ThemeAppearance): ThemePalette {
  const dark = appearance === 'dark';
  const n = definition.neutral;
  const sem = {
    info: definition.semantics?.info ?? DEFAULT_SEMANTICS.info,
    success: definition.semantics?.success ?? DEFAULT_SEMANTICS.success,
    warning: definition.semantics?.warning ?? DEFAULT_SEMANTICS.warning,
    critical: definition.semantics?.critical ?? DEFAULT_SEMANTICS.critical,
  };
  const bd: Required<ThemeBackdropSpec> = {
    tint: definition.backdrop?.tint ?? DEFAULT_BACKDROP.tint,
    blurAlphaDark: definition.backdrop?.blurAlphaDark ?? DEFAULT_BACKDROP.blurAlphaDark,
    blurAlphaLight: definition.backdrop?.blurAlphaLight ?? DEFAULT_BACKDROP.blurAlphaLight,
    dimAlphaDark: definition.backdrop?.dimAlphaDark ?? DEFAULT_BACKDROP.dimAlphaDark,
    dimAlphaLight: definition.backdrop?.dimAlphaLight ?? DEFAULT_BACKDROP.dimAlphaLight,
    fallbackAlphaDark: definition.backdrop?.fallbackAlphaDark ?? DEFAULT_BACKDROP.fallbackAlphaDark,
    fallbackAlphaLight:
      definition.backdrop?.fallbackAlphaLight ?? DEFAULT_BACKDROP.fallbackAlphaLight,
  };

  const accent =
    definition.accent.mode === 'monochrome'
      ? dark
        ? neutralColor(n, 0.92, 1, 0.35)
        : neutralColor(n, 0.22, 1, 0.5)
      : oklch(dark ? 0.72 : 0.54, definition.accent.chroma, definition.accent.hue, 1);
  const accentForeground =
    definition.accent.mode === 'monochrome'
      ? dark
        ? neutralColor(n, 0.14, 1, 0.2)
        : rgba(255, 255, 255, 1)
      : dark
        ? rgba(10, 10, 10, 1)
        : rgba(255, 255, 255, 1);
  const accentHover =
    definition.accent.mode === 'monochrome'
      ? dark
        ? rgba(255, 255, 255, 1)
        : neutralColor(n, 0.31, 1, 0.5)
      : oklch(dark ? 0.78 : 0.48, definition.accent.chroma, definition.accent.hue, 1);

  const inkTone = dark ? neutralColor(n, 0.968, 1, 0.2) : neutralColor(n, 0.22, 1, 0.4);
  const ctrlBase = dark ? rgba(255, 255, 255, 1) : neutralColor(n, 0.14, 1, 0.35);
  const withAlpha = (base: ColorValue, alpha: number): ColorValue =>
    base.kind === 'rgba'
      ? rgba(base.r, base.g, base.b, alpha)
      : base.kind === 'oklch'
        ? oklch(base.l, base.c, base.h, alpha)
        : base;

  const baseColors: Record<SemanticColorToken, ColorValue> = {
    canvas: dark ? neutralColor(n, 0, 1, 0) : neutralColor(n, 0.973, 1, 0.6),
    background: dark ? neutralColor(n, 0, 1, 0) : neutralColor(n, 0.98, 1, 0.5),
    surface: dark ? neutralColor(n, 0.19, 1, 0.8) : neutralColor(n, 1, 1, 0),
    surfaceSecondary: dark ? neutralColor(n, 0.22, 1, 0.85) : neutralColor(n, 0.962, 1, 0.7),
    surfaceElevated: dark ? neutralColor(n, 0.24, 0.92, 0.85) : neutralColor(n, 1, 0.92, 0),
    surfaceHover: dark ? neutralColor(n, 0.27, 1, 0.9) : neutralColor(n, 0.95, 1, 0.75),
    surfaceActive: dark ? neutralColor(n, 0.31, 1, 0.9) : neutralColor(n, 0.92, 1, 0.8),
    card: dark ? neutralColor(n, 0.19, 1, 0.8) : neutralColor(n, 1, 1, 0),
    soft: dark ? neutralColor(n, 0.24, 1, 0.85) : neutralColor(n, 0.95, 1, 0.75),
    border: dark ? neutralColor(n, 0.27, 1, 0.9) : neutralColor(n, 0.918, 1, 0.8),
    borderSubtle: dark ? rgba(255, 255, 255, 0.08) : rgba(0, 0, 0, 0.075),
    ink: inkTone,
    textPrimary: inkTone,
    textSecondary: dark ? neutralColor(n, 0.835, 1, 0.35) : neutralColor(n, 0.43, 1, 0.45),
    textMuted: dark ? neutralColor(n, 0.69, 1, 0.4) : neutralColor(n, 0.57, 1, 0.45),
    accent,
    accentForeground,
    accentHover,
    info: semanticColor(sem.info, appearance),
    infoForeground: rgba(255, 255, 255, 1),
    success: dark ? rgba(16, 185, 129, 1) : rgba(30, 142, 62, 1),
    successForeground: dark ? rgba(10, 10, 10, 1) : rgba(255, 255, 255, 1),
    warning: dark ? rgba(245, 158, 11, 1) : rgba(176, 96, 0, 1),
    warningForeground: dark ? rgba(10, 10, 10, 1) : rgba(255, 255, 255, 1),
    critical: dark ? rgba(239, 68, 68, 1) : rgba(217, 56, 30, 1),
    criticalForeground: rgba(255, 255, 255, 1),
    offline: dark ? neutralColor(n, 0.54, 1, 0.25) : neutralColor(n, 0.69, 1, 0.25),
    backdrop: rgba(bd.tint[0], bd.tint[1], bd.tint[2], dark ? bd.blurAlphaDark : bd.blurAlphaLight),
    backdropDim: rgba(
      bd.tint[0],
      bd.tint[1],
      bd.tint[2],
      dark ? bd.dimAlphaDark : bd.dimAlphaLight,
    ),
    backdropFallback: rgba(
      bd.tint[0],
      bd.tint[1],
      bd.tint[2],
      dark ? bd.fallbackAlphaDark : bd.fallbackAlphaLight,
    ),
    controlFill: withAlpha(ctrlBase, dark ? 0.08 : 0.06),
    controlFillHover: withAlpha(ctrlBase, dark ? 0.14 : 0.11),
    controlFillActive: withAlpha(ctrlBase, dark ? 0.15 : 0.09),
    controlBorderActive: withAlpha(ctrlBase, dark ? 0.26 : 0.2),
    shadow: rgba(0, 0, 0, dark ? 0.6 : 0.22),
    materialTop: dark ? neutralColor(n, 0.355, 0.78, 0.6) : neutralColor(n, 1, 0.88, 0),
    materialBottom: dark ? neutralColor(n, 0.215, 0.8, 0.7) : neutralColor(n, 0.96, 0.78, 0.5),
    materialEdge: dark ? rgba(255, 255, 255, 0.08) : rgba(0, 0, 0, 0.075),
    materialRim: dark ? rgba(255, 255, 255, 0.14) : rgba(255, 255, 255, 0.58),
    materialShadow: rgba(0, 0, 0, dark ? 0.3 : 0.12),
  };

  if (definition.semantics?.success) baseColors.success = semanticColor(sem.success, appearance);
  if (definition.semantics?.warning) baseColors.warning = semanticColor(sem.warning, appearance);
  if (definition.semantics?.critical) baseColors.critical = semanticColor(sem.critical, appearance);

  const overrides = dark ? definition.overrides?.dark : definition.overrides?.light;
  if (overrides) {
    for (const [token, val] of Object.entries(overrides)) {
      if (val) baseColors[token as SemanticColorToken] = val;
    }
  }

  return {
    mode: appearance,
    colors: baseColors,
    fontFamilies: { ...DEFAULT_THEME_FONT_FAMILIES, ...definition.fontFamilies },
    radii: { ...DEFAULT_THEME_RADII, ...definition.radii },
    blur: { ...DEFAULT_THEME_BLUR, ...definition.blur },
    breakpoints: { ...DEFAULT_BREAKPOINTS, ...definition.breakpoints },
  };
}

/**
 * Unified Haus Theme class.
 * A single `Theme` instance represents a visual theme and derives both `'light'` and `'dark'`
 * appearances automatically without duplicating color palettes per mode.
 */
export class Theme {
  readonly id: string;
  readonly name: string;
  readonly definition: ThemeDefinition;
  private readonly paletteCache = new Map<ThemeAppearance, ThemePalette>();
  private readonly resolvedCache = new Map<ThemeAppearance, UiTheme>();

  constructor(definition: ThemeDefinition = HAUS_THEME_DEFINITION) {
    this.id = definition.id;
    this.name = definition.name;
    this.definition = definition;
  }

  /** Canonical pure-neutral Haus theme. */
  static readonly haus = new Theme(HAUS_THEME_DEFINITION);
  static readonly default = Theme.haus;

  static create(definition: ThemeDefinition): Theme {
    return new Theme(definition);
  }

  static preset(id: ThemePresetId): Theme {
    if (id === 'haus') return Theme.haus;
    return new Theme(THEME_PRESET_DEFINITIONS[id]);
  }

  /** Derives and caches the complete `ThemePalette` for `'light'` or `'dark'`. */
  palette(appearance: ThemeAppearance): ThemePalette {
    const cached = this.paletteCache.get(appearance);
    if (cached) return cached;
    const derived = derivePalette(this.definition, appearance);
    this.paletteCache.set(appearance, derived);
    return derived;
  }

  /** Resolves a `UiTheme` for the requested appearance (`'light' | 'dark'`). */
  forAppearance(appearance: ThemeAppearance, recipes?: readonly StyleRecipe[]): UiTheme {
    if (!recipes || recipes.length === 0) {
      const cached = this.resolvedCache.get(appearance);
      if (cached) return cached;
      const next = new UiTheme(this.palette(appearance));
      this.resolvedCache.set(appearance, next);
      return next;
    }
    return new UiTheme(this.palette(appearance), recipes);
  }

  resolve(appearance: ThemeAppearance, recipes?: readonly StyleRecipe[]): UiTheme {
    return this.forAppearance(appearance, recipes);
  }

  color(token: SemanticColorToken, appearance: ThemeAppearance): ColorValue {
    return this.palette(appearance).colors[token];
  }

  /** Creates a derived theme inheriting this definition while keeping automatic light/dark derivation. */
  extend(
    patch: Partial<ThemeDefinition> & { readonly id?: string; readonly name?: string },
  ): Theme {
    return new Theme({
      ...this.definition,
      ...patch,
      neutral: patch.neutral ?? this.definition.neutral,
      accent: patch.accent ?? this.definition.accent,
      semantics: { ...this.definition.semantics, ...patch.semantics },
      backdrop: { ...this.definition.backdrop, ...patch.backdrop },
      fontFamilies: { ...this.definition.fontFamilies, ...patch.fontFamilies },
      radii: { ...this.definition.radii, ...patch.radii },
      blur: { ...this.definition.blur, ...patch.blur },
      breakpoints: { ...this.definition.breakpoints, ...patch.breakpoints },
      overrides: {
        dark: { ...this.definition.overrides?.dark, ...patch.overrides?.dark },
        light: { ...this.definition.overrides?.light, ...patch.overrides?.light },
      },
    });
  }
}

export { Theme as HausTheme };
