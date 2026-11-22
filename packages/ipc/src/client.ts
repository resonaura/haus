/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Socket } from 'node:net';
import {
  TERMINAL_MAX_INPUT_BYTES,
  TERMINAL_PROOF_HEADER,
  TERMINAL_TICKET_HEADER,
  validateTerminalDimensions,
  validateTerminalServerId,
  validateTerminalTicketResponse,
} from '@haus/core/protocol';
import {
  completeClientTerminalHandshake,
  generateClientTerminalKeypair,
  type TerminalCryptoSession,
} from './crypto.js';
import {
  terminalErrorMessage,
  type HausTerminalEvent,
  type HausTerminalOpenRequest,
  type TerminalAccessCredentials,
  type TerminalKeyStorePort,
} from './errors.js';
import { dialRawTerminalIpc, RawIpcFrameReader } from './transport.js';

export {
  terminalErrorMessage,
  type HausTerminalEvent,
  type HausTerminalOpenRequest,
  type TerminalAccessCredentials,
  type TerminalKeyStorePort,
};

const MAX_CONCURRENT_SESSIONS = 8;
const TICKET_TIMEOUT_MS = 10_000;
const IPC_HANDSHAKE_TIMEOUT_MS = 10_000;

interface ActiveHubSession {
  readonly serverId: string;
  readonly socket: Socket;
  readonly crypto: TerminalCryptoSession;
  readonly reader: RawIpcFrameReader;
  readOnly: boolean;
  closed: boolean;
}

/**
 * Reusable Node client for the Haus Direct Secure Terminal IPC protocol (`haus.terminal.v1`).
 * Runs over raw TCP/TLS `TCP_NODELAY` sockets with binary AEAD frames, Ed25519 key pinning,
 * X25519 forward secrecy, and zero WebSocket or JSON overhead on the data hot path.
 */
export class HausTerminalClient {
  private readonly sessions = new Map<string, ActiveHubSession>();
  private readonly opening = new Map<string, { cancelled: boolean }>();
  private readonly offeredKeys = new Map<string, string>();

