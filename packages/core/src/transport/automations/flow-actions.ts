/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { SCENE_COLOR_KEYS, targetConfig, type SceneTarget } from '../scenes/targets.js';
import {
  AUTOMATION_WEEKDAYS,
  normalizeTimeDisplay,
  toFullTime,
  type AutomationConditionBlock,
  type AutomationWeekday,
} from './flow-types.js';
import { asRecord } from './types.js';

export const VALID_AUTOMATION_WEEKDAYS = new Set<string>(AUTOMATION_WEEKDAYS.map((d) => d.id));

export function extractEntityIds(item: Record<string, unknown>): string[] {
  const target = asRecord(item.target);
  const raw = target?.entity_id ?? item.entity_id;
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  return [];
}

export function extractStringList(raw: unknown): string[] {
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  return [];
}

export function extractScalarEventData(
  raw: unknown,
): Readonly<Record<string, string | number | boolean>> | null {
  const rec = asRecord(raw);
  if (!rec) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(rec)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    } else {
      return null;
    }
  }
  return result;
}

export function parseConditionBlock(
  item: Record<string, unknown>,
  idx: number,
): AutomationConditionBlock {
  const type = String(item.condition ?? '');
  const id = `if-${idx}`;
  if (type === 'state' && !item.attribute) {
    return {
      id,
      kind: 'device',
      entityId: extractEntityIds(item)[0] ?? '',
      state: String(item.state ?? 'on'),
    };
  }
  if (type === 'time') {
    const weekdays = Array.isArray(item.weekday)
      ? item.weekday.filter(
          (d): d is AutomationWeekday => typeof d === 'string' && VALID_AUTOMATION_WEEKDAYS.has(d),
        )
      : undefined;
    return {
      id,
      kind: 'time_window',
      ...(typeof item.after === 'string' ? { after: normalizeTimeDisplay(item.after) } : {}),
      ...(typeof item.before === 'string' ? { before: normalizeTimeDisplay(item.before) } : {}),
      ...(weekdays?.length ? { weekdays } : {}),
    };
  }
  if (type === 'sun') {
    return {
      id,
      kind: 'sun',
      ...(item.after === 'sunrise' || item.after === 'sunset' ? { after: item.after } : {}),
      ...(item.before === 'sunrise' || item.before === 'sunset' ? { before: item.before } : {}),
    };
  }
  if (type === 'numeric_state') {
    return {
      id,
      kind: 'threshold',
      entityId: extractEntityIds(item)[0] ?? '',
      ...(typeof item.above === 'number' ? { above: item.above } : {}),
      ...(typeof item.below === 'number' ? { below: item.below } : {}),
    };
  }
  return { id, kind: 'raw', raw: item, summary: type || 'Custom condition' };
}

export function compileConditionBlock(cond: AutomationConditionBlock): Record<string, unknown> {
  if (cond.kind === 'device') {
    return { condition: 'state', entity_id: cond.entityId, state: cond.state };
  }
  if (cond.kind === 'time_window') {
    return {
      condition: 'time',
      ...(cond.after ? { after: toFullTime(cond.after) } : {}),
      ...(cond.before ? { before: toFullTime(cond.before) } : {}),
      ...(cond.weekdays?.length ? { weekday: [...cond.weekdays] } : {}),
    };
  }
  if (cond.kind === 'sun') {
    return {
      condition: 'sun',
      ...(cond.after ? { after: cond.after } : {}),
      ...(cond.before ? { before: cond.before } : {}),
    };
  }
  if (cond.kind === 'threshold') {
    return {
      condition: 'numeric_state',
      entity_id: cond.entityId,
      ...(cond.above !== undefined ? { above: cond.above } : {}),
      ...(cond.below !== undefined ? { below: cond.below } : {}),
    };
  }
  return cond.raw;
}

