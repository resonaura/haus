/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IdentityRegistry } from '@haus/core/identity';
import type { Command } from '@haus/core/types';
import type { CommandStatus } from '@haus/core/command';
import type {
  IntegrationRef,
  RefreshResult,
  SessionGrant,
  SessionOwner,
  SessionRecord,
} from '@haus/core/session';
import type { CredentialCodec } from '../storage/index.js';

export interface ProviderReply {
  readonly status: CommandStatus;
  readonly correlationId?: string;
}

/** Construction performs no I/O. Open never rotates credentials outside the owned refresh service. */
export interface IntegrationProvider<Credential> {
  open(credential: Credential, signal: AbortSignal): Promise<void>;
  execute(command: Command, credential: Credential, signal: AbortSignal): Promise<ProviderReply>;
  refresh(credential: Credential, signal: AbortSignal): Promise<RefreshResult<Credential>>;
  /** Idempotent: closes transports, prevents delayed admissions, and drains provider work. */
  close(): Promise<void>;
}

export interface IntegrationDefinition<Credential> {
  readonly resource: IntegrationRef;
  readonly codec: CredentialCodec<Credential>;
  create(context: {
    readonly grant: SessionGrant;
    readonly identities: IdentityRegistry;
  }): IntegrationProvider<Credential>;
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
