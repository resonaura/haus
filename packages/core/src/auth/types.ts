/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { ClientRole } from '../pairing/types.js';

export type SessionState = 'active' | 'expired' | 'revoked' | 'reauth-required';

export interface ClientSession {
  readonly sessionId: string;
  readonly hubId: string;
  readonly homeId: string;
  readonly clientId: string;
  readonly clientRole: ClientRole;
  readonly clientName: string;
  readonly token: string;
  readonly refreshToken?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revoked: boolean;
}

export interface ClientSessionView {
  readonly sessionId: string;
  readonly hubId: string;
  readonly homeId: string;
  readonly clientId: string;
  readonly clientRole: ClientRole;
  readonly clientName: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly state: 'active' | 'expired' | 'revoked';
}

export interface ClientSessionCredentials {
  readonly hubUrl: string;
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly refreshToken?: string;
  readonly hubId: string;
  readonly homeId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly clientRole: ClientRole;
  readonly expiresAt: number;
}

export type AuthErrorCode =
  | 'authentication_required'
  | 'invalid_credentials'
  | 'invalid_session'
  | 'session_expired'
  | 'session_revoked'
  | 'reauth_required'
  | 'invalid_pairing_grant'
  | 'grant_expired'
  | 'grant_revoked'
  | 'invalid_request_payload';

export interface SessionResumeResult {
  readonly status: 'active' | 'expired' | 'revoked' | 'reauth-required';
  readonly session?: ClientSessionView;
  readonly error?: AuthErrorCode;
}

export interface SessionRefreshResult {
  readonly status: 'renewed' | 'reauth-required';
  readonly credentials?: ClientSessionCredentials;
  readonly error?: AuthErrorCode;
}

export type TokenGenerator = () => string;
