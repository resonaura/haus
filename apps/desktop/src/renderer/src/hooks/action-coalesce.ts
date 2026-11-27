/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { buildAction, Snapshot } from '../model';
import type { NativeEvent, NativeSession } from '../../../shared/native';
import {
  dispatchQueuedHausAction,
  executeQueuedHausAction,
  isStatelessAction,
  type EntityActionQueue,
  type OptimisticState,
} from '../model/optimistic';

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

export const isStatelessRemoteAction = isStatelessAction;

export const dispatchQueuedAction = dispatchQueuedHausAction;

export function executeQueuedHomeAction(params: {
  readonly action: Action;
  readonly queue: EntityActionQueue;
  readonly optimistic: OptimisticState;
  readonly getSnapshot: () => Snapshot;
  readonly getGeneration: () => number;
  readonly invalidate: () => void;
  readonly reportFailures: () => void;
  readonly send: (active: Action) => Promise<{ context?: { id?: string } }>;
}): Promise<void> {
  return executeQueuedHausAction(params);
}
