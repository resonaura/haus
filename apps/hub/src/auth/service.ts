/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { PairingGrant } from '@haus/core/pairing';
import { validatePairingGrant } from '@haus/core/pairing';
import type {
  ClientSession,
  ClientSessionCredentials,
  ClientSessionView,
  SessionRefreshResult,
  SessionResumeResult,
  TokenGenerator,
} from '@haus/core/auth';
import {
  issueSessionFromGrant,
  refreshClientSession,
  revokeClientSession,
  toSessionView,
  verifySessionToken,
} from '@haus/core/auth';
import { randomBytes } from 'node:crypto';

export interface HubAuthConfig {
  readonly hubId: string;
  readonly homeId: string;
  readonly hubUrl: string;
  readonly sessionTtlMs?: number;
  readonly now?: () => number;
  readonly tokenGenerator?: TokenGenerator;
}

export class HubAuthService {
  private readonly sessions = new Map<string, ClientSession>();
  private readonly tokens = new Map<string, string>(); // token -> sessionId
  private readonly now: () => number;
  private readonly tokenGen: TokenGenerator;

  constructor(private readonly config: HubAuthConfig) {
    this.now = config.now ?? (() => Date.now());
    this.tokenGen = config.tokenGenerator ?? (() => randomBytes(32).toString('hex'));
  }

  async pair(
    grant: PairingGrant,
  ): Promise<{ session: ClientSessionView; credentials: ClientSessionCredentials }> {
    validatePairingGrant(grant, {
      expectedHubId: this.config.hubId,
      expectedHomeId: this.config.homeId,
      now: this.now(),
    });

    const { session, credentials } = issueSessionFromGrant(grant, this.config.hubUrl, {
      ttlMs: this.config.sessionTtlMs,
      now: this.now(),
      tokenGenerator: this.tokenGen,
    });

    this.sessions.set(session.sessionId, session);
    this.tokens.set(session.token, session.sessionId);

    return {
      session: toSessionView(session, this.now()),
      credentials,
    };
  }

  async resume(sessionId: string, token: string): Promise<SessionResumeResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { status: 'reauth-required', error: 'invalid_session' };
    }

    const check = verifySessionToken(session, token, this.now());
    if (check === 'revoked') {
      return { status: 'revoked', error: 'session_revoked' };
    }
    if (check === 'expired') {
      return { status: 'expired', error: 'session_expired' };
    }
    if (check === 'invalid_token') {
      return { status: 'reauth-required', error: 'invalid_credentials' };
    }

    return {
      status: 'active',
      session: toSessionView(session, this.now()),
    };
  }

  async refresh(sessionId: string, refreshToken: string): Promise<SessionRefreshResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { status: 'reauth-required', error: 'invalid_session' };
    }

    try {
      this.tokens.delete(session.token);
      const { session: updated, credentials } = refreshClientSession(session, refreshToken, {
        ttlMs: this.config.sessionTtlMs,
        now: this.now(),
        tokenGenerator: this.tokenGen,
      });

      const fullCredentials: ClientSessionCredentials = {
        ...credentials,
        hubUrl: this.config.hubUrl,
      };

      this.sessions.set(sessionId, updated);
      this.tokens.set(updated.token, sessionId);

      return {
        status: 'renewed',
        credentials: fullCredentials,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'reauth_required';
      return {
        status: 'reauth-required',
        error: message as
          | 'reauth_required'
          | 'invalid_credentials'
          | 'invalid_session'
          | 'session_expired'
          | 'session_revoked',
      };
    }
  }

  async logout(sessionId: string, token?: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (token) {
      const check = verifySessionToken(session, token, this.now());
      if (check === 'invalid_token') return false;
    }

    const revoked = revokeClientSession(session);
    this.sessions.set(sessionId, revoked);
    this.tokens.delete(session.token);
    return true;
  }

  async authenticate(token: string): Promise<ClientSession | undefined> {
    if (!token) return undefined;
    const sessionId = this.tokens.get(token);
    if (!sessionId) return undefined;
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const check = verifySessionToken(session, token, this.now());
    if (check !== 'valid') return undefined;

    return session;
  }

  async getSession(sessionId: string): Promise<ClientSessionView | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return toSessionView(session, this.now());
  }

  async revokeClient(clientId: string): Promise<number> {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.clientId === clientId && !session.revoked) {
        this.sessions.set(id, revokeClientSession(session));
        this.tokens.delete(session.token);
        count++;
      }
    }
    return count;
  }
}