  constructor(
    private readonly getHubAccess: () => TerminalAccessCredentials | null,
    private readonly keyStore: TerminalKeyStorePort,
    private readonly publish: (event: HausTerminalEvent) => void,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  has(id: unknown): boolean {
    return typeof id === 'string' && (this.sessions.has(id) || this.opening.has(id));
  }

  async open(request: HausTerminalOpenRequest): Promise<void> {
    if (!request || !/^[\da-f-]{36}$/i.test(request.sessionId)) {
      throw Error('Invalid terminal session.');
    }
    this.close(request.sessionId);
    if (this.sessions.size + this.opening.size >= MAX_CONCURRENT_SESSIONS) {
      throw Error('Close another terminal before opening a new connection.');
    }
    const operation = { cancelled: false };
    this.opening.set(request.sessionId, operation);
    try {
      await this.connect(request, operation);
    } finally {
      if (this.opening.get(request.sessionId) === operation) {
        this.opening.delete(request.sessionId);
      }
    }
  }

  private async connect(
    request: HausTerminalOpenRequest,
    operation: { cancelled: boolean },
  ): Promise<void> {
    const serverId = validateTerminalServerId(request.serverId);
    const { cols, rows } = validateTerminalDimensions(request.cols, request.rows);
    const access = this.getHubAccess();
    if (!access?.url || !access.token) {
      throw Error('Connect to your Haus Hub as an administrator to open this terminal.');
    }

    let origin: string;
    try {
      const parsed = new URL(access.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw Error('Unsupported Hub address.');
      }
      origin = parsed.origin;
    } catch {
      throw Error('Invalid Hub address.');
    }

    const id = request.sessionId;
    this.publish({ sessionId: id, type: 'status', state: 'connecting', transport: 'hub' });

    const keypair = generateClientTerminalKeypair();
    let rawResponse: Response;
    try {
      rawResponse = await this.fetchFn(`${origin}/api/servers/terminal/ticket`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${access.token}`,
          'x-haus-client': '1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          targetServerId: serverId,
          cols,
          rows,
          clientEphemeralPublicKey: keypair.publicKeyPem,
          clientNonce: keypair.clientNonce,
          ...(request.target ? { target: request.target } : {}),
        }),
        signal: AbortSignal.timeout(TICKET_TIMEOUT_MS),
      });
    } catch {
      throw Error('Could not reach the Haus Hub to establish a secure terminal.');
    }

    if (operation.cancelled) return;

    const rawText = await rawResponse.text();
    if (!rawResponse.ok) {
      let code = `http_${rawResponse.status}`;
      try {
        const parsed = JSON.parse(rawText) as { error?: unknown };
        if (typeof parsed.error === 'string' && parsed.error) code = parsed.error;
      } catch {
        // Keep status code.
      }
      throw Error(terminalErrorMessage(code));
    }

    let ticket;
    try {
      ticket = validateTerminalTicketResponse(JSON.parse(rawText) as unknown);
    } catch {
      throw Error('The Hub returned an invalid terminal handshake.');
    }

    const { session: crypto, displayFingerprint } = completeClientTerminalHandshake({
      keypair,
      response: ticket,
    });

    if (operation.cancelled) {
      crypto.destroy();
      return;
    }

    const pinned = await this.keyStore.getPinned(ticket.homeId, ticket.targetHubId);
    const offerKey = `${ticket.homeId}\0${ticket.targetHubId}`;
    if (pinned && pinned !== ticket.hubKeyFingerprint) {
      const previouslyOffered = this.offeredKeys.get(offerKey);
      if (
        !request.trustFingerprint ||
        request.trustFingerprint !== previouslyOffered ||
        request.trustFingerprint !== displayFingerprint
      ) {
        crypto.destroy();
        this.offeredKeys.set(offerKey, displayFingerprint);
        this.publish({
          sessionId: id,
          type: 'host-key',
          fingerprint: displayFingerprint,
          changed: true,
        });
        return;
      }
    }

    if (operation.cancelled) {
      crypto.destroy();
      return;
    }

    let socket: Socket;
    let head: Buffer;
    try {
      const dialed = await dialRawTerminalIpc({
        origin,
        path: '/api/servers/terminal',
        headers: {
          Authorization: `Bearer ${access.token}`,
          'x-haus-client': '1',
          [TERMINAL_TICKET_HEADER]: ticket.ticketId,
          [TERMINAL_PROOF_HEADER]: crypto.proof,
        },
        timeoutMs: IPC_HANDSHAKE_TIMEOUT_MS,
      });
      socket = dialed.socket;
      head = dialed.head;
    } catch {
      crypto.destroy();
      throw Error('Could not open the secure Hub terminal connection.');
    }

    if (operation.cancelled) {
      socket.destroy();
      crypto.destroy();
      return;
    }

    const reader = new RawIpcFrameReader();
    const state: ActiveHubSession = {
      serverId,
      socket,
      crypto,
      reader,
      readOnly: false,
      closed: false,
    };
    this.sessions.set(id, state);
    let readyReceived = false;

    const closeCurrent = (message?: string) => {
      if (state.closed) return;
      state.closed = true;
      if (this.sessions.get(id) === state) this.sessions.delete(id);
      reader.reset();
      crypto.destroy();
      try {
        if (!socket.destroyed) socket.destroy();
      } catch {
        // Ignore already-destroyed socket.
      }
      this.publish({
        sessionId: id,
        type: 'status',
        state: 'disconnected',
        transport: 'hub',
        ...(message ? { message } : {}),
      });
    };

    const handleEnvelope = (envelope: Buffer) => {
      if (state.closed) return;
      let msg;
      try {
        msg = crypto.openServer(envelope);
      } catch {
        closeCurrent('The secure terminal channel failed integrity verification.');
        return;
      }
      if (msg.t === 'ready') {
        if (readyReceived) {
          closeCurrent('The secure terminal channel received an unexpected handshake frame.');
          return;
        }
        readyReceived = true;
        state.readOnly = msg.readOnly === true;
        this.offeredKeys.delete(offerKey);
        void this.keyStore
          .pin(ticket.homeId, ticket.targetHubId, ticket.hubKeyFingerprint)
          .catch(() => {});
        this.publish({
          sessionId: id,
          type: 'status',
          state: 'connected',
          transport: 'hub',
          scope: msg.scope,
          hostname: msg.hostname,
          shell: msg.shell,
          relayed: ticket.relayed,
          readOnly: state.readOnly,
        });
      } else if (msg.t === 'data') {
        this.publish({
          sessionId: id,
          type: 'data',
          data: msg.d,
          bytes: msg.d.byteLength,
        });
      } else if (msg.t === 'ping') {
        if (!socket.destroyed && socket.writable) {
          try {
            socket.write(crypto.sealClient({ t: 'pong', n: msg.n }));
          } catch {
            // Ignore write race during close.
          }
        }
      } else if (msg.t === 'exit') {
        this.publish({ sessionId: id, type: 'exit', code: msg.code });
        closeCurrent();
      } else if (msg.t === 'error') {
        closeCurrent(terminalErrorMessage(msg.code));
      }
    };

    const onSocketData = (chunk: Buffer) => {
      if (state.closed) return;
      try {
        reader.push(chunk, handleEnvelope);
      } catch {
        closeCurrent('The secure terminal channel received an invalid encrypted frame.');
      }
    };

    socket.on('data', onSocketData);
    socket.once('error', () => {
      closeCurrent(
        readyReceived
          ? 'The secure Hub terminal connection was interrupted.'
          : 'Could not open the secure Hub terminal connection.',
      );
    });
    socket.once('close', () => closeCurrent());
    socket.once('end', () => closeCurrent());

    if (head.length > 0) {
      onSocketData(head);
    }
  }

  /** Zero-RTT fire-and-forget synchronous input write directly onto the TCP_NODELAY socket. */
  writeFast(id: unknown, data: unknown): void {
    if (typeof id !== 'string' || typeof data !== 'string' || data.length === 0) return;
    const bytes = Buffer.from(data, 'utf8');
    if (bytes.byteLength === 0 || bytes.byteLength > TERMINAL_MAX_INPUT_BYTES) return;
    const session = this.sessions.get(id);
    if (
      !session ||
      session.closed ||
      session.readOnly ||
      session.socket.destroyed ||
      !session.socket.writable
    ) {
      return;
    }
    try {
      session.socket.write(session.crypto.sealClient({ t: 'data', d: bytes }));
    } catch {
      // Socket close listener handles disconnect notification.
    }
  }

  async write(id: unknown, data: unknown): Promise<void> {
    if (typeof id !== 'string' || typeof data !== 'string' || data.length === 0) {
      throw Error('Invalid terminal input.');
    }
    const bytes = Buffer.from(data, 'utf8');
    if (bytes.byteLength === 0 || bytes.byteLength > TERMINAL_MAX_INPUT_BYTES) {
      throw Error('Invalid terminal input.');
    }
    const session = this.sessions.get(id);
    if (
      !session ||
      session.closed ||
      session.readOnly ||
      session.socket.destroyed ||
      !session.socket.writable
    ) {
      throw Error('The terminal is disconnected.');
    }
    const encrypted = session.crypto.sealClient({ t: 'data', d: bytes });
    await new Promise<void>((resolve, reject) => {
      session.socket.write(encrypted, (error) =>
        error ? reject(Error('Terminal input could not be delivered.')) : resolve(),
      );
    });
  }

  resize(id: unknown, cols: unknown, rows: unknown): void {
    const size = validateTerminalDimensions(cols, rows);
    if (typeof id !== 'string') throw Error('Invalid terminal session.');
    const session = this.sessions.get(id);
    if (
      !session ||
      session.closed ||
      session.readOnly ||
      session.socket.destroyed ||
      !session.socket.writable
    ) {
      return;
    }
    try {
      session.socket.write(
        session.crypto.sealClient({ t: 'resize', cols: size.cols, rows: size.rows }),
      );
    } catch {
      // Ignore write races during close.
    }
  }

  ack(id: unknown, bytes: unknown): void {
    if (
      typeof id !== 'string' ||
      !Number.isSafeInteger(bytes) ||
      Number(bytes) < 0 ||
      Number(bytes) > 2 * 1024 * 1024
    ) {
      return;
    }
    const session = this.sessions.get(id);
    if (!session || session.closed || session.socket.destroyed || !session.socket.writable) return;
    try {
      session.socket.write(session.crypto.sealClient({ t: 'ack', bytes: Number(bytes) }));
    } catch {
      // Ignore write races during close.
    }
  }

  close(id: unknown): void {
    if (typeof id !== 'string') return;
    const opening = this.opening.get(id);
    if (opening) {
      opening.cancelled = true;
      this.opening.delete(id);
    }
    const state = this.sessions.get(id);
    if (!state) return;
    state.closed = true;
    this.sessions.delete(id);
    state.reader.reset();
    try {
      if (!state.socket.destroyed && state.socket.writable) {
        state.socket.end(state.crypto.sealClient({ t: 'close' }));
      } else if (!state.socket.destroyed) {
        state.socket.destroy();
      }
    } catch {
      // Ignore already-destroyed socket.
    }
    state.crypto.destroy();
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys(), ...this.opening.keys()]) {
      this.close(id);
    }
    this.offeredKeys.clear();
  }
}
