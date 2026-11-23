/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export const numeric = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};
export const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
export const humanize = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase());
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const deviceControlDomains = new Set([
  'light',
  'switch',
  'climate',
  'cover',
  'media_player',
  'lock',
  'fan',
  'valve',
  'humidifier',
  'water_heater',
  'alarm_control_panel',
  'vacuum',
  'siren',
  'select',
  'number',
  'button',
  'input_boolean',
  'input_number',
  'input_select',
  'input_button',
]);
