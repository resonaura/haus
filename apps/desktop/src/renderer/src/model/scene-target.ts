/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HassEntity } from './types';

export type SceneTarget = Record<string, unknown>;

export function targetConfig(value: unknown): SceneTarget {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as SceneTarget)
    : { state: value };
}

export const SCENE_COLOR_KEYS = [
  'color_temp',
  'color_temp_kelvin',
  'rgb_color',
  'hs_color',
  'xy_color',
  'rgbw_color',
  'rgbww_color',
] as const;

export const SCENE_COLOR_MODES: Readonly<Record<string, string>> = {
  color_temp_kelvin: 'color_temp',
  color_temp: 'color_temp',
  hs_color: 'hs',
  xy_color: 'xy',
  rgb_color: 'rgb',
  rgbw_color: 'rgbw',
  rgbww_color: 'rgbww',
};

// Follow HA's scene reproduction order for older targets without color_mode.
const colorOrder = [
  'hs_color',
  'color_temp_kelvin',
  'rgb_color',
  'rgbw_color',
  'rgbww_color',
  'xy_color',
  'color_temp',
];

export function targetColorKey(value: SceneTarget): string | undefined {
  const supplied = colorOrder.filter((key) => value[key] != null);
  const mode = typeof value.color_mode === 'string' ? value.color_mode : '';
  if (['onoff', 'brightness', 'white'].includes(mode)) return undefined;
  return supplied.find((key) => SCENE_COLOR_MODES[key] === mode) ?? supplied[0];
}

export function patchSceneTarget(value: unknown, key: string, setting: unknown): SceneTarget {
  const next = { ...targetConfig(value) };
  if ((SCENE_COLOR_KEYS as readonly string[]).includes(key)) {
    for (const field of SCENE_COLOR_KEYS) delete next[field];
    next.color_mode = SCENE_COLOR_MODES[key];
  }
  if (key === 'state' && ['open', 'closed'].includes(String(setting))) {
    // HA restores explicit positions before open/close. A state choice means fully open/closed.
    delete next.current_position;
    delete next.current_tilt_position;
  }
  if (key === 'current_position' && typeof setting === 'number')
    next.state = setting > 0 ? 'open' : 'closed';
  return { ...next, [key]: setting };
}

export function captureSceneTarget(entity: HassEntity): SceneTarget {
  const attrs = Object.fromEntries(
    Object.entries(entity.attributes).filter(([key]) =>
      [
        'brightness',
        ...SCENE_COLOR_KEYS,
        'current_position',
        'temperature',
        'percentage',
        'volume_level',
        'preset_mode',
        'effect',
      ].includes(key),
    ),
  );
  if (entity.entity_id.startsWith('light.')) {
    const color = targetColorKey(entity.attributes);
    for (const field of SCENE_COLOR_KEYS) if (field !== color) delete attrs[field];
    if (color === 'color_temp') {
      attrs.color_temp_kelvin = Math.round(1e6 / Number(attrs.color_temp));
      delete attrs.color_temp;
    }
    const mode = color ? SCENE_COLOR_MODES[color] : entity.attributes.color_mode;
    if (mode === 'onoff') delete attrs.brightness;
    if (typeof mode === 'string' && (color || ['onoff', 'brightness', 'white'].includes(mode))) {
      attrs.color_mode = mode;
    }
  }
  return {
    state: ['unknown', 'unavailable'].includes(entity.state) ? 'off' : entity.state,
    ...attrs,
  };
}

/** Preview the draft, never a competing colour inherited from the live device. */
export function sceneTargetEntity(entity: HassEntity, value: unknown): HassEntity {
  const setting = targetConfig(value);
  const { state, ...settings } = setting;
  const attributes: Record<string, unknown> = { ...entity.attributes, ...settings };
  const color = targetColorKey(setting);
  if (color || setting.color_mode) {
    for (const field of SCENE_COLOR_KEYS) if (field !== color) delete attributes[field];
    attributes.color_mode = color ? SCENE_COLOR_MODES[color] : setting.color_mode;
  }
  return { ...entity, state: String(state ?? entity.state), attributes };
}

export function sceneTargetSummary(id: string, setting: unknown) {
  const value = targetConfig(setting);
  if (value.state === 'off') return 'Off';
  const parts = [String(value.state ?? 'On').replaceAll('_', ' ')];
  if (id.startsWith('light.') && typeof value.brightness === 'number')
    parts.push(`${Math.round(value.brightness / 2.55)}%`);
  const kelvin =
    typeof value.color_temp_kelvin === 'number'
      ? value.color_temp_kelvin
      : typeof value.color_temp === 'number'
        ? 1e6 / value.color_temp
        : 0;
  if (Number.isFinite(kelvin) && kelvin > 0) parts.push(`${Math.round(kelvin)} K`);
  if (typeof value.temperature === 'number') parts.push(`${value.temperature}°`);
  if (typeof value.current_position === 'number') parts.push(`${value.current_position}% open`);
  return parts.join(' · ');
}
