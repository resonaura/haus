/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  buildLightEffectOptions,
  describeLightEffect,
  findDisableEffectOption,
  formatLightEffectLabel,
  normalizeActiveLightEffect,
  type LightEffectIcon,
  type LightEffectMotion,
  type LightEffectOption,
  type LightEffectVisual,
} from '@haus/core/device';
import type { HassEntity } from './types.js';

export {
  buildLightEffectOptions,
  describeLightEffect,
  findDisableEffectOption,
  formatLightEffectLabel,
  normalizeActiveLightEffect,
  type LightEffectIcon,
  type LightEffectMotion,
  type LightEffectOption,
  type LightEffectVisual,
};

const brightnessModes = new Set([
  'brightness',
  'color_temp',
  'hs',
  'xy',
  'rgb',
  'rgbw',
  'rgbww',
  'white',
]);
const colorModes = new Set(['hs', 'xy', 'rgb', 'rgbw', 'rgbww']);

/** Returns advertised device effect values without fabricating support from stale attributes. */
export function lightEffects(entity: HassEntity): string[] {
  const list = entity.attributes.effect_list;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const effects: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string' || !item.trim() || seen.has(item)) continue;
    seen.add(item);
    effects.push(item);
  }
  return effects;
}

/** Classified, icon-matched effect options advertised by a light entity. */
export function lightEffectOptions(entity: HassEntity): LightEffectOption[] {
  return buildLightEffectOptions(lightEffects(entity));
}

/** Returns the light's native static/disable effect string when advertised in `effect_list`. */
export function lightDisableEffect(entity: HassEntity): string | undefined {
  return findDisableEffectOption(lightEffects(entity));
}

/** Returns the currently active dynamic effect string when the light is on. */
export function lightActiveEffect(entity: HassEntity): string | undefined {
  return normalizeActiveLightEffect(entity.attributes.effect, entity.state);
}

/** Returns the full unified visual descriptor for the light's active dynamic effect, if any. */
export function lightActiveEffectOption(entity: HassEntity): LightEffectOption | undefined {
  const active = lightActiveEffect(entity);
  if (!active) return undefined;
  return {
    ...describeLightEffect(active),
    value: active,
    label: formatLightEffectLabel(active),
  };
}

/** Applies optimistic effect prediction/clearing on light `turn_on` service calls. */
export function applyLightEffectPrediction(
  entity: HassEntity,
  data: Record<string, unknown>,
  attributes: Record<string, unknown>,
): void {
  if (typeof data.effect === 'string' && data.effect.trim()) {
    attributes.effect = data.effect;
    return;
  }
  const setsStaticColor = Boolean(
    data.rgb_color || data.color_temp_kelvin || data.color_temp || data.hs_color || data.xy_color,
  );
  if (setsStaticColor && lightActiveEffect(entity)) {
    attributes.effect = lightDisableEffect(entity) ?? null;
  }
}

/** Use advertised color modes, never infer controls from a stale color/brightness attribute. */
export function lightProfile(entity: HassEntity) {
  const attrs = entity.attributes;
  const modes: string[] = Array.isArray(attrs.supported_color_modes)
    ? attrs.supported_color_modes.filter((mode): mode is string => typeof mode === 'string')
    : typeof attrs.color_mode === 'string'
      ? [attrs.color_mode]
      : [];
  const color = modes.some((mode) => colorModes.has(mode));
  const temperature = modes.includes('color_temp');
  const brightness = modes.some((mode) => brightnessModes.has(mode));
  const effect = lightEffects(entity).length > 0;
  return {
    color,
    temperature,
    brightness,
    effect,
    kind: color ? 'color' : temperature ? 'temperature' : brightness ? 'dimmable' : 'onoff',
  } as const;
}

export function lightTemperature(entity: HassEntity): number | undefined {
  const attrs = entity.attributes;
  const kelvin = Number(
    attrs.color_temp_kelvin ?? (attrs.color_temp ? 1_000_000 / Number(attrs.color_temp) : 0),
  );
  return Number.isFinite(kelvin) && kelvin > 0 ? kelvin : undefined;
}

export function lightStateDescription(entity: HassEntity): string {
  if (entity.state !== 'on') return entity.state === 'off' ? 'Off' : entity.state;
  const profile = lightProfile(entity);
  const brightness = entity.attributes.brightness;
  const percent =
    profile.brightness && typeof brightness === 'number' && Number.isFinite(brightness)
      ? `${Math.round(Math.max(0, Math.min(255, brightness)) / 2.55)}% brightness`
      : 'On';
  const activeEffect = lightActiveEffect(entity);
  if (activeEffect) return `${percent} · ${formatLightEffectLabel(activeEffect)}`;
  const kelvin = lightTemperature(entity);
  return profile.temperature &&
    kelvin &&
    (!entity.attributes.color_mode || entity.attributes.color_mode === 'color_temp')
    ? `${percent} · ${Math.round(kelvin)} K`
    : percent;
}
