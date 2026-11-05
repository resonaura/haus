/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Command, HomeEvent, HomeSnapshot } from '../types.js';
import type { IdentityRegistry } from '../identity/registry.js';
import type { CommandStatus } from '../command/types.js';
import type { RefreshResult, SessionGrant } from '../session/types.js';

/** The adapter validates its encoding and returns an independent decoded credential. */
export interface CredentialCodec<Credential> {
  encode(credential: Credential): Uint8Array;
  decode(bytes: Uint8Array): Credential;
}

export interface ProviderReply {
  readonly status: CommandStatus;
  readonly correlationId?: string;
}

/** Read/event surface only; physical actions stay behind authorized command routing. */
export interface ProviderInventory {
  readonly id: string;
  snapshot(signal?: AbortSignal): Promise<HomeSnapshot>;
  subscribe(listener: (event: HomeEvent) => void): () => void;
}

export interface ProviderContext<Credential> {
  readonly grant: SessionGrant;
  readonly identities: IdentityRegistry;
  credential(): Promise<Credential>;
  refresh(): Promise<void>;
}

/** Construction performs no I/O; refresh is invoked only by the owning refresh service. */
export interface Provider<Credential> {
  readonly inventory?: ProviderInventory;
  open(credential: Credential, signal: AbortSignal): Promise<void>;
  execute(command: Command, credential: Credential, signal: AbortSignal): Promise<ProviderReply>;
  refresh(credential: Credential, signal: AbortSignal): Promise<RefreshResult<Credential>>;
  /** Idempotent: prevent delayed admissions, close transports and drain provider work. */
  close(): Promise<void>;
}
