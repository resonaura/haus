/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { WsAdapter } from '@nestjs/platform-ws';
import type { INestApplicationContext } from '@nestjs/common';
import { Server as HttpServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { LiveService } from './types.js';

export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** Validate the pinned platform-ws adapter's private cache shape before using it. */
function registry(adapter: object) {
  const state = adapter as Record<string, unknown>;
  const { httpServersRegistry, wsServersRegistry, upgradeListenersRegistry } = state;
  if (
    !(httpServersRegistry instanceof Map) ||
    !(wsServersRegistry instanceof Map) ||
    !(upgradeListenersRegistry instanceof Map)
  )
    throw Error('unsupported_websocket_adapter');
  return {
    http: httpServersRegistry as Map<number, unknown>,
    websocket: wsServersRegistry as Map<number, unknown>,
    upgrade: upgradeListenersRegistry as Map<number, unknown>,
  };
}
function listener(value: unknown): value is UpgradeListener {
  return typeof value === 'function';
}
function server(value: unknown): value is WebSocketServer & { path: string } {
  return value instanceof WebSocketServer && 'path' in value && typeof value.path === 'string';
}

export class HausWsAdapter extends WsAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly liveService?: LiveService,
    private readonly additionalUpgrade?: UpgradeHandler,
  ) {
    super(app);
  }

  override ensureHttpServerExists(port: number, httpServer?: HttpServer): HttpServer | undefined {
    const state = registry(this);
    if (state.http.has(port)) {
      const existing = state.http.get(port);
      return existing instanceof HttpServer ? existing : undefined;
    }
    const http = super.ensureHttpServerExists(port, httpServer);
    const fallback = state.upgrade.get(port);
    if (!http || !listener(fallback)) return http;
    http.removeListener('upgrade', fallback);
    const upgrade: UpgradeListener = (req, socket, head) => {
      try {
        if (this.additionalUpgrade?.(req, socket, head)) return;
        const pathname = new URL(req.url ?? '/', 'ws://' + (req.headers.host ?? '127.0.0.1'))
          .pathname;
        if (pathname === '/api/live') {
          if (
            req.headers['x-haus-client'] !== '1' ||
            (this.liveService &&
              (!this.liveService.authorize(req.headers.authorization) ||
                this.liveService.getClientCount() >= 32))
          ) {
            socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            return;
          }
          for (const group of state.websocket.values()) {
            if (!Array.isArray(group)) continue;
            for (const candidate of group) {
              if (!server(candidate) || candidate.path !== pathname) continue;
              candidate.handleUpgrade(req, socket, head, (ws) => {
                ws.on('message', () => ws.close(1008, 'Read-only channel'));
                candidate.emit('connection', ws, req);
              });
              return;
            }
          }
        }
        fallback(req, socket, head);
      } catch {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      }
    };
    http.on('upgrade', upgrade);
    state.upgrade.set(port, upgrade);
    return http;
  }
}
