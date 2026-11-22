/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  validateTerminalTicketResponse,
  type TerminalClientFrame,
  type TerminalServerFrame,
  type TerminalTicketResponse,
} from '@haus/core/protocol';
import {
  completeClientTerminalHandshake,
  generateClientTerminalKeypair,
  type TerminalCryptoSession,
} from '@haus/ipc/crypto';

/** Thin test wrapper around `@haus/ipc/crypto` for Hub direct IPC integration tests. */
export class TestTerminalClient {
  private readonly keypair = generateClientTerminalKeypair();
  readonly clientNonce = this.keypair.clientNonce;
  readonly publicKeyPem = this.keypair.publicKeyPem;

  ticket!: TerminalTicketResponse;
  proof!: string;
  private crypto!: TerminalCryptoSession;

  completeHandshake(raw: unknown): TerminalTicketResponse {
    const resp = validateTerminalTicketResponse(raw);
    const completed = completeClientTerminalHandshake({ keypair: this.keypair, response: resp });
    this.ticket = resp;
    this.crypto = completed.session;
    this.proof = completed.session.proof;
    return resp;
  }

  seal(frame: TerminalClientFrame): Buffer {
    return this.crypto.sealClient(frame);
  }

  open(envelope: Buffer): TerminalServerFrame {
    return this.crypto.openServer(envelope);
  }
}
