/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createHausLogger } from '@haus/core';
import {
  TERMINAL_PROOF_HEADER,
  TERMINAL_TICKET_HEADER,
  type TerminalServerFrame,
  type TerminalTarget,
} from '@haus/core/protocol';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { dialRawTerminalIpc, RawIpcFrameReader } from '@haus/ipc/transport';
import { TestTerminalClient } from './terminal-client.js';

function packDockerMultiplex(streamType: 1 | 2, text: string): Buffer {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

async function pairAdmin(baseUrl: string, auth: HubAuthService): Promise<string> {
  const cRes = await fetch(`${baseUrl}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const ch = (await cRes.json()) as { sessionId: string };
  const code = auth.pairing.getSession(ch.sessionId)!.challengeCode;
  const confRes = await fetch(`${baseUrl}/api/auth/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: ch.sessionId,
      challengeCode: code,
      client: { clientId: 'admin-targets', clientName: 'Admin', role: 'admin' },
    }),
  });
  const { grant } = (await confRes.json()) as { grant: Record<string, unknown> };
  const pRes = await fetch(`${baseUrl}/api/auth/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant }),
  });
  const paired = (await pRes.json()) as { credentials: { sessionToken: string } };
  return paired.credentials.sessionToken;
}

describe('Hub Direct IPC Multi-Target Streams (Hub logs, Docker logs/exec, validation)', () => {
  const dirs: string[] = [];
  const closers: Array<() => Promise<void>> = [];
  const origDockerSocket = process.env.HAUS_DOCKER_SOCKET;

  afterEach(async () => {
    if (origDockerSocket === undefined) delete process.env.HAUS_DOCKER_SOCKET;
    else process.env.HAUS_DOCKER_SOCKET = origDockerSocket;
    while (closers.length) {
      await closers.pop()?.();
    }
    while (dirs.length) {
      const dir = dirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function bootHubWithMockDocker() {
    const dir = await mkdtemp(join(tmpdir(), 'haus-term-targets-'));
    dirs.push(dir);
    const sockPath = join(dir, 'docker.sock');
    const resizeCalls: string[] = [];
    const containerId = 'a'.repeat(64);
    const execId = 'b'.repeat(64);

    const dockerServer: Server = createHttpServer((req, res) => {
      const url = req.url ?? '';
      if (req.method === 'GET' && url === `/v1.45/containers/${containerId}/json`) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ Name: '/demo-app', Config: { Tty: false }, State: { Running: true } }));
        return;
      }
      if (req.method === 'GET' && url.startsWith(`/v1.45/containers/${containerId}/logs`)) {
        res.writeHead(200, { 'content-type': 'application/vnd.docker.raw-stream' });
        res.write(packDockerMultiplex(1, '\x1b[32mDOCKER_ANSI_LINE_1\x1b[0m\n'));
        setTimeout(() => {
          if (!res.destroyed) {
            res.write(packDockerMultiplex(2, '\x1b[31mDOCKER_ANSI_ERR_2\x1b[0m\n'));
            res.end();
          }
        }, 40);
        return;
      }
      if (req.method === 'POST' && url === `/v1.45/containers/${containerId}/exec`) {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ Id: execId }));
        return;
      }
      if (req.method === 'POST' && url.startsWith(`/v1.45/exec/${execId}/resize`)) {
        resizeCalls.push(url);
        res.writeHead(200).end();
        return;
      }
      if (req.method === 'GET' && url === `/v1.45/exec/${execId}/json`) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ExitCode: 0 }));
        return;
      }
      res.writeHead(404).end();
    });

    const dockerSockets = new Set<import('node:stream').Duplex>();
    dockerServer.on('upgrade', (req, socket) => {
      dockerSockets.add(socket);
      socket.once('close', () => dockerSockets.delete(socket));
      if (req.url === `/v1.45/exec/${execId}/start`) {
        socket.write(
          'HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n',
        );
        socket.write(Buffer.from('\x1b[36mroot@demo-app:/#\x1b[0m ', 'utf8'));
        socket.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          socket.write(Buffer.from(`EXEC_ECHO:${text}`, 'utf8'));
          if (text.includes('exit')) socket.end();
        });
      } else {
        socket.destroy();
      }
    });

    dockerServer.listen(sockPath);
    await once(dockerServer, 'listening');
    closers.push(async () => {
      for (const s of dockerSockets) s.destroy();
      dockerSockets.clear();
      dockerServer.closeAllConnections();
      await new Promise<void>((resolve) => dockerServer.close(() => resolve()));
    });

    process.env.HAUS_DOCKER_SOCKET = sockPath;
    const app = await createNestApp({ dataDirectory: dir });
    await app.listen(0, '127.0.0.1');
    closers.push(() => app.close());

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const auth = app.get<HubAuthService>(HUB_AUTH_SERVICE);
    const adminToken = await pairAdmin(baseUrl, auth);
    return { baseUrl, hubId: auth.getIdentity().hubId, adminToken, containerId, resizeCalls };
  }

  async function openTargetStream(
    baseUrl: string,
    token: string,
    targetServerId: string,
    target: TerminalTarget,
  ) {
    const client = new TestTerminalClient();
    const res = await fetch(`${baseUrl}/api/servers/terminal/ticket`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-haus-client': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetServerId,
        cols: 90,
        rows: 30,
        clientEphemeralPublicKey: client.publicKeyPem,
        clientNonce: client.clientNonce,
        target,
      }),
    });
    expect(res.status).toBe(200);
    const ticket = client.completeHandshake(await res.json());
    const dialed = await dialRawTerminalIpc({
      origin: baseUrl,
      path: '/api/servers/terminal',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-haus-client': '1',
        [TERMINAL_TICKET_HEADER]: ticket.ticketId,
        [TERMINAL_PROOF_HEADER]: client.proof,
      },
    });
    return { client, ...dialed };
  }

  it('streams live ANSI-colored Hub logs over direct E2EE IPC and enforces read-only mode', async () => {
    const env = await bootHubWithMockDocker();
    const log = createHausLogger('TestHubLogs', { level: 'info' });
    log.info('HUB_HISTORY_MARKER_ALPHA');

    const { client, socket, head } = await openTargetStream(env.baseUrl, env.adminToken, env.hubId, {
      kind: 'hub-logs',
      tail: 100,
    });
    const reader = new RawIpcFrameReader();
    let readyFrame: Extract<TerminalServerFrame, { t: 'ready' }> | undefined;
    let text = '';

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Hub logs timeout. Got: ${text}`)), 5_000);
      const onEnv = (buf: Buffer) => {
        const msg = client.open(buf);
        if (msg.t === 'ready') {
          readyFrame = msg;
          socket.write(client.seal({ t: 'data', d: Buffer.from('ignored-input\n') }));
          log.warn('HUB_LIVE_MARKER_BETA');
        } else if (msg.t === 'data') {
          text += Buffer.from(msg.d).toString('utf8');
          if (text.includes('HUB_HISTORY_MARKER_ALPHA') && text.includes('HUB_LIVE_MARKER_BETA')) {
            clearTimeout(timer);
            resolve();
          }
        }
      };
      socket.on('data', (chunk: Buffer) => reader.push(chunk, onEnv));
      if (head.length > 0) reader.push(head, onEnv);
    });

    expect(readyFrame?.readOnly).toBe(true);
    expect(text).toContain('\x1b[');
    expect(text).toContain('HUB_HISTORY_MARKER_ALPHA');
    expect(text).toContain('HUB_LIVE_MARKER_BETA');
    socket.destroy();
  });

  it('streams ANSI-preserving Docker container logs, runs interactive Docker exec PTY, and rejects unsafe target IDs', async () => {
    const env = await bootHubWithMockDocker();

    // 1. Validate injection-resistance on target IDs.
    const badClient = new TestTerminalClient();
    const badContainer = await fetch(`${env.baseUrl}/api/servers/terminal/ticket`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.adminToken}`,
        'x-haus-client': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetServerId: env.hubId,
        cols: 80,
        rows: 24,
        clientEphemeralPublicKey: badClient.publicKeyPem,
        clientNonce: badClient.clientNonce,
        target: { kind: 'docker-exec', containerId: '../etc/passwd' },
      }),
    });
    expect(badContainer.status).toBe(400);

    const badService = await fetch(`${env.baseUrl}/api/servers/terminal/ticket`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.adminToken}`,
        'x-haus-client': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetServerId: env.hubId,
        cols: 80,
        rows: 24,
        clientEphemeralPublicKey: badClient.publicKeyPem,
        clientNonce: badClient.clientNonce,
        target: { kind: 'service-logs', manager: 'systemd', serviceId: '--exec=evil' },
      }),
    });
    expect(badService.status).toBe(400);

    // 2. Docker ANSI live logs preserve escape codes and normalize CRLF.
    const logsConn = await openTargetStream(env.baseUrl, env.adminToken, env.hubId, {
      kind: 'docker-logs',
      containerId: env.containerId,
      tail: 50,
    });
    const logsReader = new RawIpcFrameReader();
    let logsText = '';
    let logsReadOnly = false;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Docker logs timeout: ${logsText}`)), 5_000);
      const onEnv = (buf: Buffer) => {
        const msg = logsConn.client.open(buf);
        if (msg.t === 'ready') logsReadOnly = msg.readOnly === true;
        else if (msg.t === 'data') logsText += Buffer.from(msg.d).toString('utf8');
        else if (msg.t === 'exit') {
          clearTimeout(timer);
          resolve();
        }
      };
      logsConn.socket.on('data', (chunk: Buffer) => logsReader.push(chunk, onEnv));
      if (logsConn.head.length > 0) logsReader.push(logsConn.head, onEnv);
    });
    expect(logsReadOnly).toBe(true);
    expect(logsText).toContain('\x1b[32mDOCKER_ANSI_LINE_1\x1b[0m\r\n');
    expect(logsText).toContain('\x1b[31mDOCKER_ANSI_ERR_2\x1b[0m\r\n');
    logsConn.socket.destroy();

    // 3. Docker exec PTY full-duplex roundtrip + resize forwarding.
    const execConn = await openTargetStream(env.baseUrl, env.adminToken, env.hubId, {
      kind: 'docker-exec',
      containerId: env.containerId,
    });
    const execReader = new RawIpcFrameReader();
    let execText = '';
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Docker exec timeout: ${execText}`)), 5_000);
      const onEnv = (buf: Buffer) => {
        const msg = execConn.client.open(buf);
        if (msg.t === 'ready') {
          expect(msg.readOnly).not.toBe(true);
          execConn.socket.write(execConn.client.seal({ t: 'resize', cols: 110, rows: 35 }));
          execConn.socket.write(
            execConn.client.seal({ t: 'data', d: Buffer.from('uname -a; exit\n') }),
          );
        } else if (msg.t === 'data') {
          execText += Buffer.from(msg.d).toString('utf8');
        } else if (msg.t === 'exit') {
          clearTimeout(timer);
          resolve(msg.code);
        }
      };
      execConn.socket.on('data', (chunk: Buffer) => execReader.push(chunk, onEnv));
      if (execConn.head.length > 0) execReader.push(execConn.head, onEnv);
    });
    expect(execText).toContain('\x1b[36mroot@demo-app:/#\x1b[0m');
    expect(execText).toContain('EXEC_ECHO:uname -a; exit');
    expect(exitCode).toBe(0);
    expect(env.resizeCalls.some((u) => u.includes('h=35&w=110'))).toBe(true);
    execConn.socket.destroy();
  });
});
