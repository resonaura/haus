/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isActiveLightEffect, isStaticLightEffect } from '@haus/core/device';
import type { HassEntity, HausAction, Snapshot } from '../types.js';
import { applyLightEffectPrediction } from '../light-profile.js';

export type OptimisticPatch = {
  entityId: string;
  state?: string;
  attributes: Record<string, unknown>;
};

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function prediction(snapshot: Snapshot, action: HausAction): OptimisticPatch[] {
  const entityId = action.target.entity_id;
  const entity = snapshot.states.find((item) => item.entity_id === entityId);
  if (
    !entity ||
    entity.state === 'unavailable' ||
    (entity.state === 'unknown' && action.domain !== 'scene')
  )
    return [];
  const data = action.service_data ?? {};
  const attributes: Record<string, unknown> = {};
  let state: string | undefined;
  const patch = (): OptimisticPatch[] => [{ entityId, state, attributes }];
  switch (action.service) {
    case 'turn_on':
    case 'turn_off': {
      if (action.domain === 'scene') {
        const settings =
          snapshot.sceneConfigs?.[entityId]?.entities ??
          entity.attributes.entities ??
          entity.attributes.states;
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
        return Object.entries(settings).flatMap(([id, setting]) => {
          const current = snapshot.states.find((item) => item.entity_id === id);
          if (!current || ['unknown', 'unavailable'].includes(current.state)) return [];
          if (typeof setting === 'string')
            return [{ entityId: id, state: setting, attributes: {} }];
          if (!setting || typeof setting !== 'object' || Array.isArray(setting)) return [];
          const {
            state: targetState,
            attributes: nested,
            ...rest
          } = setting as Record<string, unknown>;
          const attrs = { ...(nested && typeof nested === 'object' ? nested : rest) } as Record<
            string,
            unknown
          >;
          if (id.startsWith('light.') && isActiveLightEffect(attrs.effect)) {
            delete attrs.rgb_color;
            delete attrs.hs_color;
            delete attrs.xy_color;
            delete attrs.color_temp_kelvin;
            delete attrs.color_temp;
            delete attrs.color_mode;
          } else if (attrs.rgb_color) {
            attrs.color_mode = 'rgb';
          } else if (attrs.color_temp_kelvin || attrs.color_temp) {
            attrs.color_mode = 'color_temp';
          }
          return [
            {
              entityId: id,
              state: typeof targetState === 'string' ? targetState : undefined,
              attributes: attrs,
            },
          ];
        });
      }
      if (
        [
          'light',
          'switch',
          'input_boolean',
          'fan',
          'humidifier',
          'automation',
          'siren',
          'script',
        ].includes(action.domain)
      )
        state = action.service === 'turn_on' ? 'on' : 'off';
      if (action.domain === 'media_player') state = action.service === 'turn_on' ? 'idle' : 'off';
      if (action.domain === 'climate' && action.service === 'turn_off') state = 'off';
      if (action.domain === 'light' && action.service === 'turn_on') {
        if (typeof data.brightness_pct === 'number')
          attributes.brightness = Math.round(data.brightness_pct * 2.55);
        if (typeof data.brightness === 'number') attributes.brightness = data.brightness;
        if (attributes.brightness === 0) state = 'off';
        if (data.rgb_color) {
          attributes.rgb_color = data.rgb_color;
          attributes.color_mode = 'rgb';
        }
        if (data.color_temp_kelvin) {
          attributes.color_temp_kelvin = data.color_temp_kelvin;
          attributes.color_mode = 'color_temp';
        }
        applyLightEffectPrediction(entity, data, attributes);
      }
      return patch();
    }
    case 'set_temperature':
      Object.assign(attributes, data);
      return patch();
    case 'set_hvac_mode':
      state = String(data.hvac_mode);
      return patch();
    case 'set_operation_mode':
      state = String(data.operation_mode);
      if ('operation_mode' in entity.attributes) attributes.operation_mode = state;
      return patch();
    case 'set_cover_position':
    case 'set_valve_position':
      attributes.current_position = data.position;
      state =
        Number(data.position) > Number(entity.attributes.current_position ?? 0)
          ? 'opening'
          : 'closing';
      return patch();
    case 'open_cover':
    case 'open_valve':
      state = 'opening';
      return patch();
    case 'close_cover':
    case 'close_valve':
      state = 'closing';
      return patch();
    case 'stop_cover':
    case 'stop_valve':
      state = Number(entity.attributes.current_position) > 0 ? 'open' : 'closed';
      return patch();
    case 'volume_set':
      attributes.volume_level = data.volume_level;
      return patch();
    case 'media_play_pause':
      state = entity.state === 'playing' ? 'paused' : 'playing';
      return patch();
    case 'media_play':
      state = 'playing';
      return patch();
    case 'media_pause':
      state = 'paused';
      return patch();
    case 'lock':
      state = 'locking';
      return patch();
    case 'unlock':
      state = 'unlocking';
      return patch();
    case 'set_percentage':
      attributes.percentage = data.percentage;
      state = Number(data.percentage) ? 'on' : 'off';
      return patch();
    case 'select_option':
      state = String(data.option);
      return patch();
    case 'set_value':
      state = String(data.value);
      return patch();
    default:
      return [];
  }
}