export function parseDeviceActionTargets(
  item: Record<string, unknown>,
): Record<string, SceneTarget> | null {
  const service = String(item.action ?? item.service ?? '');
  if (!service.includes('.')) return null;
  const [domain, method] = service.split('.', 2);
  const entityIds = extractEntityIds(item);
  if (entityIds.length === 0) return null;
  const data = asRecord(item.data) ?? {};
  const allowedDataKeys = new Set([
    'brightness',
    'brightness_pct',
    ...SCENE_COLOR_KEYS,
    'effect',
    'temperature',
    'hvac_mode',
    'position',
    'percentage',
    'volume_level',
    'preset_mode',
  ]);
  if (Object.keys(data).some((key) => !allowedDataKeys.has(key))) return null;

  let baseTarget: SceneTarget | null = null;
  if (
    (domain === 'light' || domain === 'switch' || domain === 'input_boolean' || domain === 'fan') &&
    (method === 'turn_on' || method === 'turn_off')
  ) {
    baseTarget = { state: method === 'turn_on' ? 'on' : 'off' };
    if (method === 'turn_on') {
      if (typeof data.brightness === 'number') baseTarget.brightness = data.brightness;
      else if (typeof data.brightness_pct === 'number') {
        baseTarget.brightness = Math.round(data.brightness_pct * 2.55);
      }
      for (const key of SCENE_COLOR_KEYS) {
        if (data[key] !== undefined) baseTarget[key] = data[key];
      }
      if (typeof data.effect === 'string') baseTarget.effect = data.effect;
      if (typeof data.percentage === 'number') baseTarget.percentage = data.percentage;
      if (typeof data.preset_mode === 'string') baseTarget.preset_mode = data.preset_mode;
    }
  } else if (domain === 'lock' && (method === 'lock' || method === 'unlock')) {
    baseTarget = { state: method === 'lock' ? 'locked' : 'unlocked' };
  } else if (
    domain === 'cover' &&
    (method === 'open_cover' || method === 'close_cover' || method === 'set_cover_position')
  ) {
    if (method === 'set_cover_position' && typeof data.position === 'number') {
      baseTarget = {
        state: data.position > 0 ? 'open' : 'closed',
        current_position: data.position,
      };
    } else {
      baseTarget = { state: method === 'close_cover' ? 'closed' : 'open' };
    }
  } else if (
    domain === 'climate' &&
    (method === 'turn_off' || method === 'set_hvac_mode' || method === 'set_temperature')
  ) {
    baseTarget = {
      state:
        method === 'turn_off'
          ? 'off'
          : typeof data.hvac_mode === 'string'
            ? data.hvac_mode
            : 'heat',
      ...(typeof data.temperature === 'number' ? { temperature: data.temperature } : {}),
    };
  } else if (
    domain === 'media_player' &&
    (method === 'turn_off' || method === 'turn_on' || method === 'media_play' || method === 'media_pause')
  ) {
    baseTarget = {
      state:
        method === 'turn_off'
          ? 'off'
          : method === 'media_play'
            ? 'playing'
            : method === 'media_pause'
              ? 'paused'
              : 'on',
    };
  }
  if (!baseTarget) return null;
  return Object.fromEntries(entityIds.map((id) => [id, { ...baseTarget }]));
}

export function compileTargetToActions(
  entityId: string,
  rawSetting: unknown,
): Record<string, unknown>[] {
  const setting = targetConfig(rawSetting);
  const domain = entityId.split('.')[0] ?? 'switch';
  const state = String(setting.state ?? 'on');
  const target = { entity_id: entityId };

  if (domain === 'light') {
    if (state === 'off') return [{ action: 'light.turn_off', target }];
    const data: Record<string, unknown> = {};
    if (typeof setting.brightness === 'number') data.brightness = Math.round(setting.brightness);
    for (const key of SCENE_COLOR_KEYS) {
      if (setting[key] !== undefined) data[key] = setting[key];
    }
    if (typeof setting.effect === 'string' && setting.effect) data.effect = setting.effect;
    return [{ action: 'light.turn_on', target, ...(Object.keys(data).length > 0 ? { data } : {}) }];
  }
  if (domain === 'lock') {
    return [{ action: state === 'unlocked' ? 'lock.unlock' : 'lock.lock', target }];
  }
  if (domain === 'cover') {
    if (typeof setting.current_position === 'number' && state !== 'closed') {
      return [
        {
          action: 'cover.set_cover_position',
          target,
          data: { position: Math.round(setting.current_position) },
        },
      ];
    }
    return [{ action: state === 'closed' ? 'cover.close_cover' : 'cover.open_cover', target }];
  }
  if (domain === 'climate') {
    if (state === 'off') return [{ action: 'climate.turn_off', target }];
    if (typeof setting.temperature === 'number') {
      return [
        {
          action: 'climate.set_temperature',
          target,
          data: { temperature: setting.temperature, hvac_mode: state },
        },
      ];
    }
    return [{ action: 'climate.set_hvac_mode', target, data: { hvac_mode: state } }];
  }
  if (domain === 'fan') {
    if (state === 'off') return [{ action: 'fan.turn_off', target }];
    const data: Record<string, unknown> = {};
    if (typeof setting.percentage === 'number') data.percentage = Math.round(setting.percentage);
    if (typeof setting.preset_mode === 'string') data.preset_mode = setting.preset_mode;
    return [{ action: 'fan.turn_on', target, ...(Object.keys(data).length > 0 ? { data } : {}) }];
  }
  if (domain === 'media_player') {
    if (state === 'off') return [{ action: 'media_player.turn_off', target }];
    const calls: Record<string, unknown>[] = [
      {
        action:
          state === 'playing'
            ? 'media_player.media_play'
            : state === 'paused'
              ? 'media_player.media_pause'
              : 'media_player.turn_on',
        target,
      },
    ];
    if (typeof setting.volume_level === 'number') {
      calls.push({
        action: 'media_player.volume_set',
        target,
        data: { volume_level: setting.volume_level },
      });
    }
    return calls;
  }
  return [
    {
      action: `${domain === 'input_boolean' ? 'input_boolean' : 'switch'}.${state === 'off' ? 'turn_off' : 'turn_on'}`,
      target,
    },
  ];
}
