/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { WsAdapter } from '@nestjs/platform-ws';
import type { INestApplicationContext } from '@nestjs/common';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocket } from 'ws';
import type { LiveService } from './types.js';

interface EventEmitterLike {
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

interface WsServerLike {
  path: string;
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: WebSocket) => void,
  ): void;
  emit(event: string, ...args: unknown[]): void;
}

interface WsAdapterInternals {
  httpServersRegistry: Map<number, unknown>;
  wsServersRegistry: Map<number, WsServerLike[]>;
  upgradeListenersRegistry: Map<
    number,
    (req: IncomingMessage, socket: Duplex, head: Buffer) => void
  >;
}

export class HausWsAdapter extends WsAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly liveService?: LiveService,
  ) {
    super(app);
  }

  override ensureHttpServerExists(port: number, httpServer?: HttpServer): HttpServer | undefined {
    const internals = this as unknown as WsAdapterInternals;
    if (internals.httpServersRegistry.has(port)) {
      return internals.httpServersRegistry.get(port) as HttpServer | undefined;
    }

    const server = super.ensureHttpServerExists(port, httpServer);
    const defaultListener = internals.upgradeListenersRegistry.get(port);

    if (
      defaultListener &&
      server &&
      typeof (server as unknown as EventEmitterLike).removeListener === 'function'
    ) {
      const emitter = server as unknown as EventEmitterLike;
      emitter.removeListener('upgrade', defaultListener as (...args: unknown[]) => void);

      const wrappedListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        try {
          const host = req.headers.host ?? '127.0.0.1';
          const pathname = new URL(req.url ?? '/', `ws://${host}`).pathname;

          if (pathname === '/api/live') {
            const hasClientHeader = req.headers['x-haus-client'] === '1';
            const authorized = this.liveService
              ? this.liveService.authorize(req.headers.authorization)
              : true;
            const underCapacity = this.liveService ? this.liveService.getClientCount() < 32 : true;

            if (!hasClientHeader || !authorized || !underCapacity) {
              socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
              return;
            }

            const allServers = Array.from(internals.wsServersRegistry.values()).flat();
            for (const wsServer of allServers) {
              if (pathname === wsServer.path) {
                wsServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
                  ws.on('message', () => {
                    try {
                      ws.close(1008, 'Read-only channel');
                    } catch {}
                  });
                  wsServer.emit('connection', ws, req);
                });
                return;
              }
            }
          }

          defaultListener(req, socket, head);
        } catch {
          socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        }
      };

      emitter.on('upgrade', wrappedListener as (...args: unknown[]) => void);
      internals.upgradeListenersRegistry.set(port, wrappedListener);
    }

    return server;
  }
}
