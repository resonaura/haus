/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { createHausLogger } from '@haus/core';
import { TERMINAL_IDLE_TIMEOUT_MS } from '@haus/core/protocol';
import {
  configureLowLatencySocket,
  dialRawTerminalIpc,
  IPC_UPGRADE_ACCEPT_BUFFER,
  RawIpcUpgradeError,
} from '../transport.js';

const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const IDLE_CHECK_MS = 15_000;
const AUTH_RECHECK_MS = 10_000;

export interface RawTerminalRelayHandle {
  readonly close: (reason?: string) => void;
}

/**
 * Opens an upstream direct raw TCP/TLS IPC tunnel and pipes opaque E2EE bytes
 * bidirectionally with `TCP_NODELAY`, bounded backpressure, and zero frame parsing overhead.
 */
export function openRawTerminalRelay(params: {
  readonly clientSocket: Duplex;
  readonly clientHead: Buffer;
  readonly origin: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly label: string;
  readonly timeoutMs?: number;
  readonly checkAuthorized: () => boolean;
  readonly onClosed: () => void;
}): RawTerminalRelayHandle {
  const logger = createHausLogger('TerminalRelay');
  let closed = false;
  let lastActivity = Date.now();
  let upstreamSocket: Socket | undefined;

  const cleanup = (reason = 'relay_closed') => {
    if (closed) return;
    closed = true;
    clearInterval(idleTimer);
    clearInterval(authTimer);
    try {
      if (!params.clientSocket.destroyed) params.clientSocket.destroy();
    } catch {
      // Ignore already-destroyed socket.
    }
    try {
      if (upstreamSocket && !upstreamSocket.destroyed) upstreamSocket.destroy();
    } catch {
      // Ignore already-destroyed upstream socket.
    }
    params.onClosed();
    logger.info(`Closed direct peer terminal relay to ${params.label} (${reason})`);
  };

  const idleTimer = setInterval(() => {
    if (closed) return;
    if (Date.now() - lastActivity > TERMINAL_IDLE_TIMEOUT_MS) {
      cleanup('idle_timeout');
    }
  }, IDLE_CHECK_MS);
  idleTimer.unref();

  const authTimer = setInterval(() => {
    if (closed) return;
    if (!params.checkAuthorized()) {
      logger.warn(`Closing relayed terminal to ${params.label}: caller authorization revoked`);
      cleanup('session_revoked');
    }
  }, AUTH_RECHECK_MS);
  authTimer.unref();

  params.clientSocket.once('close', () => cleanup('client_closed'));
  params.clientSocket.once('error', () => cleanup('client_error'));

  void dialRawTerminalIpc({
    origin: params.origin,
    path: params.path,
    headers: params.headers,
    timeoutMs: params.timeoutMs ?? 10_000,
  })
    .then(({ socket, head: upstreamHead }) => {
      if (closed) {
        socket.destroy();
        return;
      }
      upstreamSocket = socket;
      configureLowLatencySocket(params.clientSocket);
      configureLowLatencySocket(upstreamSocket);

      // Forward upstream's initial encrypted READY bytes in the same write as HTTP 101 (0-RTT).
      params.clientSocket.write(
        upstreamHead.length > 0
          ? Buffer.concat([IPC_UPGRADE_ACCEPT_BUFFER, upstreamHead])
          : IPC_UPGRADE_ACCEPT_BUFFER,
      );
      if (params.clientHead.length > 0) {
        upstreamSocket.write(params.clientHead);
      }

      const pipeChunks = (src: Duplex, dst: Duplex) => {
        src.on('data', (chunk: Buffer) => {
          if (closed || dst.destroyed || !dst.writable) return;
          lastActivity = Date.now();
          if (dst.writableLength > MAX_BUFFERED_BYTES) {
            cleanup('relay_backpressure_exceeded');
            return;
          }
          if (!dst.write(chunk)) {
            src.pause();
          }
        });
        dst.on('drain', () => {
          if (!closed && !src.destroyed) src.resume();
        });
      };

      pipeChunks(params.clientSocket, upstreamSocket);
      pipeChunks(upstreamSocket, params.clientSocket);

      params.clientSocket.once('end', () => cleanup('client_ended'));
      upstreamSocket.once('end', () => cleanup('peer_ended'));
      upstreamSocket.once('close', () => cleanup('peer_closed'));
      upstreamSocket.once('error', () => cleanup('peer_error'));
    })
    .catch((error: unknown) => {
      if (closed) return;
      const status = error instanceof RawIpcUpgradeError ? error.statusCode : 502;
      const text = error instanceof RawIpcUpgradeError ? error.statusText : 'Bad Gateway';
      logger.warn(`Peer terminal relay dial to ${params.label} failed: ${status} ${text}`);
      try {
        if (!params.clientSocket.destroyed && params.clientSocket.writable) {
          params.clientSocket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
        }
      } catch {
        // Ignore socket write error.
      }
      cleanup('peer_dial_failed');
    });

  return { close: cleanup };
}
