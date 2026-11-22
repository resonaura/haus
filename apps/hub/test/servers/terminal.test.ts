/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { connect as tcpConnect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TERMINAL_PROOF_HEADER,
  TERMINAL_TICKET_HEADER,
  type TerminalServerFrame,
} from '@haus/core/protocol';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { dialRawTerminalIpc, RawIpcFrameReader, RawIpcUpgradeError } from '@haus/ipc/transport';
import { TestTerminalClient } from './terminal-client.js';

async function pairClient(
  baseUrl: string,
  auth: HubAuthService,
  role: 'admin' | 'member',
  clientId: string,
  adminToken?: string,
): Promise<string> {
  const challengeRes = await fetch(`${baseUrl}/api/auth/challenge`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
    },
    body: JSON.stringify({}),
  });
  const challenge = (await challengeRes.json()) as { sessionId: string };
  const code = auth.pairing.getSession(challenge.sessionId)!.challengeCode;
  const confirmRes = await fetch(`${baseUrl}/api/auth/confirm`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
    },
    body: JSON.stringify({
      sessionId: challenge.sessionId,
      challengeCode: code,
      client: { clientId, clientName: clientId, role },
    }),
  });
  const confirmed = (await confirmRes.json()) as { grant: Record<string, unknown> };
  const pairRes = await fetch(`${baseUrl}/api/auth/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant: confirmed.grant }),
  });
  const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
  return paired.credentials.sessionToken;
}

async function rawUpgradeStatus(
  port: number,
  upgradeHeader: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect({ host: '127.0.0.1', port, noDelay: true });
    let data = '';
    socket.on('connect', () => {
      const lines = [
        'GET /api/servers/terminal HTTP/1.1',
        `Host: 127.0.0.1:${port}`,
        'Connection: Upgrade',
        `Upgrade: ${upgradeHeader}`,
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      ];
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    socket.on('data', (chunk: Buffer) => {
      data += chunk.toString('latin1');
      if (data.includes('\r\n\r\n')) {
        socket.destroy();
        const match = /^HTTP\/1\.1\s+(\d{3})/.exec(data);
        resolve(match ? Number(match[1]) : 0);
      }
    });
    socket.once('error', reject);
  });
}

describe('Hub Direct Secure Terminal IPC (haus.terminal.v1)', () => {
  const dirs: string[] = [];
  const apps: Array<{ close: () => Promise<void> }> = [];
  const origApiToken = process.env.HAUS_API_TOKEN;
  const origDisabled = process.env.HAUS_TERMINAL_DISABLED;
  const origHubId = process.env.HAUS_HUB_ID;

  afterEach(async () => {
    if (origApiToken === undefined) delete process.env.HAUS_API_TOKEN;
    else process.env.HAUS_API_TOKEN = origApiToken;
    if (origDisabled === undefined) delete process.env.HAUS_TERMINAL_DISABLED;
    else process.env.HAUS_TERMINAL_DISABLED = origDisabled;
    if (origHubId === undefined) delete process.env.HAUS_HUB_ID;
    else process.env.HAUS_HUB_ID = origHubId;
    while (apps.length) {
      await apps.pop()?.close();
    }
    while (dirs.length) {
      const dir = dirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function bootHub(prefix: string, hubIdOverride?: string) {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    dirs.push(dir);
    if (hubIdOverride) process.env.HAUS_HUB_ID = hubIdOverride;
    else delete process.env.HAUS_HUB_ID;
    const app = await createNestApp({ dataDirectory: dir });
    await app.listen(0, '127.0.0.1');
    apps.push(app);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const auth = app.get<HubAuthService>(HUB_AUTH_SERVICE);
    return {
      app,
      auth,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      hubId: auth.getIdentity().hubId,
    };
  }

  async function requestTicket(
    baseUrl: string,
    token: string,
    targetServerId: string,
    client: TestTerminalClient,
  ) {
    return fetch(`${baseUrl}/api/servers/terminal/ticket`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-haus-client': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetServerId,
        cols: 80,
        rows: 24,
        clientEphemeralPublicKey: client.publicKeyPem,
        clientNonce: client.clientNonce,
      }),
    });
  }

  it('runs a direct binary E2EE PTY session with 0-RTT ready, binary ping/pong, burst throughput, and sanitized env', async () => {
    process.env.HAUS_API_TOKEN = 'SUPER_SECRET_HUB_TOKEN_DO_NOT_LEAK';
    const hub = await bootHub('haus-term-e2ee-');
    const adminToken = await pairClient(hub.baseUrl, hub.auth, 'admin', 'admin-1');

    const client = new TestTerminalClient();
    const res = await requestTicket(hub.baseUrl, adminToken, hub.hubId, client);
    expect(res.status).toBe(200);
    const ticket = client.completeHandshake(await res.json());
    expect(ticket.relayed).toBe(false);

    const { socket, head } = await dialRawTerminalIpc({
      origin: hub.baseUrl,
      path: '/api/servers/terminal',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-haus-client': '1',
        [TERMINAL_TICKET_HEADER]: ticket.ticketId,
        [TERMINAL_PROOF_HEADER]: client.proof,
      },
    });

    const reader = new RawIpcFrameReader();
    const frames: TerminalServerFrame[] = [];
    let output = '';
    let pongNonce = -1;

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout waiting for exit. Output length=${output.length}`)),
        10_000,
      );
      const onEnvelope = (env: Buffer) => {
        const msg = client.open(env);
        frames.push(msg);
        if (msg.t === 'ready') {
          socket.write(client.seal({ t: 'ping', n: 4242 }));
          socket.write(client.seal({ t: 'resize', cols: 100, rows: 30 }));
          socket.write(
            client.seal({
              t: 'data',
              d: Buffer.from(
                'printf "HAUS_DIRECT_IPC_OK\\nSECRET=%s\\n" "${HAUS_API_TOKEN:-CLEAN}"; seq 1 500; echo "BURST_END"; exit 0\n',
                'utf8',
              ),
            }),
          );
        } else if (msg.t === 'pong') {
          pongNonce = msg.n;
        } else if (msg.t === 'data') {
          output += Buffer.from(msg.d).toString('utf8');
          socket.write(client.seal({ t: 'ack', bytes: msg.d.byteLength }));
        } else if (msg.t === 'exit') {
          clearTimeout(timer);
          resolve(msg.code);
        }
      };
      socket.on('data', (chunk: Buffer) => reader.push(chunk, onEnvelope));
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      if (head.length > 0) reader.push(head, onEnvelope);
    });

    expect(frames[0]?.t).toBe('ready');
    expect(pongNonce).toBe(4242);
    expect(output).toContain('HAUS_DIRECT_IPC_OK');
    expect(output).toContain('SECRET=CLEAN');
    expect(output).toContain('BURST_END');
    expect(output).not.toContain('SUPER_SECRET_HUB_TOKEN_DO_NOT_LEAK');
    expect(exitCode).toBe(0);
    socket.destroy();
  }, 15_000);

  it('blocks non-admin RBAC, browser WebSocket/Origin upgrades, proof/ticket replay, kill-switch, and AEAD tampering', async () => {
    const hub = await bootHub('haus-term-sec-');
    const adminToken = await pairClient(hub.baseUrl, hub.auth, 'admin', 'admin-sec');
    const memberToken = await pairClient(hub.baseUrl, hub.auth, 'member', 'member-sec', adminToken);

    // 1. Non-admin member cannot mint terminal ticket.
    const memberRes = await requestTicket(
      hub.baseUrl,
      memberToken,
      hub.hubId,
      new TestTerminalClient(),
    );
    expect(memberRes.status).toBe(403);

    // 2. Kill-switch disables terminal cleanly.
    process.env.HAUS_TERMINAL_DISABLED = '1';
    const disabledRes = await requestTicket(
      hub.baseUrl,
      adminToken,
      hub.hubId,
      new TestTerminalClient(),
    );
    expect(disabledRes.status).toBe(503);
    delete process.env.HAUS_TERMINAL_DISABLED;

    // 3. Browser Origin header rejected (403) AND WebSocket upgrade rejected (426).
    const c1 = new TestTerminalClient();
    const t1 = c1.completeHandshake(
      await (await requestTicket(hub.baseUrl, adminToken, hub.hubId, c1)).json(),
    );
    expect(
      await rawUpgradeStatus(hub.port, 'haus-terminal-ipc', {
        Origin: 'https://evil.example',
        Authorization: `Bearer ${adminToken}`,
        'x-haus-client': '1',
        [TERMINAL_TICKET_HEADER]: t1.ticketId,
        [TERMINAL_PROOF_HEADER]: c1.proof,
      }),
    ).toBe(403);
    expect(
      await rawUpgradeStatus(hub.port, 'websocket', {
        Authorization: `Bearer ${adminToken}`,
        'x-haus-client': '1',
        [TERMINAL_TICKET_HEADER]: t1.ticketId,
        [TERMINAL_PROOF_HEADER]: c1.proof,
      }),
    ).toBe(426);

    // 4. Invalid cryptographic proof rejected (401) AND burns single-use ticket.
    await expect(
      dialRawTerminalIpc({
        origin: hub.baseUrl,
        path: '/api/servers/terminal',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'x-haus-client': '1',
          [TERMINAL_TICKET_HEADER]: t1.ticketId,
          [TERMINAL_PROOF_HEADER]: 'A'.repeat(43),
        },
      }),
    ).rejects.toThrow(RawIpcUpgradeError);
    await expect(
      dialRawTerminalIpc({
        origin: hub.baseUrl,
        path: '/api/servers/terminal',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'x-haus-client': '1',
          [TERMINAL_TICKET_HEADER]: t1.ticketId,
          [TERMINAL_PROOF_HEADER]: c1.proof,
        },
      }),
    ).rejects.toThrow(RawIpcUpgradeError);

    // 5. Tampered AEAD ciphertext immediately closes TCP socket.
    const tamperClient = new TestTerminalClient();
    const t2 = tamperClient.completeHandshake(
      await (await requestTicket(hub.baseUrl, adminToken, hub.hubId, tamperClient)).json(),
    );
    const { socket: tamperSock } = await dialRawTerminalIpc({
      origin: hub.baseUrl,
      path: '/api/servers/terminal',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-haus-client': '1',
        [TERMINAL_TICKET_HEADER]: t2.ticketId,
        [TERMINAL_PROOF_HEADER]: tamperClient.proof,
      },
    });
    const closedOnTamper = await new Promise<boolean>((resolve) => {
      tamperSock.once('close', () => resolve(true));
      const good = tamperClient.seal({ t: 'data', d: Buffer.from('echo hi\n') });
      good[good.length - 1] ^= 0xff;
      tamperSock.write(good);
    });
    expect(closedOnTamper).toBe(true);

    // 6. Sequence replay immediately closes TCP socket.
    const replayClient = new TestTerminalClient();
    const t3 = replayClient.completeHandshake(
      await (await requestTicket(hub.baseUrl, adminToken, hub.hubId, replayClient)).json(),
    );
    const { socket: replaySock } = await dialRawTerminalIpc({
      origin: hub.baseUrl,
      path: '/api/servers/terminal',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-haus-client': '1',
        [TERMINAL_TICKET_HEADER]: t3.ticketId,
        [TERMINAL_PROOF_HEADER]: replayClient.proof,
      },
    });
    const closedOnReplay = await new Promise<boolean>((resolve) => {
      replaySock.once('close', () => resolve(true));
      const frame1 = replayClient.seal({ t: 'ack', bytes: 1 });
      replaySock.write(frame1);
      replaySock.write(frame1);
    });
    expect(closedOnReplay).toBe(true);
  }, 15_000);

  it('pipes opaque direct E2EE binary IPC from Coordinator Hub to a joined Peer Hub with zero frame parsing', async () => {
    const primary = await bootHub('haus-term-primary-', 'hub-primary-term');
    const worker = await bootHub('haus-term-worker-', 'hub-worker-term');
    const primaryAdmin = await pairClient(primary.baseUrl, primary.auth, 'admin', 'admin-primary');
    const workerAdmin = await pairClient(worker.baseUrl, worker.auth, 'admin', 'admin-worker');

    const nodeChallenge = primary.auth.openChallenge(undefined, {
      sessionId: 'admin-join',
      hubId: primary.hubId,
      homeId: primary.auth.getIdentity().homeId,
      clientId: 'admin-primary',
      clientName: 'Admin Primary',
      clientRole: 'admin',
      token: 'admin-join-tok',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      revoked: false,
    });
    const confirmRes = await fetch(`${primary.baseUrl}/api/auth/confirm`, {
      method: 'POST',
      headers: { authorization: `Bearer ${primaryAdmin}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: nodeChallenge.sessionId,
        challengeCode: nodeChallenge.challengeCode,
        client: { clientId: worker.hubId, clientName: 'Worker Hub', role: 'node' },
      }),
    });
    const { grant } = (await confirmRes.json()) as { grant: Record<string, unknown> };
    const attachRes = await fetch(`${worker.baseUrl}/api/cluster/attach`, {
      method: 'POST',
      headers: { authorization: `Bearer ${workerAdmin}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        coordinatorUrl: primary.baseUrl,
        homeId: primary.auth.getIdentity().homeId,
        coordinatorToken: primaryAdmin,
        selfUrl: worker.baseUrl,
        name: 'Worker Hub',
        roles: ['storage', 'stream'],
        grant,
      }),
    });
    expect(attachRes.status).toBe(201);

    const client = new TestTerminalClient();
    const ticketRes = await requestTicket(primary.baseUrl, primaryAdmin, worker.hubId, client);
    expect(ticketRes.status).toBe(200);
    const ticket = client.completeHandshake(await ticketRes.json());
    expect(ticket.relayed).toBe(true);
    expect(ticket.targetHubId).toBe(worker.hubId);

    const { socket, head } = await dialRawTerminalIpc({
      origin: primary.baseUrl,
      path: '/api/servers/terminal',
      headers: {
        Authorization: `Bearer ${primaryAdmin}`,
        'x-haus-client': '1',
        [TERMINAL_TICKET_HEADER]: ticket.ticketId,
        [TERMINAL_PROOF_HEADER]: client.proof,
      },
    });

    const reader = new RawIpcFrameReader();
    let output = '';
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Peer relay timeout. Output: ${output}`)),
        10_000,
      );
      const onEnvelope = (env: Buffer) => {
        const msg = client.open(env);
        if (msg.t === 'ready') {
          socket.write(
            client.seal({
              t: 'data',
              d: Buffer.from('printf "PEER_DIRECT_IPC_OK\\n"; exit 0\n', 'utf8'),
            }),
          );
        } else if (msg.t === 'data') {
          output += Buffer.from(msg.d).toString('utf8');
          socket.write(client.seal({ t: 'ack', bytes: msg.d.byteLength }));
        } else if (msg.t === 'exit') {
          clearTimeout(timer);
          resolve(msg.code);
        }
      };
      socket.on('data', (chunk: Buffer) => reader.push(chunk, onEnvelope));
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      if (head.length > 0) reader.push(head, onEnvelope);
    });

    expect(output).toContain('PEER_DIRECT_IPC_OK');
    expect(exitCode).toBe(0);
    socket.destroy();
  }, 20_000);
});
