/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { connect as tcpConnect, Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { Duplex } from 'node:stream';
import {
  TERMINAL_FRAME_HEADER_BYTES,
  TERMINAL_IPC_UPGRADE,
  TERMINAL_MAX_FRAME_BYTES,
  TERMINAL_WIRE_LENGTH_BYTES,
} from '@haus/core/protocol';

const MAX_HTTP_UPGRADE_HEADER_BYTES = 8_192;
const HEADER_CRLF_RE = /[\r\n\0]/;
const HEADER_END = Buffer.from('\r\n\r\n', 'ascii');

export const IPC_UPGRADE_ACCEPT_BUFFER = Buffer.from(
  `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: ${TERMINAL_IPC_UPGRADE}\r\n\r\n`,
  'ascii',
);

export function configureLowLatencySocket(socket: Duplex): void {
  if (socket instanceof Socket) {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15_000);
  }
}

/**
 * Zero-copy fast-path incremental frame reader for 4-byte length-prefixed encrypted IPC frames.
 */
export class RawIpcFrameReader {
  private pending: Buffer = Buffer.alloc(0);

  push(chunk: Buffer, onFrame: (envelope: Buffer) => void): void {
    if (chunk.length === 0) return;
    const buf = this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
    let offset = 0;

    while (buf.length - offset >= TERMINAL_WIRE_LENGTH_BYTES) {
      const frameLen = buf.readUInt32BE(offset);
      if (frameLen <= TERMINAL_FRAME_HEADER_BYTES || frameLen > TERMINAL_MAX_FRAME_BYTES) {
        this.pending = Buffer.alloc(0);
        throw Error('invalid_ipc_frame_length');
      }
      const total = TERMINAL_WIRE_LENGTH_BYTES + frameLen;
      if (buf.length - offset < total) break;
      const envelope = buf.subarray(offset + TERMINAL_WIRE_LENGTH_BYTES, offset + total);
      offset += total;
      onFrame(envelope);
    }

    if (offset === buf.length) {
      this.pending = Buffer.alloc(0);
    } else if (offset > 0) {
      this.pending = Buffer.from(buf.subarray(offset));
    } else {
      this.pending = Buffer.from(buf);
    }
  }

  reset(): void {
    this.pending = Buffer.alloc(0);
  }
}

export class RawIpcUpgradeError extends Error {
  constructor(
    readonly statusCode: number,
    readonly statusText: string,
  ) {
    super(`ipc_upgrade_rejected_${statusCode}`);
  }
}

export interface DialRawIpcResult {
  readonly socket: Socket;
  readonly head: Buffer;
}

/**
 * Opens a direct TCP/TLS socket with TCP_NODELAY and performs an HTTP/1.1 101 Upgrade to
 * `haus-terminal-ipc` — bypassing WebSocket framing and client XOR masking completely.
 */
export function dialRawTerminalIpc(params: {
  readonly origin: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly timeoutMs?: number;
}): Promise<DialRawIpcResult> {
  const parsed = new URL(params.origin);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Promise.reject(Error('invalid_ipc_origin'));
  }
  if (HEADER_CRLF_RE.test(params.path) || !params.path.startsWith('/')) {
    return Promise.reject(Error('invalid_ipc_path'));
  }
  const isTls = parsed.protocol === 'https:';
  const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
  const hostHeader = parsed.host;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  const lines = [
    `GET ${params.path} HTTP/1.1`,
    `Host: ${hostHeader}`,
    'Connection: Upgrade',
    `Upgrade: ${TERMINAL_IPC_UPGRADE}`,
  ];
  for (const [key, value] of Object.entries(params.headers)) {
    if (HEADER_CRLF_RE.test(key) || HEADER_CRLF_RE.test(value)) {
      return Promise.reject(Error('invalid_ipc_header'));
    }
    lines.push(`${key}: ${value}`);
  }
  const requestPayload = Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'utf8');

  return new Promise<DialRawIpcResult>((resolve, reject) => {
    const socket: Socket = isTls
      ? tlsConnect({ host: hostname, port, servername: hostname })
      : tcpConnect({ host: hostname, port, noDelay: true });
    configureLowLatencySocket(socket);

    let settled = false;
    let headerBuf: Buffer = Buffer.alloc(0);

    const timer = setTimeout(() => {
      fail(Error('ipc_upgrade_timeout'));
    }, params.timeoutMs ?? 10_000);
    timer.unref();

    const detach = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      detach();
      socket.destroy();
      reject(err);
    };

    const onError = (err: Error) => fail(err);
    const onClose = () => fail(Error('ipc_upgrade_closed'));

    const onData = (chunk: Buffer) => {
      headerBuf = headerBuf.length > 0 ? Buffer.concat([headerBuf, chunk]) : chunk;
      const endIndex = headerBuf.indexOf(HEADER_END);
      if (endIndex < 0) {
        if (headerBuf.length > MAX_HTTP_UPGRADE_HEADER_BYTES) {
          fail(Error('ipc_upgrade_headers_too_large'));
        }
        return;
      }
      const headerText = headerBuf.subarray(0, endIndex).toString('latin1');
      const head = Buffer.from(headerBuf.subarray(endIndex + HEADER_END.length));
      const headerLines = headerText.split('\r\n');
      const statusMatch = /^HTTP\/1\.1\s+(\d{3})\s*(.*)$/.exec(headerLines[0] ?? '');
      if (!statusMatch) {
        fail(Error('ipc_upgrade_malformed_response'));
        return;
      }
      const statusCode = Number(statusMatch[1]);
      const statusText = (statusMatch[2] ?? '').trim() || 'Error';
      if (statusCode !== 101) {
        fail(new RawIpcUpgradeError(statusCode, statusText));
        return;
      }
      let upgradeVal = '';
      for (let i = 1; i < headerLines.length; i += 1) {
        const line = headerLines[i] ?? '';
        const sep = line.indexOf(':');
        if (sep > 0 && line.slice(0, sep).trim().toLowerCase() === 'upgrade') {
          upgradeVal = line
            .slice(sep + 1)
            .trim()
            .toLowerCase();
        }
      }
      if (upgradeVal !== TERMINAL_IPC_UPGRADE) {
        fail(Error('ipc_upgrade_protocol_mismatch'));
        return;
      }
      settled = true;
      detach();
      resolve({ socket, head });
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.once(isTls ? 'secureConnect' : 'connect', () => {
      if (!settled) socket.write(requestPayload);
    });
  });
}
