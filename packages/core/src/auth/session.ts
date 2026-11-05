/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { PairingGrant } from '../pairing/types.js';
import { timingSafeStringEqual } from '../pairing/pairing.js';
import type {
  ClientSession,
  ClientSessionCredentials,
  ClientSessionView,
  TokenGenerator,
} from './types.js';

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000; // 30 days
const DEFAULT_ID_LENGTH = 32;

function defaultHexGenerator(): string {
  let hex = '';
  for (let i = 0; i < DEFAULT_ID_LENGTH; i++) {
    const byte = Math.floor(Math.random() * 256);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function isSessionExpired(
  session: { readonly expiresAt: number },
  now = Date.now(),
): boolean {
  return session.expiresAt <= now;
}

export function toSessionView(session: ClientSession, now = Date.now()): ClientSessionView {
  const state = session.revoked ? 'revoked' : isSessionExpired(session, now) ? 'expired' : 'active';

  return {
    sessionId: session.sessionId,
    hubId: session.hubId,
    homeId: session.homeId,
    clientId: session.clientId,
    clientRole: session.clientRole,
    clientName: session.clientName,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    state,
  };
}

export function sanitizeSessionForRenderer(
  session: ClientSession | ClientSessionCredentials | ClientSessionView,
  now = Date.now(),
): ClientSessionView {
  if ('state' in session) {
    return {
      sessionId: session.sessionId,
      hubId: session.hubId,
      homeId: session.homeId,
      clientId: session.clientId,
      clientRole: session.clientRole,
      clientName: session.clientName,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
      state: session.state,
    };
  }

  const isRevoked = 'revoked' in session ? Boolean(session.revoked) : false;
  const state = isRevoked ? 'revoked' : isSessionExpired(session, now) ? 'expired' : 'active';
  const issuedAt = 'issuedAt' in session ? session.issuedAt : now;

  return {
    sessionId: session.sessionId,
    hubId: session.hubId,
    homeId: session.homeId,
    clientId: session.clientId,
    clientRole: session.clientRole,
    clientName: session.clientName,
    issuedAt,
    expiresAt: session.expiresAt,
    state,
  };
}

export function validateSessionCredentials(value: unknown): ClientSessionCredentials | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.hubUrl !== 'string' ||
    typeof candidate.sessionId !== 'string' ||
    typeof candidate.sessionToken !== 'string' ||
    typeof candidate.hubId !== 'string' ||
    typeof candidate.homeId !== 'string' ||
    typeof candidate.clientId !== 'string' ||
    typeof candidate.clientName !== 'string' ||
    typeof candidate.clientRole !== 'string' ||
    typeof candidate.expiresAt !== 'number' ||
    !candidate.hubUrl ||
    !candidate.sessionId ||
    !candidate.sessionToken ||
    !candidate.hubId ||
    !candidate.homeId ||
    !candidate.clientId ||
    !candidate.clientName ||
    !Number.isFinite(candidate.expiresAt)
  ) {
    return null;
  }

  const role = candidate.clientRole;
  if (role !== 'admin' && role !== 'member' && role !== 'guest' && role !== 'node') {
    return null;
  }

  const refreshToken =
    typeof candidate.refreshToken === 'string' && candidate.refreshToken.length > 0
      ? candidate.refreshToken
      : undefined;

  return {
    hubUrl: candidate.hubUrl,
    sessionId: candidate.sessionId,
    sessionToken: candidate.sessionToken,
    refreshToken,
    hubId: candidate.hubId,
    homeId: candidate.homeId,
    clientId: candidate.clientId,
    clientName: candidate.clientName,
    clientRole: role,
    expiresAt: candidate.expiresAt,
  };
}

export function issueSessionFromGrant(
  grant: PairingGrant,
  hubUrl: string,
  options?: {
    ttlMs?: number;
    now?: number;
    tokenGenerator?: TokenGenerator;
  },
): { session: ClientSession; credentials: ClientSessionCredentials } {
  const now = options?.now ?? Date.now();
  if (grant.revoked) {
    throw Error('grant_revoked');
  }
  if (grant.expiresAt !== undefined && grant.expiresAt <= now) {
    throw Error('grant_expired');
  }

  const generator = options?.tokenGenerator ?? defaultHexGenerator;
  const sessionId = generator();
  const token = generator();
  const refreshToken = generator();
  const expiresAt = now + (options?.ttlMs ?? DEFAULT_SESSION_TTL_MS);

  const session: ClientSession = {
    sessionId,
    hubId: grant.hubId,
    homeId: grant.homeId,
    clientId: grant.clientId,
    clientRole: grant.clientRole,
    clientName: grant.clientName,
    token,
    refreshToken,
    issuedAt: now,
    expiresAt,
    revoked: false,
  };

  const credentials: ClientSessionCredentials = {
    hubUrl,
    sessionId,
    sessionToken: token,
    refreshToken,
    hubId: grant.hubId,
    homeId: grant.homeId,
    clientId: grant.clientId,
    clientName: grant.clientName,
    clientRole: grant.clientRole,
    expiresAt,
  };

  return { session, credentials };
}

export function verifySessionToken(
  session: ClientSession,
  token: string,
  now = Date.now(),
): 'valid' | 'expired' | 'revoked' | 'invalid_token' {
  if (session.revoked) return 'revoked';
  if (isSessionExpired(session, now)) return 'expired';
  if (!timingSafeStringEqual(session.token, token)) return 'invalid_token';
  return 'valid';
}

export function refreshClientSession(
  session: ClientSession,
  refreshToken: string,
  options?: {
    ttlMs?: number;
    now?: number;
    tokenGenerator?: TokenGenerator;
  },
): { session: ClientSession; credentials: ClientSessionCredentials } {
  const now = options?.now ?? Date.now();
  if (session.revoked) throw Error('session_revoked');
  if (!session.refreshToken || !timingSafeStringEqual(session.refreshToken, refreshToken)) {
    throw Error('invalid_credentials');
  }

  const generator = options?.tokenGenerator ?? defaultHexGenerator;
  const nextToken = generator();
  const nextRefreshToken = generator();
  const expiresAt = now + (options?.ttlMs ?? DEFAULT_SESSION_TTL_MS);

  const updatedSession: ClientSession = {
    ...session,
    token: nextToken,
    refreshToken: nextRefreshToken,
    expiresAt,
  };

  const credentials: ClientSessionCredentials = {
    hubUrl: '', // Filled in by caller/store if needed
    sessionId: session.sessionId,
    sessionToken: nextToken,
    refreshToken: nextRefreshToken,
    hubId: session.hubId,
    homeId: session.homeId,
    clientId: session.clientId,
    clientName: session.clientName,
    clientRole: session.clientRole,
    expiresAt,
  };

  return { session: updatedSession, credentials };
}

export function revokeClientSession(session: ClientSession): ClientSession {
  return {
    ...session,
    revoked: true,
  };
}
