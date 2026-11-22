/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { buildAction, Snapshot } from '../model';
import type { NativeEvent, NativeSession } from '../../../shared/native';
import type { EntityActionQueue, OptimisticState } from '../model/optimistic';

type Action = ReturnType<typeof buildAction>;

const HUB_RELOAD_TOPICS = new Set(['rooms', 'scenes', 'apps']);
const HA_RELOAD_TOPICS = new Set(['devices', 'rooms', 'scenes', 'apps']);

/** Hub device live deltas are applied in main via state_changed / device_registry_updated. */
export function shouldReloadHomeForLiveEvent(
  event: Extract<NativeEvent, { type: 'helper-live' }>,
  session: NativeSession | null,
): boolean {
  if (!event.online || !event.topic) return false;
  return session?.kind === 'haus-hub'
    ? HUB_RELOAD_TOPICS.has(event.topic)
    : HA_RELOAD_TOPICS.has(event.topic);
}

function isCoalesceableLightAction(action: Action): boolean {
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

function mergeLightActions(previous: Action, next: Action): Action {
  if (next.service === 'turn_off' || previous.service === 'turn_off') {
    return next;
  }
  const mergedData: Record<string, unknown> = {
    ...previous.service_data,
    ...next.service_data,
  };
  const nextData = next.service_data ?? {};
  if ('rgb_color' in nextData || 'hs_color' in nextData || 'xy_color' in nextData) {
    delete mergedData.color_temp;
    delete mergedData.color_temp_kelvin;
    delete mergedData.kelvin;
  } else if ('color_temp' in nextData || 'color_temp_kelvin' in nextData || 'kelvin' in nextData) {
    delete mergedData.rgb_color;
    delete mergedData.hs_color;
    delete mergedData.xy_color;
  }
  return {
    ...next,
    service_data: mergedData,
  };
}

export async function executeQueuedHomeAction(params: {
  readonly action: Action;
  readonly queue: EntityActionQueue;
  readonly optimistic: OptimisticState;
  readonly getSnapshot: () => Snapshot;
  readonly getGeneration: () => number;
  readonly invalidate: () => void;
  readonly reportFailures: () => void;
  readonly send: (active: Action) => Promise<{ context?: { id?: string } }>;
}): Promise<void> {
  const {
    action,
    queue,
    optimistic,
    getSnapshot,
    getGeneration,
    invalidate,
    reportFailures,
    send,
  } = params;
  const generation = getGeneration();
  const run = (active: Action) => {
    if (generation !== getGeneration())
      throw new Error('The home connection changed before this command could be sent.');
    return send(active);
  };
  if (isStatelessRemoteAction(action)) {
    await dispatchQueuedAction(queue, action, run);
    return;
  }
  const transaction = optimistic.begin(getSnapshot(), action);
  invalidate();
  try {
    const result = await dispatchQueuedAction(queue, action, run);
    if (generation !== getGeneration()) return;
    optimistic.acknowledge(transaction, result?.context?.id, getSnapshot());
    reportFailures();
    invalidate();
  } catch (error) {
    if (generation === getGeneration()) {
      optimistic.reject(transaction);
      invalidate();
    }
    throw error;
  }
}

export function isStatelessRemoteAction(action: Action): boolean {
  return action.domain === 'remote' && action.service === 'send_command';
}

/**
 * Dispatches renderer entity actions through EntityActionQueue, coalescing rapid waiting
 * absolute light commands (brightness/color/temp) while keeping toggles/scenes strictly FIFO.
 */
export function dispatchQueuedAction<TResult>(
  queue: EntityActionQueue,
  action: Action,
  execute: (active: Action) => Promise<TResult>,
): Promise<TResult> {
  const key = action.domain === 'scene' ? 'scene:home' : action.target.entity_id;
  if (isCoalesceableLightAction(action)) {
    return queue.runCoalesced(key, action, mergeLightActions, execute);
  }
  return queue.run(key, () => execute(action));
}
