/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { EntityActionQueue } from '../command-queue.js';
import type { EntityAction } from './types.js';

export const HAUS_SCENE_QUEUE_KEY = 'scene:home';

const IDEMPOTENT_SETTER_SERVICES = new Set([
  'set_cover_position',
  'set_valve_position',
  'set_percentage',
  'volume_set',
  'set_temperature',
  'set_humidity',
  'set_value',
  'select_option',
  'set_hvac_mode',
  'set_operation_mode',
  'set_preset_mode',
  'set_fan_mode',
]);

/** Routes scenes through a home-wide FIFO barrier and all other commands per target entity. */
export function actionQueueKey(action: EntityAction): string {
  return action.domain === 'scene' ? HAUS_SCENE_QUEUE_KEY : action.target.entity_id;
}

/** Remote button pulses have no stateful entity representation and skip optimistic transactions. */
export function isStatelessAction(action: EntityAction): boolean {
  return action.domain === 'remote' && action.service === 'send_command';
}

export function isCoalesceableLightAction(action: EntityAction): boolean {
  if (action.domain !== 'light') return false;
  if (action.service !== 'turn_on' && action.service !== 'turn_off') return false;
  if (typeof action.target.entity_id !== 'string' || !action.target.entity_id) return false;
  const data = action.service_data;
  if (
    data &&
    (data.brightness_step !== undefined ||
      data.brightness_step_pct !== undefined ||
      data.flash !== undefined)
  ) {
    return false;
  }
  return true;
}

/**
 * Merges two waiting absolute light commands for the same entity while clearing mutually
 * exclusive colour/temperature/effect fields so bridges never receive ambiguous payloads.
 */
export function mergeLightActions<A extends EntityAction>(previous: A, next: A): A {
  if (next.service === 'turn_off' || previous.service === 'turn_off') {
    return next;
  }
  const mergedData: Record<string, unknown> = {
    ...previous.service_data,
    ...next.service_data,
  };
  const nextData = next.service_data ?? {};
  const setsColor = 'rgb_color' in nextData || 'hs_color' in nextData || 'xy_color' in nextData;
  const setsTemp =
    'color_temp' in nextData || 'color_temp_kelvin' in nextData || 'kelvin' in nextData;
  if (setsColor) {
    delete mergedData.color_temp;
    delete mergedData.color_temp_kelvin;
    delete mergedData.kelvin;
  } else if (setsTemp) {
    delete mergedData.rgb_color;
    delete mergedData.hs_color;
    delete mergedData.xy_color;
  }
  if ((setsColor || setsTemp) && !('effect' in nextData)) {
    delete mergedData.effect;
  } else if ('effect' in nextData && !setsColor && !setsTemp) {
    delete mergedData.rgb_color;
    delete mergedData.hs_color;
    delete mergedData.xy_color;
    delete mergedData.color_temp;
    delete mergedData.color_temp_kelvin;
    delete mergedData.kelvin;
  }
  return {
    ...next,
    service_data: mergedData,
  };
}

/**
 * Coalesces waiting idempotent commands targeting the same entity while returning `undefined`
 * for toggles, scenes, locks, cover directional triggers, and buttons so they act as FIFO barriers.
 */
export function coalesceHausActions<A extends EntityAction>(previous: A, next: A): A | undefined {
  if (previous.target.entity_id !== next.target.entity_id || !next.target.entity_id) {
    return undefined;
  }
  if (isCoalesceableLightAction(previous) && isCoalesceableLightAction(next)) {
    return mergeLightActions(previous, next);
  }
  if (
    previous.domain === next.domain &&
    previous.service === next.service &&
    IDEMPOTENT_SETTER_SERVICES.has(next.service)
  ) {
    return {
      ...next,
      service_data: {
        ...previous.service_data,
        ...next.service_data,
      },
    };
  }
  return undefined;
}

/**
 * Dispatches Haus device/scene actions through EntityActionQueue across all platforms,
 * coalescing rapid waiting slider/picker updates while keeping stateful barriers strictly FIFO.
 */
export function dispatchQueuedHausAction<A extends EntityAction, TResult>(
  queue: EntityActionQueue,
  action: A,
  execute: (active: A) => Promise<TResult>,
): Promise<TResult> {
  const key = actionQueueKey(action);
  if (isCoalesceableLightAction(action) || IDEMPOTENT_SETTER_SERVICES.has(action.service)) {
    return queue.runCoalesced(key, action, coalesceHausActions, execute);
  }
  return queue.run(key, () => execute(action));
}

export function extractContextId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const context = (value as Record<string, unknown>).context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return undefined;
  const id = (context as Record<string, unknown>).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}
