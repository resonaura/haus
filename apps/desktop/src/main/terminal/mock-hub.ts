/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import {
  TERMINAL_IPC_UPGRADE,
  TERMINAL_PROOF_HEADER,
  TERMINAL_TICKET_HEADER,
  validateTerminalTicketRequest,
  type TerminalClientFrame,
  type TerminalServerFrame,
} from '@haus/core/protocol';
import {
  createServerTerminalHandshake,
  signingKeyFingerprintHex,
  type TerminalCryptoSession,
  type TerminalSigningIdentity,
} from '@haus/ipc/crypto';
import { IPC_UPGRADE_ACCEPT_BUFFER, RawIpcFrameReader } from '@haus/ipc/transport';

export interface MockHubIdentity extends TerminalSigningIdentity {
  readonly homeId: string;
  readonly privateKey: KeyObject;
  readonly fingerprintHex: string;
}

export function makeHubIdentity(hubId = 'hub-test-01', homeId = 'home-test-01'): MockHubIdentity {
  const pair = generateKeyPairSync('ed25519');
  const signingPublicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();
  return {
    hubId,
    homeId,
    signingPublicKey,
    privateKey: pair.privateKey,
    fingerprintHex: signingKeyFingerprintHex(signingPublicKey),
    signPayload: (payload) => edSign(null, payload, pair.privateKey).toString('base64url'),
  };
}

export interface PendingMockTicket {
  readonly ticketId: string;
  readonly crypto: TerminalCryptoSession;
}

export function sealServer(ticket: PendingMockTicket, frame: TerminalServerFrame): Buffer {
  return ticket.crypto.sealServer(frame);
}

export async function startMockHub(
  closers: Array<() => Promise<void>>,
  options?: {
    identity?: MockHubIdentity;
    tamperSignature?: boolean;
    onSocket?: (socket: Duplex, ticket: PendingMockTicket) => void;
  },
) {
  let identity = options?.identity ?? makeHubIdentity();
  const tickets = new Map<string, PendingMockTicket>();
  const openSockets = new Set<Duplex>();
  const receivedFrames: TerminalClientFrame[] = [];
  let upgrades = 0;

  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/servers/terminal/ticket') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const parsed = validateTerminalTicketRequest(
          JSON.parse(Buffer.concat(chunks).toString('utf8')),
        );
        const hs = createServerTerminalHandshake({
          identity,
          homeId: identity.homeId,
          request: parsed,
          relayed: true,
        });
        let signature = hs.response.signature;
        if (options?.tamperSignature) {
          const rawSig = Buffer.from(signature, 'base64url');
          rawSig[0] ^= 0xff;
          signature = rawSig.toString('base64url');
        }
        tickets.set(hs.response.ticketId, {
          ticketId: hs.response.ticketId,
          crypto: hs.crypto,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ...hs.response, signature }));
      });
      return;
    }
    res.writeHead(404).end();
  });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    upgrades += 1;
    openSockets.add(socket);
    socket.once('close', () => openSockets.delete(socket));
    const ticketId = String(req.headers[TERMINAL_TICKET_HEADER] ?? '');
    const proof = String(req.headers[TERMINAL_PROOF_HEADER] ?? '');
    const pending = tickets.get(ticketId);
    tickets.delete(ticketId);
    if (
      !pending ||
      req.headers.origin !== undefined ||
      req.headers.upgrade?.toLowerCase() !== TERMINAL_IPC_UPGRADE ||
      req.headers['x-haus-client'] !== '1' ||
      !pending.crypto.verifyClientProof(proof)
    ) {
      pending?.crypto.destroy();
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    if (options?.onSocket) {
      socket.write(IPC_UPGRADE_ACCEPT_BUFFER);
      options.onSocket(socket, pending);
      return;
    }
    const readyWire = sealServer(pending, {
      t: 'ready',
      cols: 80,
      rows: 24,
      scope: 'container',
      hostname: 'miku-hub',
      shell: 'bash',
    });
    socket.write(Buffer.concat([IPC_UPGRADE_ACCEPT_BUFFER, readyWire]));
    const reader = new RawIpcFrameReader();
    const onEnvelope = (env: Buffer) => {
      const msg = pending.crypto.openClient(env);
      receivedFrames.push(msg);
      if (msg.t === 'data') {
        const text = Buffer.from(msg.d).toString('utf8');
        const payload = Buffer.from(`echo:${text}`, 'utf8');
        socket.write(sealServer(pending, { t: 'data', d: payload }));
        if (text.includes('bye')) {
          socket.write(sealServer(pending, { t: 'exit', code: 0, signal: null }));
        }
      }
    };
    socket.on('data', (chunk: Buffer) => reader.push(chunk, onEnvelope));
    if (head.length > 0) reader.push(head, onEnvelope);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  closers.push(async () => {
    for (const sock of openSockets) sock.destroy();
    openSockets.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    receivedFrames,
    getUpgrades: () => upgrades,
    setIdentity: (next: MockHubIdentity) => {
      identity = next;
    },
  };
}
