/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { TerminalTarget } from '@haus/core/protocol';
import type { TerminalCryptoSession } from '../crypto.js';

const MAX_PENDING_TICKETS = 48;
const TICKET_RATE_WINDOW_MS = 60_000;
const TICKET_RATE_LIMIT = 30;

export class TerminalRateLimitError extends Error {
  readonly code = 'terminal_rate_limited';

  constructor() {
    super('terminal_rate_limited');
  }
}

export interface PendingLocalTicket {
  readonly kind: 'local';
  readonly ticketId: string;
  readonly actorId: string;
  readonly adminSessionId?: string;
  readonly authorizedPeerHubId?: string;
  readonly cols: number;
  readonly rows: number;
  readonly target: TerminalTarget;
  readonly expiresAt: number;
  readonly crypto: TerminalCryptoSession;
}

export interface PendingRelayTicket {
  readonly kind: 'relay';
  readonly ticketId: string;
  readonly adminSessionId: string;
  readonly peerHubId: string;
  readonly peerUrl: string;
  readonly peerChannelSecret?: string;
  readonly expiresAt: number;
}

export type PendingTerminalTicket = PendingLocalTicket | PendingRelayTicket;

/** Bounded, rate-limited single-use ticket registry with automatic key zeroization on expiry. */
export class TerminalTicketStore {
  private readonly pending = new Map<string, PendingTerminalTicket>();
  private readonly rateBuckets = new Map<string, number[]>();

  prune(now = Date.now()): void {
    for (const [id, ticket] of this.pending) {
      if (ticket.expiresAt <= now) {
        if (ticket.kind === 'local') ticket.crypto.destroy();
        this.pending.delete(id);
      }
    }
  }

  assertRateLimit(bucketKey: string, now = Date.now()): void {
    this.prune(now);
    if (this.pending.size >= MAX_PENDING_TICKETS) {
      throw new TerminalRateLimitError();
    }
    const recent = (this.rateBuckets.get(bucketKey) ?? []).filter(
      (ts) => now - ts < TICKET_RATE_WINDOW_MS,
    );
    if (recent.length >= TICKET_RATE_LIMIT) {
      this.rateBuckets.set(bucketKey, recent);
      throw new TerminalRateLimitError();
    }
    recent.push(now);
    this.rateBuckets.set(bucketKey, recent);
  }

  set(ticket: PendingTerminalTicket): void {
    this.pending.set(ticket.ticketId, ticket);
  }

  /** Atomically removes and returns the ticket on first presentation (prevents replay). */
  consume(ticketId: string, now = Date.now()): PendingTerminalTicket | undefined {
    this.prune(now);
    const ticket = this.pending.get(ticketId);
    if (!ticket) return undefined;
    this.pending.delete(ticketId);
    return ticket;
  }

  clear(): void {
    for (const ticket of this.pending.values()) {
      if (ticket.kind === 'local') ticket.crypto.destroy();
    }
    this.pending.clear();
  }
}
