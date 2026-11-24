/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { applyLightEffectPrediction } from '../../light-profile.js';
import type { HausAction, Snapshot } from '../../types.js';

const demoScenes: Record<
  string,
  Record<string, { state?: string; attributes?: Record<string, unknown> }>
> = {
  'scene.good_morning': {
    'light.living_room_pendant': {
      state: 'on',
      attributes: { brightness: 230, color_temp_kelvin: 3600 },
    },
    'light.bedroom_lamps': {
      state: 'on',
      attributes: { brightness: 155, color_temp_kelvin: 3000 },
    },
    'cover.living_room_blinds': { state: 'open', attributes: { current_position: 100 } },
    'climate.home': { state: 'heat', attributes: { temperature: 22 } },
  },
  'scene.movie_time': {
    'light.living_room_pendant': {
      state: 'on',
      attributes: { brightness: 35, color_temp_kelvin: 2400 },
    },
    'light.corner_lamp': {
      state: 'on',
      attributes: { brightness: 75, rgb_color: [255, 174, 94], color_mode: 'rgb' },
    },
    'cover.living_room_blinds': { state: 'closed', attributes: { current_position: 0 } },
    'media_player.living_room': { state: 'playing' },
  },
  'scene.good_night': {
    'light.living_room_pendant': { state: 'off' },
    'light.corner_lamp': { state: 'off' },
    'light.bedroom_lamps': { state: 'off' },
    'light.kitchen_pendants': { state: 'off' },
    'lock.front_door': { state: 'locked' },
    'climate.home': { state: 'heat', attributes: { temperature: 19 } },
  },
  'scene.away': {
    'light.living_room_pendant': { state: 'off' },
    'light.corner_lamp': { state: 'off' },
    'light.bedroom_lamps': { state: 'off' },
    'light.kitchen_pendants': { state: 'off' },
    'media_player.living_room': { state: 'off' },
    'lock.front_door': { state: 'locked' },
    'climate.home': { state: 'heat', attributes: { temperature: 17 } },
  },
};

/** Replays the same actions against fictional data. Live connections never use this reducer. */
export function applyDemoAction(snapshot: Snapshot, action: HausAction): Snapshot {
  const current = snapshot.states.find((entity) => entity.entity_id === action.target.entity_id);
  if (!current) throw new Error('This demo accessory was not found.');
  if (current.state === 'unavailable') throw new Error('This demo accessory is offline.');
  const data = action.service_data ?? {};
  const attributes = { ...current.attributes };
  let state = current.state;
  const timestamp = new Date().toISOString();
  const sceneChanges =
    action.domain === 'scene' && action.service === 'turn_on'
      ? (demoScenes[current.entity_id] ?? {})
      : {};

  switch (action.service) {
    case 'turn_on':
      state = action.domain === 'scene' ? timestamp : 'on';
      if (data.brightness_pct !== undefined)
        attributes.brightness = Math.round((Number(data.brightness_pct) * 255) / 100);
      if (data.brightness_pct === 0) state = 'off';
      if (data.rgb_color) {
        attributes.rgb_color = data.rgb_color;
        attributes.color_mode = 'rgb';
      }
      if (data.color_temp_kelvin) {
        attributes.color_temp_kelvin = data.color_temp_kelvin;
        attributes.color_mode = 'color_temp';
      }
      if (action.domain === 'light') applyLightEffectPrediction(current, data, attributes);
      if (action.domain === 'scene') attributes.last_activated = timestamp;
      break;
    case 'turn_off':
      state = 'off';
      break;
    case 'set_temperature':
      Object.assign(attributes, data);
      break;
    case 'set_hvac_mode':
      state = String(data.hvac_mode);
      attributes.hvac_action = state === 'off' ? 'off' : 'idle';
      break;
    case 'set_operation_mode':
      state = String(data.operation_mode);
      attributes.operation_mode = state;
      break;
    case 'set_cover_position':
    case 'set_valve_position':
      attributes.current_position = data.position;
      state = Number(data.position) === 0 ? 'closed' : 'open';
      break;
    case 'open_cover':
    case 'open_valve':
      state = 'open';
      attributes.current_position = 100;
      break;
    case 'close_cover':
    case 'close_valve':
      state = 'closed';
      attributes.current_position = 0;
      break;
    case 'stop_cover':
    case 'stop_valve':
      state = Number(attributes.current_position) === 0 ? 'closed' : 'open';
      break;
    case 'volume_set':
      attributes.volume_level = data.volume_level;
      break;
    case 'media_play_pause':
      state = current.state === 'playing' ? 'paused' : 'playing';
      break;
    case 'lock':
      state = 'locked';
      break;
    case 'unlock':
      state = 'unlocked';
      break;
    case 'set_percentage':
      attributes.percentage = data.percentage;
      state = Number(data.percentage) === 0 ? 'off' : 'on';
      break;
    case 'select_option':
      state = String(data.option);
      break;
    case 'set_value':
      state = String(data.value);
      break;
    case 'press':
      state = timestamp;
      break;
    case 'install':
      state = 'off';
      if (typeof data.version === 'string' && data.version) {
        attributes.installed_version = data.version;
      } else if (typeof attributes.latest_version === 'string') {
        attributes.installed_version = attributes.latest_version;
      }
      attributes.in_progress = false;
      attributes.skipped_version = null;
      break;
    case 'skip':
      state = 'off';
      if (typeof attributes.latest_version === 'string') {
        attributes.skipped_version = attributes.latest_version;
      }
      break;
    case 'clear_skipped':
      attributes.skipped_version = null;
      if (
        typeof attributes.latest_version === 'string' &&
        attributes.latest_version !== attributes.installed_version
      ) {
        state = 'on';
      }
      break;
    default:
      throw new Error(`This demo does not implement ${action.domain}.${action.service}.`);
  }
  return {
    ...snapshot,
    states: snapshot.states.map((entity) => {
      if (entity.entity_id === current.entity_id)
        return {
          ...entity,
          state,
          attributes,
          last_updated: timestamp,
          last_changed: state !== entity.state ? timestamp : entity.last_changed,
        };
      const patch = sceneChanges[entity.entity_id];
      if (!patch) return entity;
      return {
        ...entity,
        state: patch.state ?? entity.state,
        attributes: { ...entity.attributes, ...patch.attributes },
        last_updated: timestamp,
        last_changed: patch.state && patch.state !== entity.state ? timestamp : entity.last_changed,
      };
    }),
  };
}
