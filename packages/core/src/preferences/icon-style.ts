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

export interface IconStyleSettings {
  readonly appearance: IconAppearance;
  readonly variation: IconVariation;
  readonly tintColor: IconTintColor;
}

export const DEFAULT_ICON_STYLE: IconStyleSettings = Object.freeze({
  appearance: 'default',
  variation: 'auto',
  tintColor: 'automatic',
});

const APPEARANCE_SET = new Set<string>(['default', 'dark', 'clear', 'tinted']);
const VARIATION_SET = new Set<string>(['auto', 'light', 'dark']);
const TINT_COLOR_SET = new Set<string>([
  'automatic',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'graphite',
]);

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
