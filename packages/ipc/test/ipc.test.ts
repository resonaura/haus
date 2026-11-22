/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { generateKeyPairSync, randomUUID, sign as edSign } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createHausLogger } from '@haus/core';
import {
  TERMINAL_IPC_UPGRADE,
  TERMINAL_PROOF_HEADER,
  TERMINAL_TICKET_HEADER,
  validateTerminalTicketRequest,
} from '@haus/core/protocol';
import {
  completeClientTerminalHandshake,
  createServerTerminalHandshake,
  generateClientTerminalKeypair,
  signingKeyFingerprintHex,
  type TerminalSigningIdentity,
} from '../src/crypto.js';
import { RawIpcFrameReader } from '../src/transport.js';
import {
  HausTerminalClient,
  type HausTerminalEvent,
  type TerminalKeyStorePort,
} from '../src/client.js';
import {
  startLocalTerminalSession,
  TerminalRateLimitError,
  TerminalTicketStore,
} from '../src/server/index.js';

function createTestIdentity(hubId = 'hub-ipc-unit'): TerminalSigningIdentity {
  const pair = generateKeyPairSync('ed25519');
  return {
    hubId,
    signingPublicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim(),
    signPayload: (payload) => edSign(null, payload, pair.privateKey).toString('base64url'),
  };
}

function createMemoryKeyStore(): TerminalKeyStorePort {
  const map = new Map<string, string>();
  return {
    async getPinned(homeId, targetHubId) {
      return map.get(`${homeId}\0${targetHubId}`);
    },
    async pin(homeId, targetHubId, fp) {
      map.set(`${homeId}\0${targetHubId}`, fp);
    },
  };
}

