/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import type { PairingGrant } from '../src/pairing/types.js';
import {
  isSessionExpired,
  issueSessionFromGrant,
  refreshClientSession,
  revokeClientSession,
  sanitizeSessionForRenderer,
  toSessionView,
  validateSessionCredentials,
  verifySessionToken,
} from '../src/auth/index.js';

describe('Hub Client Auth & Session contracts', () => {
  const baseGrant: PairingGrant = {
    grantId: 'grant-001',
    hubId: 'hub-main-1',
    homeId: 'home-oak-42',
    clientId: 'client-mac-app',
    clientRole: 'admin',
    clientName: 'Living Room Desktop',
    issuedAt: 1_000_000,
    expiresAt: 2_000_000,
    revoked: false,
  };

  const hubUrl = 'http://192.168.1.50:8443';

  it('issues a valid client session and credentials from a pairing grant', () => {
    let counter = 1;
    const tokenGen = () => `token-${counter++}`;

    const { session, credentials } = issueSessionFromGrant(baseGrant, hubUrl, {
      now: 1_000_000,
      ttlMs: 500_000,
      tokenGenerator: tokenGen,
    });

    expect(session.sessionId).toBe('token-1');
    expect(session.token).toBe('token-2');
    expect(session.refreshToken).toBe('token-3');
    expect(session.hubId).toBe('hub-main-1');
    expect(session.homeId).toBe('home-oak-42');
    expect(session.clientId).toBe('client-mac-app');
    expect(session.clientRole).toBe('admin');
    expect(session.clientName).toBe('Living Room Desktop');
    expect(session.issuedAt).toBe(1_000_000);
    expect(session.expiresAt).toBe(1_500_000);
    expect(session.revoked).toBe(false);

    expect(credentials.hubUrl).toBe(hubUrl);
    expect(credentials.sessionId).toBe('token-1');
    expect(credentials.sessionToken).toBe('token-2');
    expect(credentials.refreshToken).toBe('token-3');
    expect(credentials.expiresAt).toBe(1_500_000);
  });

  it('rejects revoked or expired pairing grants when issuing a session', () => {
    const revokedGrant: PairingGrant = { ...baseGrant, revoked: true };
    expect(() => issueSessionFromGrant(revokedGrant, hubUrl)).toThrow('grant_revoked');

    const expiredGrant: PairingGrant = { ...baseGrant, expiresAt: 100_000 };
    expect(() => issueSessionFromGrant(expiredGrant, hubUrl, { now: 200_000 })).toThrow(
      'grant_expired',
    );
  });

  it('sanitizes session for renderer and UI without leaking secret tokens', () => {
    const { session, credentials } = issueSessionFromGrant(baseGrant, hubUrl, {
      now: 1_000_000,
      ttlMs: 500_000,
    });

    const viewFromSession = toSessionView(session, 1_100_000);
    expect(viewFromSession.state).toBe('active');
    expect(viewFromSession.sessionId).toBe(session.sessionId);
    expect(viewFromSession.hubId).toBe('hub-main-1');
    expect('token' in viewFromSession).toBe(false);
    expect('refreshToken' in viewFromSession).toBe(false);

    const viewFromCredentials = sanitizeSessionForRenderer(credentials, 1_100_000);
    expect(viewFromCredentials.state).toBe('active');
    expect(viewFromCredentials.sessionId).toBe(session.sessionId);
    expect('sessionToken' in viewFromCredentials).toBe(false);
    expect('refreshToken' in viewFromCredentials).toBe(false);
    expect('hubUrl' in viewFromCredentials).toBe(false);

    // Expired view
    const expiredView = toSessionView(session, 2_000_000);
    expect(expiredView.state).toBe('expired');

    // Revoked view
    const revokedSession = revokeClientSession(session);
    const revokedView = toSessionView(revokedSession, 1_100_000);
    expect(revokedView.state).toBe('revoked');
  });

  it('verifies session token correctly and identifies expired or revoked sessions', () => {
    const { session } = issueSessionFromGrant(baseGrant, hubUrl, {
      now: 1_000_000,
      ttlMs: 500_000,
    });

    expect(verifySessionToken(session, session.token, 1_200_000)).toBe('valid');
    expect(verifySessionToken(session, 'wrong-token', 1_200_000)).toBe('invalid_token');
    expect(verifySessionToken(session, session.token, 1_600_000)).toBe('expired');

    const revoked = revokeClientSession(session);
    expect(verifySessionToken(revoked, session.token, 1_200_000)).toBe('revoked');
  });

  it('rotates tokens on session refresh and preserves identity while extending expiry', () => {
    let issueCounter = 1;
    let refreshCounter = 1;
    const issueTokenGen = () => `init-${issueCounter++}`;
    const refreshTokenGen = () => `rot-${refreshCounter++}`;

    const { session } = issueSessionFromGrant(baseGrant, hubUrl, {
      now: 1_000_000,
      ttlMs: 500_000,
      tokenGenerator: issueTokenGen,
    });

    const oldRefreshToken = session.refreshToken!;
    const { session: refreshedSession, credentials: refreshedCreds } = refreshClientSession(
      session,
      oldRefreshToken,
      {
        now: 1_400_000,
        ttlMs: 500_000,
        tokenGenerator: refreshTokenGen,
      },
    );

    expect(refreshedSession.sessionId).toBe(session.sessionId);
    expect(refreshedSession.token).toBe('rot-1');
    expect(refreshedSession.refreshToken).toBe('rot-2');
    expect(refreshedSession.expiresAt).toBe(1_900_000);
    expect(refreshedCreds.sessionToken).toBe('rot-1');
    expect(refreshedCreds.refreshToken).toBe('rot-2');

    // Attempting refresh with wrong token fails
    expect(() =>
      refreshClientSession(refreshedSession, 'wrong-refresh-token', { now: 1_500_000 }),
    ).toThrow('invalid_credentials');

    // Attempting refresh on revoked session fails
    const revoked = revokeClientSession(refreshedSession);
    expect(() =>
      refreshClientSession(revoked, refreshedSession.refreshToken!, { now: 1_500_000 }),
    ).toThrow('session_revoked');
  });

  it('validates session credentials structure and rejects tampered or incomplete payloads', () => {
    const valid = {
      hubUrl: 'http://hub.local:8443',
      sessionId: 'sess-123',
      sessionToken: 'tok-abc',
      refreshToken: 'ref-xyz',
      hubId: 'hub-1',
      homeId: 'home-1',
      clientId: 'client-1',
      clientName: 'iPhone',
      clientRole: 'admin',
      expiresAt: 5_000_000,
    };

    expect(validateSessionCredentials(valid)).toEqual(valid);

    // Missing required field
    expect(validateSessionCredentials({ ...valid, sessionToken: '' })).toBeNull();
    // Invalid role
    expect(validateSessionCredentials({ ...valid, clientRole: 'superadmin' })).toBeNull();
    // Non-numeric expiresAt
    expect(validateSessionCredentials({ ...valid, expiresAt: NaN })).toBeNull();
    // Null / non-object
    expect(validateSessionCredentials(null)).toBeNull();
    expect(validateSessionCredentials('str')).toBeNull();
  });

  it('evaluates expiration status', () => {
    expect(isSessionExpired({ expiresAt: 100 }, 50)).toBe(false);
    expect(isSessionExpired({ expiresAt: 100 }, 100)).toBe(true);
    expect(isSessionExpired({ expiresAt: 100 }, 150)).toBe(true);
  });
});
