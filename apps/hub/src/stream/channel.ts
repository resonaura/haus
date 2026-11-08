/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';

interface AliveWebSocket extends WebSocket {
  alive?: boolean;
}

export interface LiveChannelShared {
  revision?: string;
  subscribe(listener: () => void): (() => void) | void;
}

export interface LiveChannelHa {
  connected?: boolean;
  on?(event: 'ready' | 'status', listener: () => void): void;
  off?(event: 'ready' | 'status', listener: () => void): void;
}

export interface LiveChannelOptions {
  authorize: (req: IncomingMessage) => boolean;
  shared?: LiveChannelShared;
  ha?: LiveChannelHa;
  sources?: () => unknown;
  heartbeatMs?: number;
}

export interface LiveChannelHandle {
  publish: (topic?: string) => void;
}

/** Ingress-authenticated invalidations, independent of the HA event socket. No commands or credentials. */
export function liveChannel(
  server: HttpServer,
  { authorize, shared, ha, sources, heartbeatMs = 5000 }: LiveChannelOptions,
): LiveChannelHandle {
  const hub = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    perMessageDeflate: false,
  });
  const instance = randomUUID();
  let sequence = 0;
  const state = (topic = 'home') => ({
    protocol: 1,
    instance,
    sequence: ++sequence,
    topic,
    revision: shared?.revision ?? '0',
    connected: Boolean(ha?.connected),
    ...(sources ? { sources: sources() } : {}),
  });
  const send = (socket: AliveWebSocket, value: unknown) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 65536) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(value));
  };
  const publish = (topic?: string) => {
    const value = state(topic);
    for (const socket of hub.clients) {
      send(socket as AliveWebSocket, value);
    }
  };
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (
      req.url !== '/api/live' ||
      req.headers['x-haus-client'] !== '1' ||
      !authorize(req) ||
      hub.clients.size >= 32
    ) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    hub.handleUpgrade(req, socket, head, (client) => hub.emit('connection', client));
  });
  hub.on('connection', (socket: AliveWebSocket) => {
    socket.alive = true;
    socket.on('pong', () => {
      socket.alive = true;
    });
    socket.on('message', () => socket.close(1008, 'Read-only channel'));
    socket.on('error', () => {});
    send(socket, state());
  });
  const stopShared = shared?.subscribe(() => publish('preferences'));
  const ready = () => publish('home');
  ha?.on?.('ready', ready);
  ha?.on?.('status', ready);
  const timer = setInterval(() => {
    for (const client of hub.clients) {
      const socket = client as AliveWebSocket;
      if (!socket.alive) socket.terminate();
      else {
        socket.alive = false;
        socket.ping();
      }
    }
    publish('heartbeat');
  }, heartbeatMs);
  timer.unref();
  server.on('close', () => {
    clearInterval(timer);
    stopShared?.();
    ha?.off?.('ready', ready);
    ha?.off?.('status', ready);
    for (const socket of hub.clients) socket.terminate();
    hub.close();
  });
  return { publish };
}
