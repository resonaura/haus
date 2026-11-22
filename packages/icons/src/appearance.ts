/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type IconAppearance = 'default' | 'dark' | 'clear' | 'tinted';
export type IconVariation = 'auto' | 'light' | 'dark';
export type ResolvedIconVariation = 'light' | 'dark';
export type IconTintColor =
  'automatic' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'graphite';

export interface IconAppearanceOption {
  readonly title: string;
  readonly value: IconAppearance;
}

export interface IconVariationOption {
  readonly title: string;
  readonly value: IconVariation;
}

export interface IconTintColorOption {
  readonly title: string;
  readonly value: IconTintColor;
  readonly hex?: string;
}

export interface IconStyleSettings {
  readonly appearance: IconAppearance;
  readonly variation: IconVariation;
  readonly tintColor: IconTintColor;
}

export interface ResolvedIconStyle {
  readonly appearance: IconAppearance;
  readonly variation: ResolvedIconVariation;
  readonly tintColor: IconTintColor;
  readonly tintHex: string;
}

/** Content-addressed cache format (matches GNOME ICON_CACHE_FORMAT = 3). */
export const ICON_CACHE_FORMAT = 3;

/**
 * Bump this revision whenever the rendering algorithm, lighting, backgrounds,
 * or geometry changes. Hubs automatically spin up a fresh `v<format>-<revision>`
 * cache namespace, keep one prior generation for rollback, and re-render all
 * cached raw sources in the background.
 */
export const ICON_ENGINE_REVISION = 'gnome-v2';

export const ICON_CACHE_VERSION = `v${ICON_CACHE_FORMAT}-${ICON_ENGINE_REVISION}`;

/** The four app-icon presentations (1:1 with GNOME / macOS System Settings). */
export const ICON_APPEARANCES: readonly IconAppearanceOption[] = Object.freeze([
  { title: 'Default', value: 'default' },
  { title: 'Dark', value: 'dark' },
  { title: 'Clear', value: 'clear' },
  { title: 'Tinted', value: 'tinted' },
]);

/** Clear / Tinted illumination follows app appearance unless overridden. */
export const ICON_VARIATIONS: readonly IconVariationOption[] = Object.freeze([
  { title: 'Automatic', value: 'auto' },
  { title: 'Light', value: 'light' },
  { title: 'Dark', value: 'dark' },
]);

/** Accent colors for Tinted icons (1:1 with GNOME / macOS). */
export const ICON_TINT_COLORS: readonly IconTintColorOption[] = Object.freeze([
  { title: 'Automatic', value: 'automatic' },
  { title: 'Red', value: 'red', hex: '#ff453a' },
  { title: 'Orange', value: 'orange', hex: '#ff9f0a' },
  { title: 'Yellow', value: 'yellow', hex: '#ffd60a' },
  { title: 'Green', value: 'green', hex: '#32d74b' },
  { title: 'Blue', value: 'blue', hex: '#0a84ff' },
  { title: 'Purple', value: 'purple', hex: '#bf5af2' },
  { title: 'Pink', value: 'pink', hex: '#ff375f' },
  { title: 'Graphite', value: 'graphite', hex: '#8e8e93' },
]);

export const DEFAULT_ICON_STYLE: IconStyleSettings = Object.freeze({
  appearance: 'default',
  variation: 'auto',
  tintColor: 'automatic',
});

const APPEARANCE_SET = new Set<string>(ICON_APPEARANCES.map((entry) => entry.value));
const VARIATION_SET = new Set<string>(ICON_VARIATIONS.map((entry) => entry.value));
const TINT_COLOR_SET = new Set<string>(ICON_TINT_COLORS.map((entry) => entry.value));

const SYSTEM_ACCENT_FALLBACKS: Readonly<Record<string, string>> = Object.freeze({
  blue: '#0a84ff',
  teal: '#2190a4',
  slate: '#6f8396',
  green: '#32d74b',
  yellow: '#ffd60a',
  orange: '#ff9f0a',
  red: '#ff453a',
  pink: '#ff375f',
  purple: '#bf5af2',
  graphite: '#8e8e93',
});

export function isIconAppearance(value: unknown): value is IconAppearance {
  return typeof value === 'string' && APPEARANCE_SET.has(value);
}

export function isIconVariation(value: unknown): value is IconVariation {
  return typeof value === 'string' && VARIATION_SET.has(value);
}

export function isIconTintColor(value: unknown): value is IconTintColor {
  return typeof value === 'string' && TINT_COLOR_SET.has(value);
}

export function sanitizeIconStyle(input: unknown): IconStyleSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return DEFAULT_ICON_STYLE;
  }
  const rec = input as Record<string, unknown>;
  return {
    appearance: isIconAppearance(rec.appearance)
      ? rec.appearance
      : isIconAppearance(rec.iconAppearance)
        ? rec.iconAppearance
        : DEFAULT_ICON_STYLE.appearance,
    variation: isIconVariation(rec.variation)
      ? rec.variation
      : isIconVariation(rec.iconVariation)
        ? rec.iconVariation
        : DEFAULT_ICON_STYLE.variation,
    tintColor: isIconTintColor(rec.tintColor)
      ? rec.tintColor
      : isIconTintColor(rec.iconTintColor)
        ? rec.iconTintColor
        : DEFAULT_ICON_STYLE.tintColor,
  };
}

export function resolveIconTintColor(
  selection: IconTintColor | string,
  systemAccent = 'blue',
): string {
  if (typeof selection === 'string' && /^#[0-9a-f]{6}$/i.test(selection)) {
    return selection.toLowerCase();
  }
  if (selection !== 'automatic') {
    return ICON_TINT_COLORS.find((color) => color.value === selection)?.hex ?? '#0a84ff';
  }
  const accent = String(systemAccent ?? 'blue').toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(accent)) return accent;
  return SYSTEM_ACCENT_FALLBACKS[accent] ?? '#0a84ff';
}

export function resolveIconVariation(
  variation: IconVariation | string,
  systemDark: boolean,
): ResolvedIconVariation {
  if (variation === 'light' || variation === 'dark') return variation;
  return systemDark ? 'dark' : 'light';
}

/**
 * Resolves the effective color plate (`default` light vs `dark`) for standard icons:
 * - `dark` always forces the dark presentation.
 * - `default` follows `variation` (`auto` -> system light/dark, or explicit light/dark override).
 */
export function resolveEffectiveColorPresentation(
  appearance: 'default' | 'dark',
  variation: ResolvedIconVariation,
): 'default' | 'dark' {
  if (appearance === 'dark') return 'dark';
  return variation === 'dark' ? 'dark' : 'default';
}

export function resolveIconStyle(
  settings: Partial<IconStyleSettings> | undefined,
  systemDark: boolean,
  systemAccent = 'blue',
): ResolvedIconStyle {
  const clean = sanitizeIconStyle(settings);
  const variation = resolveIconVariation(clean.variation, systemDark);
  const tintHex = resolveIconTintColor(clean.tintColor, systemAccent);
  return {
    appearance: clean.appearance,
    variation,
    tintColor: clean.tintColor,
    tintHex,
  };
}

export function hexColorToRgb(hex: string): readonly [number, number, number] {
  const value = String(hex ?? '').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return [10 / 255, 132 / 255, 1];
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}
