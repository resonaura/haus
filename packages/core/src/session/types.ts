/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { ResourceRef } from '../identity/types.js';

export interface IntegrationRef extends ResourceRef {
  readonly kind: 'integration';
}

export interface SessionOwner {
  readonly hubId: string;
  /** Unique per running process, not reused after a restart. */
  readonly processId: string;
}

export type SessionState = 'connecting' | 'connected' | 'reauth-required' | 'revoking' | 'revoked';

/** Replicable metadata only; grants are fencing references, not authentication credentials. */
export interface SessionGrant {
  readonly resource: IntegrationRef;
  readonly owner: SessionOwner;
  readonly generation: number;
}

export interface SessionRecord extends SessionGrant {
  readonly state: SessionState;
}

/** Host storage serializes and durably commits transitions; failed callbacks do not commit. */
export interface SessionRepository {
  read(resource: IntegrationRef): Promise<SessionRecord | undefined>;
  update(
    resource: IntegrationRef,
    transition: (current: SessionRecord | undefined) => SessionRecord,
  ): Promise<SessionRecord>;
}

/** Local secure storage rejects reads while refresh is pending, uncertain or awaiting sign-in. */
export interface CredentialVault<Credential> {
  read(resource: IntegrationRef): Promise<Credential>;
}

export type RefreshStart<Credential> =
  | { readonly status: 'ready'; readonly credential: Credential }
  | { readonly status: 'busy' }
  | { readonly status: 'reauth-required' };

/** Secure storage persists an attempt before dispatch and checks grant/attempt on every write.
 * A pending marker survives restart and denies token reuse until explicit recovery/sign-in.
 */
export interface RefreshVault<Credential> {
  begin(grant: SessionGrant, attemptId: string): Promise<RefreshStart<Credential>>;
  complete(grant: SessionGrant, attemptId: string, credential: Credential): Promise<boolean>;
  block(grant: SessionGrant, attemptId: string): Promise<boolean>;
}

export type RefreshResult<Credential> =
  | { readonly status: 'renewed'; readonly credential: Credential }
  | { readonly status: 'reauth-required' };

export interface RefreshProvider<Credential> {
  refresh(credential: Credential, signal: AbortSignal): Promise<RefreshResult<Credential>>;
}
