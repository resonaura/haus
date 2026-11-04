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
  read(resource: IntegrationRef): SessionRecord | undefined;
  update(
    resource: IntegrationRef,
    transition: (current: SessionRecord | undefined) => SessionRecord,
  ): SessionRecord;
}

/** Each Hub's secure store serves only its own integration credentials. */
export interface CredentialVault<Credential> {
  read(resource: IntegrationRef): Promise<Credential>;
}
