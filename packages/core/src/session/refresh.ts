/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { sessionKey, type SessionOwnership } from './ownership.js';
import type { RefreshProvider, RefreshStart, RefreshVault, SessionGrant } from './types.js';

interface Attempt {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

export type RefreshCode =
  | 'refresh_busy'
  | 'refresh_unknown'
  | 'refresh_reauth_required'
  | 'refresh_store_unavailable'
  | 'refresh_owner_changed'
  | 'refresh_recovery_required';

export class RefreshError extends Error {
  constructor(readonly code: RefreshCode) {
    super(code);
    this.name = 'RefreshError';
  }
}

/** One rotating-token exchange per owner, with a durable reservation before any provider call. */
export class TokenRefresh<Credential> {
  private readonly attempts = new Map<string, Attempt>();
  constructor(
    private readonly ownership: SessionOwnership,
    private readonly vault: RefreshVault<Credential>,
    private readonly provider: RefreshProvider<Credential>,
    private readonly allocateAttempt: () => string,
    private readonly timeoutMs = 15_000,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('invalid_refresh_timeout');
  }

  refresh(grant: SessionGrant): Promise<void> {
    const key = this.key(grant),
      existing = this.attempts.get(key);
    if (existing) return existing.done;
    const controller = new AbortController();
    // Starting in a microtask publishes the in-flight promise before touching secure storage.
    const done = Promise.resolve()
      .then(() => this.run(grant, controller))
      .finally(() => {
        this.attempts.delete(key);
      });
    this.attempts.set(key, { controller, done });
    return done;
  }

  /** Used by the owner's fencing path; unknown outcomes stay blocked even after abort. */
  async fence(grant: SessionGrant): Promise<void> {
    const attempt = this.attempts.get(this.key(grant));
    if (!attempt) return;
    attempt.controller.abort();
    try {
      await attempt.done;
    } catch (error) {
      // Recovery has durably blocked the token before these expected outcomes are returned.
      if (
        !(error instanceof RefreshError) ||
        !['refresh_unknown', 'refresh_reauth_required', 'refresh_owner_changed'].includes(
          error.code,
        )
      )
        throw error;
    }
  }

  private async run(grant: SessionGrant, controller: AbortController): Promise<void> {
    if (controller.signal.aborted) return;
    try {
      await this.ownership.assert(grant, ['connecting', 'connected']);
    } catch {
      throw new RefreshError('refresh_owner_changed');
    }
    const attemptId = this.allocateAttempt();
    if (typeof attemptId !== 'string' || !attemptId.trim()) throw Error('invalid_refresh_attempt');
    let start: RefreshStart<Credential>;
    try {
      start = await this.vault.begin(grant, attemptId);
    } catch {
      throw new RefreshError('refresh_store_unavailable');
    }
    if (start.status === 'busy') throw new RefreshError('refresh_busy');
    if (start.status === 'reauth-required') {
      await this.ownership.requireReauthorization(grant);
      throw new RefreshError('refresh_reauth_required');
    }
    let failure: RefreshCode = 'refresh_unknown';
    try {
      await this.ownership.assert(grant, ['connecting', 'connected']);
      if (controller.signal.aborted) throw new RefreshError('refresh_unknown');
      const result = await this.exchange(start.credential, controller);
      if (result.status === 'reauth-required') {
        failure = 'refresh_reauth_required';
        throw new RefreshError(failure);
      }
      failure = 'refresh_owner_changed';
      await this.ownership.assert(grant, ['connecting', 'connected']);
      failure = 'refresh_unknown';
      if (!(await this.vault.complete(grant, attemptId, result.credential)))
        throw new RefreshError('refresh_owner_changed');
      await this.ownership.assert(grant, ['connecting', 'connected']);
      return;
    } catch (error) {
      if (error instanceof RefreshError) failure = error.code;
      await this.recover(grant, attemptId, failure);
    }
  }

  private async recover(
    grant: SessionGrant,
    attemptId: string,
    failure: RefreshCode,
  ): Promise<never> {
    let blocked: boolean;
    try {
      blocked = await this.vault.block(grant, attemptId);
    } catch {
      // The durable begin marker still prevents reusing the old token after a process restart.
      throw new RefreshError('refresh_recovery_required');
    }
    if (!blocked) throw new RefreshError('refresh_owner_changed');
    try {
      await this.ownership.requireReauthorization(grant);
    } catch {
      throw new RefreshError('refresh_owner_changed');
    }
    throw new RefreshError(failure);
  }

  private async exchange(credential: Credential, controller: AbortController) {
    let abort = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new RefreshError('refresh_unknown'));
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await Promise.race([
        this.provider.refresh(credential, controller.signal),
        interrupted,
      ]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort);
    }
  }

  private key(grant: SessionGrant): string {
    return JSON.stringify([
      sessionKey(grant.resource),
      grant.generation,
      grant.owner.hubId,
      grant.owner.processId,
    ]);
  }
}