describe('@haus/ipc direct E2EE binary IPC package', () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length) {
      await closers.pop()?.();
    }
  });

  it('performs X25519/Ed25519 handshake, bidirectional AEAD framing, direction guards, tamper/replay rejection, and zeroization', () => {
    const identity = createTestIdentity('hub-crypto-01');
    const clientKeys = generateClientTerminalKeypair();
    const request = validateTerminalTicketRequest({
      targetServerId: identity.hubId,
      cols: 100,
      rows: 32,
      clientEphemeralPublicKey: clientKeys.publicKeyPem,
      clientNonce: clientKeys.clientNonce,
    });

    const server = createServerTerminalHandshake({
      identity,
      homeId: 'home-crypto-01',
      request,
    });
    expect(server.response.hubKeyFingerprint).toBe(
      signingKeyFingerprintHex(identity.signingPublicKey),
    );

    const client = completeClientTerminalHandshake({
      keypair: clientKeys,
      response: server.response,
    });

    expect(server.crypto.verifyClientProof(client.session.proof)).toBe(true);
    expect(server.crypto.verifyClientProof('A'.repeat(43))).toBe(false);

    // Direction misuse is rejected cleanly.
    expect(() => client.session.sealServer({ t: 'ping', n: 1 })).toThrow(
      'invalid_terminal_frame_direction',
    );
    expect(() => server.crypto.sealClient({ t: 'ping', n: 1 })).toThrow(
      'invalid_terminal_frame_direction',
    );

    // Bidirectional roundtrip via RawIpcFrameReader (testing fragmented & coalesced chunks).
    const cWire1 = client.session.sealClient({ t: 'data', d: Buffer.from('hello world', 'utf8') });
    const cWire2 = client.session.sealClient({ t: 'resize', cols: 120, rows: 40 });
    const combined = Buffer.concat([cWire1, cWire2]);

    const serverReader = new RawIpcFrameReader();
    const receivedClient: unknown[] = [];
    for (let i = 0; i < combined.length; i += 7) {
      serverReader.push(combined.subarray(i, i + 7), (env) => {
        receivedClient.push(server.crypto.openClient(env));
      });
    }
    expect(receivedClient).toHaveLength(2);
    expect(receivedClient[0]).toMatchObject({ t: 'data' });
    expect(
      Buffer.from((receivedClient[0] as { t: 'data'; d: Uint8Array }).d).toString('utf8'),
    ).toBe('hello world');
    expect(receivedClient[1]).toEqual({ t: 'resize', cols: 120, rows: 40 });

    // Replaying cWire1 envelope fails strict monotonic sequence check.
    expect(() => server.crypto.openClient(cWire1.subarray(4))).toThrow(
      'terminal_frame_replay_or_order_violation',
    );

    // Tampering with server ciphertext fails AEAD authentication.
    const sWire = server.crypto.sealServer({ t: 'ping', n: 99 });
    const tampered = Buffer.from(sWire.subarray(4));
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => client.session.openServer(tampered)).toThrow('terminal_frame_auth_failed');

    // Valid untouched frame still decrypts cleanly since sequence only advances on auth success.
    expect(client.session.openServer(sWire.subarray(4))).toEqual({ t: 'ping', n: 99 });

    // Invalid oversized frame length throws and resets reader.
    const badLen = Buffer.alloc(8);
    badLen.writeUInt32BE(999_999, 0);
    expect(() => serverReader.push(badLen, () => {})).toThrow('invalid_ipc_frame_length');

    // Destroyed sessions cannot encrypt or verify proofs.
    server.crypto.destroy();
    client.session.destroy();
    expect(server.crypto.verifyClientProof(client.session.proof)).toBe(false);
    expect(() => client.session.sealClient({ t: 'close' })).toThrow('terminal_crypto_destroyed');
  });

  it('enforces single-use ticket consumption, TTL expiration, and rate limits in TerminalTicketStore', () => {
    const store = new TerminalTicketStore();
    const identity = createTestIdentity('hub-tickets-01');
    const keys = generateClientTerminalKeypair();
    const request = validateTerminalTicketRequest({
      targetServerId: identity.hubId,
      cols: 80,
      rows: 24,
      clientEphemeralPublicKey: keys.publicKeyPem,
      clientNonce: keys.clientNonce,
    });
    const hs = createServerTerminalHandshake({
      identity,
      homeId: 'home-1',
      request,
      now: 1000,
      ttlMs: 5000,
    });
    store.set({
      kind: 'local',
      ticketId: hs.response.ticketId,
      actorId: 'admin-1',
      cols: 80,
      rows: 24,
      target: { kind: 'shell' },
      expiresAt: hs.response.expiresAt,
      crypto: hs.crypto,
    });

    // Consuming succeeds once and returns undefined on second attempt.
    expect(store.consume(hs.response.ticketId, 2000)?.ticketId).toBe(hs.response.ticketId);
    expect(store.consume(hs.response.ticketId, 2001)).toBeUndefined();
    hs.crypto.destroy();

    // Expired ticket is pruned and its crypto session destroyed.
    const hs2 = createServerTerminalHandshake({
      identity,
      homeId: 'home-1',
      request,
      now: 1000,
      ttlMs: 5000,
    });
    store.set({
      kind: 'local',
      ticketId: hs2.response.ticketId,
      actorId: 'admin-1',
      cols: 80,
      rows: 24,
      target: { kind: 'shell' },
      expiresAt: hs2.response.expiresAt,
      crypto: hs2.crypto,
    });
    expect(store.consume(hs2.response.ticketId, 7000)).toBeUndefined();
    expect(() => hs2.crypto.sealServer({ t: 'ping', n: 1 })).toThrow('terminal_crypto_destroyed');

    // Rate limit trips after 30 tickets in a minute.
    for (let i = 0; i < 30; i += 1) {
      store.assertRateLimit('admin:burst', 10_000 + i);
    }
    expect(() => store.assertRateLimit('admin:burst', 10_050)).toThrow(TerminalRateLimitError);
  });

  it('connects HausTerminalClient to startLocalTerminalSession standalone without NestJS or Electron', async () => {
    const identity = createTestIdentity('hub-standalone-ipc');
    const tickets = new TerminalTicketStore();
    const openSockets = new Set<Duplex>();

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
            homeId: 'home-standalone',
            request: parsed,
          });
          tickets.set({
            kind: 'local',
            ticketId: hs.response.ticketId,
            actorId: 'cli-admin',
            cols: parsed.cols,
            rows: parsed.rows,
            target: parsed.target ?? { kind: 'shell' },
            expiresAt: hs.response.expiresAt,
            crypto: hs.crypto,
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(hs.response));
        });
        return;
      }
      res.writeHead(404).end();
    });

    server.on('upgrade', (req, socket, head) => {
      openSockets.add(socket);
      socket.once('close', () => openSockets.delete(socket));
      const ticketId = String(req.headers[TERMINAL_TICKET_HEADER] ?? '');
      const proof = String(req.headers[TERMINAL_PROOF_HEADER] ?? '');
      const pending = tickets.consume(ticketId);
      if (
        !pending ||
        pending.kind !== 'local' ||
        req.headers.upgrade?.toLowerCase() !== TERMINAL_IPC_UPGRADE ||
        !pending.crypto.verifyClientProof(proof)
      ) {
        socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return;
      }
      startLocalTerminalSession({
        socket,
        head,
        ticketId: pending.ticketId,
        actorId: pending.actorId,
        target: pending.target,
        cols: pending.cols,
        rows: pending.rows,
        crypto: pending.crypto,
        checkAuthorized: async () => true,
        onClosed: () => {},
      });
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    closers.push(async () => {
      tickets.clear();
      for (const s of openSockets) s.destroy();
      openSockets.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const port = (server.address() as AddressInfo).port;
    const keyStore = createMemoryKeyStore();
    const events: HausTerminalEvent[] = [];
    const client = new HausTerminalClient(
      () => ({ url: `http://127.0.0.1:${port}`, token: 'test-token' }),
      keyStore,
      (ev) => events.push(ev),
    );

    const log = createHausLogger('IpcStandaloneTest', { level: 'info' });
    log.info('IPC_STANDALONE_HISTORY_LINE');

    const sessionId = randomUUID();
    await client.open({
      sessionId,
      serverId: identity.hubId,
      target: { kind: 'hub-logs', tail: 50 },
      cols: 80,
      rows: 24,
    });

    const deadline = Date.now() + 4_000;
    let combinedText = '';
    let connected = false;
    while (Date.now() < deadline) {
      for (const ev of events) {
        if (ev.type === 'status' && ev.state === 'connected') connected = true;
      }
      combinedText = events
        .filter((e): e is Extract<HausTerminalEvent, { type: 'data' }> => e.type === 'data')
        .map((e) => Buffer.from(e.data).toString('utf8'))
        .join('');
      if (connected && combinedText.includes('IPC_STANDALONE_HISTORY_LINE')) {
        if (!combinedText.includes('IPC_STANDALONE_LIVE_LINE')) {
          log.warn('IPC_STANDALONE_LIVE_LINE');
        } else {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(connected).toBe(true);
    expect(combinedText).toContain('IPC_STANDALONE_HISTORY_LINE');
    expect(combinedText).toContain('IPC_STANDALONE_LIVE_LINE');
    expect(await keyStore.getPinned('home-standalone', identity.hubId)).toBe(
      signingKeyFingerprintHex(identity.signingPublicKey),
    );
    client.closeAll();
  });
});