export function restoredLightOverlay(
  restored: Record<string, unknown>,
  patchAttributes: Record<string, unknown>,
): Record<string, unknown> {
  const overlay = { ...restored };
  if (patchAttributes.rgb_color || patchAttributes.color_mode === 'rgb') {
    delete overlay.color_temp;
    delete overlay.color_temp_kelvin;
  } else if (
    patchAttributes.color_temp_kelvin ||
    patchAttributes.color_temp ||
    patchAttributes.color_mode === 'color_temp'
  ) {
    delete overlay.rgb_color;
    delete overlay.hs_color;
    delete overlay.xy_color;
  }
  return overlay;
}

function normalizedRgb(expected: unknown, actual: unknown): boolean {
  if (
    !Array.isArray(expected) ||
    !Array.isArray(actual) ||
    expected.length !== 3 ||
    actual.length !== 3 ||
    [...expected, ...actual].some(
      (value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 255,
    )
  )
    return false;
  const expectedMax = Math.max(...expected);
  const actualMax = Math.max(...actual);
  return (
    expectedMax > 0 &&
    actualMax > 0 &&
    expected.every(
      (value, index) => Math.abs(value / expectedMax - actual[index] / actualMax) <= 0.035,
    )
  );
}

function matchesAttribute(key: string, value: unknown, actual: unknown): boolean {
  if (key === 'effect') {
    if (isStaticLightEffect(value) && isStaticLightEffect(actual)) return true;
    if (typeof value === 'string' && typeof actual === 'string') {
      return value.trim().toLocaleLowerCase() === actual.trim().toLocaleLowerCase();
    }
    return false;
  }
  if (key === 'rgb_color' && normalizedRgb(value, actual)) return true;
  if (
    key === 'color_mode' &&
    value === 'rgb' &&
    typeof actual === 'string' &&
    ['rgb', 'rgbw', 'rgbww', 'xy', 'hs'].includes(actual)
  )
    return true;
  const tolerance =
    key === 'brightness'
      ? 3
      : key === 'color_temp_kelvin'
        ? 150
        : key === 'volume_level'
          ? 0.02
          : key === 'current_position'
            ? 1
            : 0;
  return typeof value === 'number' && typeof actual === 'number'
    ? Math.abs(value - actual) <= tolerance
    : equal(value, actual);
}

export function matches(patch: OptimisticPatch, entity: HassEntity): boolean {
  const terminal: Record<string, string> = {
    opening: 'open',
    closing: 'closed',
    locking: 'locked',
    unlocking: 'unlocked',
  };
  const waterHeaterModeConfirmed =
    patch.entityId.startsWith('water_heater.') &&
    patch.state !== undefined &&
    patch.attributes.operation_mode === patch.state &&
    entity.attributes.operation_mode === patch.state;
  if (
    patch.state !== undefined &&
    entity.state !== patch.state &&
    entity.state !== terminal[patch.state] &&
    !waterHeaterModeConfirmed
  ) {
    const numeric = /^(?:input_)?number\./.test(entity.entity_id);
    const step = Number(entity.attributes.step);
    const tolerance = Number.isFinite(step) && step > 0 ? Math.max(1e-6, step / 2) : 1e-6;
    if (
      !numeric ||
      !entity.state.trim() ||
      !patch.state.trim() ||
      !Number.isFinite(Number(entity.state)) ||
      !Number.isFinite(Number(patch.state)) ||
      Math.abs(Number(entity.state) - Number(patch.state)) > tolerance
    )
      return false;
  }
  return Object.entries(patch.attributes).every(([key, value]) =>
    matchesAttribute(key, value, entity.attributes[key]),
  );
}

/**
 * True when a light patch's power and every non-effect attribute are already confirmed `on`,
 * leaving only a dynamic `effect` name un-echoed (common on Govee LAN/Cloud & MQTT bridges
 * whose hardware status packets do not report the active scene name).
 */
export function isPatchEffectOnlyUnconfirmed(
  patch: OptimisticPatch,
  entity: HassEntity | undefined,
): boolean {
  if (!entity || !patch.entityId.startsWith('light.') || entity.state !== 'on') return false;
  if (!isActiveLightEffect(patch.attributes.effect)) return false;
  const { effect: _ignored, ...restAttributes } = patch.attributes;
  return matches({ ...patch, attributes: restAttributes }, entity);
}
