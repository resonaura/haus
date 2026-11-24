/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { entityDomain } from '../capabilities.js';
import { lightEffects } from '../../light-profile.js';
import type { HassEntity, HausAction } from '../types.js';

function numberInRange(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Enter a valid number.');
  return Math.min(max, Math.max(min, value));
}

function limit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rgbColor(value: unknown): number[] {
  const components =
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
      ? [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16))
      : value;
  if (!Array.isArray(components) || components.length !== 3)
    throw new Error('Choose an RGB color.');
  return components.map((component) => Math.round(numberInRange(component, 0, 255)));
}

/** UI intents become native HA service calls; never write states to pretend a device was controlled. */
export function buildAction(entity: HassEntity, intent: string, value?: unknown): HausAction {
  const domain = entityDomain(entity);
  if (
    entity.state === 'unavailable' ||
    (entity.state === 'unknown' && !['scene', 'button', 'input_button'].includes(domain))
  )
    throw new Error('This accessory is unavailable.');
  const attrs = entity.attributes;
  if (domain === 'water_heater' && attrs.read_only === true)
    throw new Error('This accessory is in read-only commissioning mode.');
  const target = { entity_id: entity.entity_id };
  const action = (service: string, service_data?: Record<string, unknown>): HausAction => ({
    domain,
    service,
    target,
    ...(service_data ? { service_data } : {}),
  });
  const ensure = (...domains: string[]) => {
    if (!domains.includes(domain)) throw new Error(`This accessory does not support ${intent}.`);
  };

  switch (intent) {
    case 'toggle':
      ensure('light', 'switch', 'fan', 'input_boolean', 'media_player', 'humidifier', 'automation');
      return action(['off', 'standby'].includes(entity.state) ? 'turn_on' : 'turn_off');
    case 'brightness':
      ensure('light');
      return action('turn_on', { brightness_pct: Math.round(numberInRange(value, 0, 100)) });
    case 'color':
      ensure('light');
      return action('turn_on', { rgb_color: rgbColor(value) });
    case 'temperature':
      ensure('light');
      return action('turn_on', {
        color_temp_kelvin: Math.round(
          numberInRange(
            value,
            limit(attrs.min_color_temp_kelvin, 2000),
            limit(attrs.max_color_temp_kelvin, 6500),
          ),
        ),
      });
    case 'effect': {
      ensure('light');
      const available = lightEffects(entity);
      if (typeof value !== 'string' || !value.trim() || !available.includes(value))
        throw new Error('Choose an available light effect.');
      return action('turn_on', { effect: value });
    }
    case 'climate-temperature': {
      ensure('climate');
      const min = limit(attrs.min_temp, 7);
      const max = limit(attrs.max_temp, 35);
      if (
        value &&
        typeof value === 'object' &&
        'target_temp_low' in value &&
        'target_temp_high' in value
      ) {
        const low = numberInRange(value.target_temp_low, min, max);
        const high = numberInRange(value.target_temp_high, min, max);
        if (low > high) throw new Error('The lower target must be below the upper target.');
        return action('set_temperature', { target_temp_low: low, target_temp_high: high });
      }
      if (entity.state === 'heat_cool')
        throw new Error('Choose both lower and upper temperatures for Heat/Cool mode.');
      return action('set_temperature', { temperature: numberInRange(value, min, max) });
    }
    case 'hvac-mode':
      ensure('climate');
      if (!Array.isArray(attrs.hvac_modes) || !attrs.hvac_modes.includes(value))
        throw new Error('This HVAC mode is not supported.');
      return action('set_hvac_mode', { hvac_mode: value });
    case 'water-temperature':
      ensure('water_heater');
      if (
        typeof attrs.min_temp !== 'number' ||
        typeof attrs.max_temp !== 'number' ||
        !Number.isFinite(attrs.min_temp) ||
        !Number.isFinite(attrs.max_temp)
      )
        throw new Error('Wait for the supported temperature range.');
      return action('set_temperature', {
        temperature: numberInRange(value, attrs.min_temp, attrs.max_temp),
      });
    case 'heater-mode':
      ensure('water_heater');
      if (!Array.isArray(attrs.operation_list) || !attrs.operation_list.includes(value))
        throw new Error('Choose an available operation mode.');
      return action('set_operation_mode', { operation_mode: value });
    case 'position':
      ensure('cover', 'valve');
      return action(`set_${domain}_position`, {
        position: Math.round(numberInRange(value, 0, 100)),
      });
    case 'open':
    case 'close':
    case 'stop':
      ensure('cover', 'valve');
      return action(`${intent}_${domain}`);
    case 'volume':
      ensure('media_player');
      return action('volume_set', { volume_level: numberInRange(value, 0, 1) });
    case 'play-pause':
      ensure('media_player');
      return action('media_play_pause');
    case 'lock':
    case 'unlock':
      ensure('lock');
      return action(intent);
    case 'run':
      ensure('scene', 'script');
      return action('turn_on');
    case 'percentage':
      ensure('fan');
      return action('set_percentage', { percentage: Math.round(numberInRange(value, 0, 100)) });
    case 'select':
      ensure('select', 'input_select');
      if (!Array.isArray(attrs.options) || !attrs.options.includes(value))
        throw new Error('Choose an available option.');
      return action('select_option', { option: value });
    case 'value':
      ensure('number', 'input_number');
      return action('set_value', {
        value: numberInRange(value, limit(attrs.min, -Infinity), limit(attrs.max, Infinity)),
      });
    case 'press':
      ensure('button', 'input_button');
      return action('press');
    case 'update-install': {
      ensure('update');
      const data: Record<string, unknown> = {};
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const opts = value as Record<string, unknown>;
        if (typeof opts.version === 'string' && opts.version.trim()) {
          data.version = opts.version.trim();
        }
        if (typeof opts.backup === 'boolean') data.backup = opts.backup;
      }
      return action('install', Object.keys(data).length ? data : undefined);
    }
    case 'update-skip':
      ensure('update');
      return action('skip');
    case 'update-clear-skipped':
      ensure('update');
      return action('clear_skipped');
    default:
      throw new Error(`Unsupported action: ${intent}`);
  }
}
