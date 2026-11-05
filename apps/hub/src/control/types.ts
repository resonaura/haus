/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Command } from '@haus/core/types';
import type { IntegrationRef, SessionOwner, SessionRecord } from '@haus/core/session';
import type { CredentialCodec, Provider, ProviderContext } from '@haus/core/provider';
export type { Provider as IntegrationProvider, ProviderReply } from '@haus/core/provider';

export interface IntegrationDefinition<Credential> {
  readonly resource: IntegrationRef;
  readonly codec: CredentialCodec<Credential>;
  create(context: ProviderContext<Credential>): Provider<Credential>;
}

export type ControlAction = 'connect' | 'reauthorize' | 'disconnect' | 'recover' | 'control';
export interface ControlPermissions {
  authorize(
    actorId: string,
    resource: IntegrationRef,
    action: ControlAction,
    command?: Command,
    signal?: AbortSignal,
  ): Promise<boolean>;
}

/** Trusted host/provider proof, never supplied by an HTTP client or inferred from a lost heartbeat. */
export interface LocalRecovery {
  fence(previous: SessionRecord, current: SessionOwner): Promise<void>;
}

export const CONTROL_SERVICE = 'CONTROL_SERVICE';

