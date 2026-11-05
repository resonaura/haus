/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  ClientIdentity,
  ClientRole,
  DiscoveredHub,
  HubIdentity,
  PairingGrant,
  PairingOffer,
  PairingSessionRecord,
} from './types.js';

const VALID_ROLES = new Set<ClientRole>(['admin', 'member', 'guest', 'node']);
const DEFAULT_TTL_MS = 300_000; // 5 minutes

function valid(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function validateHubIdentity(hub: HubIdentity): void {
  if (!hub || typeof hub !== 'object') throw Error('invalid_hub_identity');
  if (!valid(hub.hubId) || !valid(hub.homeId) || !valid(hub.name)) {
    throw Error('invalid_hub_identity');
  }
  if (hub.fingerprint !== undefined && !valid(hub.fingerprint)) {
    throw Error('invalid_hub_identity');
  }
  if (hub.publicKey !== undefined && !valid(hub.publicKey)) {
    throw Error('invalid_hub_identity');
  }
}

export function validateClientIdentity(client: ClientIdentity): void {
  if (!client || typeof client !== 'object') throw Error('invalid_client_identity');
  if (!valid(client.clientId) || !valid(client.clientName)) {
    throw Error('invalid_client_identity');
  }
  if (!VALID_ROLES.has(client.role)) {
    throw Error('invalid_client_identity');
  }
  if (client.publicKey !== undefined && !valid(client.publicKey)) {
    throw Error('invalid_client_identity');
  }
}

export function verifyDiscoveredCandidate(
  candidate: DiscoveredHub,
  authenticatedHub: HubIdentity,
  options?: { expectedHomeId?: string },
): void {
  validateHubIdentity(authenticatedHub);

  if (candidate.source === 'discovery') {
    if (candidate.hubId && candidate.hubId !== authenticatedHub.hubId) {
      throw Error('spoofed_hub');
    }
    if (
      candidate.fingerprint &&
      authenticatedHub.fingerprint &&
      candidate.fingerprint !== authenticatedHub.fingerprint
    ) {
      throw Error('spoofed_hub');
    }
    if (candidate.homeId && candidate.homeId !== authenticatedHub.homeId) {
      throw Error('wrong_home');
    }
  }

  if (options?.expectedHomeId && authenticatedHub.homeId !== options.expectedHomeId) {
    throw Error('wrong_home');
  }
}

export function validatePairingGrant(
  grant: PairingGrant,
  options: { expectedHubId: string; expectedHomeId?: string; now?: number },
): void {
  if (!grant || typeof grant !== 'object') throw Error('invalid_pairing_grant');
  if (
    !valid(grant.grantId) ||
    !valid(grant.hubId) ||
    !valid(grant.homeId) ||
    !valid(grant.clientId)
  ) {
    throw Error('invalid_pairing_grant');
  }
  if (!VALID_ROLES.has(grant.clientRole)) {
    throw Error('invalid_pairing_grant');
  }

  if (grant.hubId !== options.expectedHubId) {
    throw Error('spoofed_hub');
  }
  if (options.expectedHomeId && grant.homeId !== options.expectedHomeId) {
    throw Error('wrong_home');
  }
  if (grant.revoked) {
    throw Error('grant_revoked');
  }
  const now = options.now ?? Date.now();
  if (grant.expiresAt !== undefined && now >= grant.expiresAt) {
    throw Error('grant_expired');
  }
}

export class HubPairing {
  private readonly sessions = new Map<string, PairingSessionRecord>();
  private readonly grants = new Map<string, PairingGrant>();
  private sessionCounter = 0;
  private grantCounter = 0;

  createSession(params: {
    hub: HubIdentity;
    challengeCode: string;
    ttlMs?: number;
    now?: number;
  }): PairingOffer {
    validateHubIdentity(params.hub);
    const code = params.challengeCode?.trim() ?? '';
    if (!code || code.length < 4 || code.length > 64) {
      throw Error('invalid_pairing_code');
    }

    const now = params.now ?? Date.now();
    const ttlMs = params.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000) {
      throw Error('invalid_pairing_code');
    }

    this.sessionCounter += 1;
    const sessionId = `pair-sess-${this.sessionCounter}-${now}`;
    const expiresAt = now + ttlMs;

    const session: PairingSessionRecord = {
      sessionId,
      hub: { ...params.hub },
      challengeCode: code,
      createdAt: now,
      expiresAt,
      state: 'initiated',
    };

    this.sessions.set(sessionId, session);

    return {
      sessionId,
      hub: { ...params.hub },
      expiresAt,
      state: 'initiated',
    };
  }

  confirmClient(params: {
    sessionId: string;
    client: ClientIdentity;
    challengeCode: string;
    expectedHomeId?: string;
    now?: number;
  }): PairingGrant {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw Error('pairing_rejected');
    }

    if (session.state === 'cancelled') {
      throw Error('pairing_cancelled');
    }
    if (session.state === 'expired') {
      throw Error('pairing_expired');
    }
    if (session.state !== 'initiated' && session.state !== 'confirming') {
      throw Error('pairing_rejected');
    }

    const now = params.now ?? Date.now();
    if (now >= session.expiresAt) {
      this.sessions.set(params.sessionId, { ...session, state: 'expired' });
      throw Error('pairing_expired');
    }

    validateClientIdentity(params.client);

    // Wrong home check
    if (params.expectedHomeId && session.hub.homeId !== params.expectedHomeId) {
      this.sessions.set(params.sessionId, { ...session, state: 'rejected' });
      throw Error('wrong_home');
    }

    // Code confirmation
    const submitted = params.challengeCode?.trim() ?? '';
    if (!timingSafeStringEqual(submitted, session.challengeCode)) {
      this.sessions.set(params.sessionId, { ...session, state: 'rejected' });
      throw Error('invalid_pairing_code');
    }

    this.grantCounter += 1;
    const grantId = `pair-grant-${this.grantCounter}-${now}`;
    const grant: PairingGrant = {
      grantId,
      hubId: session.hub.hubId,
      homeId: session.hub.homeId,
      clientId: params.client.clientId,
      clientRole: params.client.role,
      clientName: params.client.clientName,
      issuedAt: now,
      revoked: false,
    };

    this.sessions.set(params.sessionId, {
      ...session,
      client: { ...params.client },
      state: 'paired',
    });
    this.grants.set(grantId, grant);

    return { ...grant };
  }

  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, state: 'cancelled' });
    }
  }

  revokeGrant(grantId: string): void {
    const grant = this.grants.get(grantId);
    if (grant) {
      this.grants.set(grantId, { ...grant, revoked: true });
    }
  }

  assertGrant(
    grantId: string,
    options?: { expectedHubId?: string; expectedHomeId?: string; now?: number },
  ): PairingGrant {
    const grant = this.grants.get(grantId);
    if (!grant) {
      throw Error('grant_revoked');
    }
    validatePairingGrant(grant, {
      expectedHubId: options?.expectedHubId ?? grant.hubId,
      expectedHomeId: options?.expectedHomeId,
      now: options?.now,
    });
    return { ...grant };
  }

  getSession(sessionId: string): PairingSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : undefined;
  }
}
