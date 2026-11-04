/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HomeEvent, ProviderSession } from './types.js';

export function validateProviderSession(next: ProviderSession, previous?: ProviderSession): void {
  if (
    !next.epoch ||
    !next.owner?.hubId ||
    !next.owner.processId ||
    !Number.isSafeInteger(next.generation) ||
    next.generation < 1
  )
    throw Error('invalid_provider_session');
  if (
    previous &&
    (next.generation < previous.generation ||
      (next.generation === previous.generation &&
        (next.owner.hubId !== previous.owner.hubId ||
          next.owner.processId !== previous.owner.processId)))
  )
    throw Error('stale_provider_owner');
}

export function matchesProviderSession(event: HomeEvent, session?: ProviderSession): boolean {
  if (!session) return event.version === 1;
  return (
    event.version === 2 &&
    event.epoch === session.epoch &&
    event.ownerGeneration === session.generation &&
    event.owner?.hubId === session.owner.hubId &&
    event.owner.processId === session.owner.processId
  );
}
