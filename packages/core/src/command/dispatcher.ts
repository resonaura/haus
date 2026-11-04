/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { sessionKey, type SessionOwnership } from '../session/ownership.js';
import type {
  CommandEntry,
  CommandJournal,
  CommandOutcome,
  CommandPolicy,
  CommandProvider,
  CommandRequest,
} from './types.js';

/** Journals intent before dispatch. A lost result never authorizes a second physical action. */
export class Commands {
  private readonly active = new Map<
    string,
    { fingerprint: string; outcome: Promise<CommandOutcome> }
  >();
  constructor(
    private readonly ownership: SessionOwnership,
    private readonly policy: CommandPolicy,
    private readonly journal: CommandJournal,
    private readonly provider: CommandProvider,
    private readonly timeoutMs = 15_000,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('invalid_command_timeout');
  }

  async execute(request: CommandRequest): Promise<CommandOutcome> {
    const frozen = structuredClone(request),
      { command, grant } = frozen;
    for (const value of [
      frozen.actorId,
      frozen.idempotencyKey,
      command.id,
      command.endpointId,
      command.capabilityId,
      command.operation,
    ]) {
      if (typeof value !== 'string' || !value.trim()) throw Error('invalid_command_request');
    }
    await this.ownership.assert(grant);
    if (sessionKey(grant.resource) !== sessionKey(this.provider.resource))
      throw Error('command_provider_owner_mismatch');
    let fingerprint: string;
    try {
      if (!(await this.policy.authorize(frozen.actorId, command))) throw Error('permission_denied');
    } catch {
      throw Error('command_permission_denied');
    }
    try {
      const { id: _id, ...intent } = command;
      fingerprint = await this.policy.fingerprint(intent);
      if (!fingerprint) throw Error('invalid_fingerprint');
    } catch {
      throw Error('command_fingerprint_unavailable');
    }
    const scope = {
      homeId: grant.resource.homeId,
      actorId: frozen.actorId,
      idempotencyKey: frozen.idempotencyKey,
    };
    const key = JSON.stringify([scope.homeId, scope.actorId, scope.idempotencyKey]);
    const existing = this.active.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw Error('command_idempotency_conflict');
      return existing.outcome;
    }
    const entry: CommandEntry = {
      scope,
      fingerprint,
      outcome: {
        schema: 'haus.receipt',
        version: 1,
        commandId: command.id,
        correlationId: command.id,
        ownerGeneration: grant.generation,
        status: 'unknown',
        reason: 'dispatch-pending',
      },
    };
    const outcome = this.run(frozen, entry).finally(() => this.active.delete(key));
    this.active.set(key, { fingerprint, outcome });
    return outcome;
  }

  private async run(request: CommandRequest, proposed: CommandEntry): Promise<CommandOutcome> {
    let reservation;
    try {
      reservation = await this.journal.reserve(proposed);
    } catch {
      throw Error('command_journal_unavailable');
    }
    const { entry } = reservation;
    if (entry.fingerprint !== proposed.fingerprint) throw Error('command_idempotency_conflict');
    if (!reservation.created) return entry.outcome;
    let allowed = false;
    try {
      allowed = await this.policy.authorize(request.actorId, request.command);
    } catch {
      // An unavailable permission service cannot authorize a new physical action.
      allowed = false;
    }
    if (!allowed)
      return this.settle(entry, {
        ...entry.outcome,
        status: 'failed',
        reason: 'permission-denied',
      });
    try {
      await this.ownership.assert(request.grant);
    } catch {
      return this.settle(entry, { ...entry.outcome, status: 'failed', reason: 'owner-changed' });
    }
    let outcome: CommandOutcome;
    try {
      outcome = await this.dispatch(request, entry.outcome);
    } catch {
      outcome = { ...entry.outcome, status: 'unknown', reason: 'transport-lost' };
    }
    return this.settle(entry, outcome);
  }

  private async dispatch(
    request: CommandRequest,
    receipt: CommandOutcome,
  ): Promise<CommandOutcome> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<CommandOutcome>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ ...receipt, status: 'unknown', reason: 'timeout' });
      }, this.timeoutMs);
    });
    const dispatched = Promise.resolve().then(async () => {
      try {
        await this.ownership.assert(request.grant);
      } catch {
        return { ...receipt, status: 'failed' as const, reason: 'owner-changed' as const };
      }
      if (controller.signal.aborted)
        return { ...receipt, status: 'unknown' as const, reason: 'timeout' as const };
      const result = await this.provider.execute(request.command, controller.signal);
      try {
        await this.ownership.assert(request.grant);
      } catch {
        return { ...receipt, status: 'unknown' as const, reason: 'owner-changed' as const };
      }
      if (!['accepted', 'confirmed', 'failed', 'unknown'].includes(result.status))
        throw Error('invalid_provider_receipt');
      return {
        ...receipt,
        status: result.status,
        correlationId: result.correlationId ?? receipt.correlationId,
        reason: result.status === 'failed' ? ('provider-rejected' as const) : undefined,
      };
    });
    try {
      return await Promise.race([dispatched, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async settle(entry: CommandEntry, outcome: CommandOutcome): Promise<CommandOutcome> {
    try {
      return await this.journal.settle({ ...entry, outcome });
    } catch {
      return { ...entry.outcome, status: 'unknown', reason: 'journal-unavailable' };
    }
  }
}
