/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Command } from '../types.js';
import type { IntegrationRef, SessionGrant } from '../session/types.js';

export type CommandStatus = 'accepted' | 'confirmed' | 'failed' | 'unknown';
export type CommandReason =
  | 'dispatch-pending'
  | 'provider-rejected'
  | 'transport-lost'
  | 'owner-changed'
  | 'permission-denied'
  | 'timeout'
  | 'journal-unavailable';

export interface CommandScope {
  readonly homeId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

export interface CommandOutcome {
  readonly schema: 'haus.receipt';
  readonly version: 1;
  readonly commandId: string;
  readonly correlationId: string;
  readonly ownerGeneration: number;
  readonly status: CommandStatus;
  readonly reason?: CommandReason;
}

export interface CommandEntry {
  readonly scope: CommandScope;
  /** Keyed digest of the action semantics; must not contain the raw arguments. */
  readonly fingerprint: string;
  readonly outcome: CommandOutcome;
}

export interface CommandJournal {
  /** Atomically reserve once; return the original entry for every replay, even after restart. */
  reserve(
    entry: CommandEntry,
  ): Promise<{ readonly created: boolean; readonly entry: CommandEntry }>;
  /** Compare scope, fingerprint, command ID and generation; never overwrite another attempt. */
  settle(entry: CommandEntry): Promise<CommandOutcome>;
}

export interface CommandRequest {
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly grant: SessionGrant;
  readonly command: Command;
}

export interface CommandProvider {
  readonly resource: IntegrationRef;
  execute(
    command: Command,
    signal: AbortSignal,
  ): Promise<{
    status: CommandStatus;
    correlationId?: string;
  }>;
}

export interface CommandPolicy {
  authorize(actorId: string, command: Command): Promise<boolean>;
  /** Host adapter supplies a stable keyed digest over all fields except request/correlation ID. */
  fingerprint(intent: Omit<Command, 'id'>): Promise<string>;
}
