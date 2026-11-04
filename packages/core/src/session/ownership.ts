/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  IntegrationRef,
  SessionGrant,
  SessionOwner,
  SessionRecord,
  SessionRepository,
  SessionState,
} from './types.js';

function valid(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
}

export function sessionKey(resource: IntegrationRef): string {
  if (resource?.kind !== 'integration' || !valid(resource.homeId) || !valid(resource.id))
    throw Error('invalid_integration_reference');
  return JSON.stringify([resource.homeId, resource.kind, resource.id]);
}

function matches(
  current: SessionRecord | undefined,
  grant: SessionGrant,
): current is SessionRecord {
  return (
    current !== undefined &&
    current.generation === grant.generation &&
    current.owner.hubId === grant.owner.hubId &&
    current.owner.processId === grant.owner.processId &&
    sessionKey(current.resource) === sessionKey(grant.resource)
  );
}

/** An unreachable owner remains the owner until an explicit fencing operation succeeds. */
export class SessionOwnership {
  private readonly revocations = new Map<string, Promise<void>>();
  constructor(private readonly repository: SessionRepository) {}

  acquire(resource: IntegrationRef, owner: SessionOwner): SessionGrant {
    sessionKey(resource);
    if (!valid(owner.hubId) || !valid(owner.processId)) throw Error('invalid_session_owner');
    const record = this.repository.update(resource, (current) => {
      if (current && current.state !== 'revoked') throw Error('integration_already_owned');
      const generation = (current?.generation ?? 0) + 1;
      if (!Number.isSafeInteger(generation)) throw Error('session_generation_exhausted');
      return { resource: { ...resource }, owner: { ...owner }, generation, state: 'connecting' };
    });
    return {
      resource: { ...record.resource },
      owner: { ...record.owner },
      generation: record.generation,
    };
  }

  assert(grant: SessionGrant, allowed: readonly SessionState[] = ['connected']): void {
    const current = this.repository.read(grant.resource);
    if (!matches(current, grant) || !allowed.includes(current.state))
      throw Error('integration_owner_unavailable');
  }

  connected(grant: SessionGrant): void {
    this.transition(grant, ['connecting'], 'connected');
  }

  requireReauthorization(grant: SessionGrant): void {
    this.transition(grant, ['connecting', 'connected', 'reauth-required'], 'reauth-required');
  }

  /** Only an explicit completed sign-in starts this transition; a network retry does not. */
  reconnect(grant: SessionGrant): void {
    this.transition(grant, ['reauth-required'], 'connecting');
  }

  revoke(grant: SessionGrant, fence: () => Promise<void>): Promise<void> {
    const key = JSON.stringify([sessionKey(grant.resource), grant.generation]);
    const existing = this.revocations.get(key);
    if (existing) return existing;
    // Mark unavailable synchronously, before any asynchronous shutdown or credential operation.
    try {
      this.transition(
        grant,
        ['connecting', 'connected', 'reauth-required', 'revoking'],
        'revoking',
      );
    } catch (error) {
      return Promise.reject(error);
    }
    const pending = Promise.resolve()
      .then(fence)
      .then(() => {
        this.transition(grant, ['revoking'], 'revoked');
      })
      .finally(() => this.revocations.delete(key));
    this.revocations.set(key, pending);
    return pending;
  }

  private transition(
    grant: SessionGrant,
    allowed: readonly SessionState[],
    state: SessionState,
  ): void {
    sessionKey(grant.resource);
    this.repository.update(grant.resource, (current) => {
      if (!matches(current, grant) || !allowed.includes(current.state))
        throw Error('integration_owner_unavailable');
      return { ...current, state };
    });
  }
}
