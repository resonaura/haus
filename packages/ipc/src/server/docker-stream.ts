/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { request as httpRequest } from 'node:http';
import { connect as unixConnect, type Socket } from 'node:net';
import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import { detectTerminalScope } from './pty.js';
import type { TerminalSourceCallbacks, TerminalStreamSource } from './sources.js';

const CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/i;
const EXEC_ID_RE = /^[a-f0-9]{12,64}$/i;
const HEADER_END = Buffer.from('\r\n\r\n', 'ascii');
const MAX_HTTP_HEADER_BYTES = 8_192;
const CONTAINER_SHELL_CMD = [
  '/bin/sh',
  '-c',
  'if command -v bash >/dev/null 2>&1; then exec bash -i; elif command -v ash >/dev/null 2>&1; then exec ash -i; else exec sh -i; fi',
];

export function resolveDockerSocketPath(): string {
  const configured = process.env.HAUS_DOCKER_SOCKET?.trim() || '/var/run/docker.sock';
  if (!configured.startsWith('/') || configured.includes('\0') || configured.length > 1024) {
    throw Error('docker_unavailable');
  }
  if (!existsSync(configured)) {
    throw Error('docker_unavailable');
  }
  return configured;
}

/** Normalizes bare LF line endings to CRLF so xterm.js renders columns aligned while keeping ANSI codes intact. */
export function normalizeCrlfBytes(chunk: Buffer): Buffer {
  let lfCount = 0;
  for (let i = 0; i < chunk.length; i += 1) {
    if (chunk[i] === 0x0a && (i === 0 || chunk[i - 1] !== 0x0d)) lfCount += 1;
  }
  if (lfCount === 0) return chunk;
  const out = Buffer.allocUnsafe(chunk.length + lfCount);
  let pos = 0;
  for (let i = 0; i < chunk.length; i += 1) {
    const b = chunk[i]!;
    if (b === 0x0a && (i === 0 || chunk[i - 1] !== 0x0d)) {
      out[pos++] = 0x0d;
    }
    out[pos++] = b;
  }
  return out;
}

function dockerJsonRequest<T>(
  socketPath: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = 8_000,
): Promise<{ readonly status: number; readonly data?: T }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
    const req = httpRequest(
      {
        socketPath,
        method,
        path,
        timeout: timeoutMs,
        headers: payload
          ? {
              'content-type': 'application/json',
              'content-length': String(payload.length),
            }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total <= 512 * 1024) chunks.push(chunk);
        });
        res.once('end', () => {
          const status = res.statusCode ?? 0;
          if (chunks.length === 0) {
            resolve({ status });
            return;
          }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
            resolve({ status, data: parsed });
          } catch {
            resolve({ status });
          }
        });
        res.once('error', () => reject(Error('docker_request_failed')));
      },
    );
    req.once('timeout', () => {
      req.destroy();
      reject(Error('docker_request_timeout'));
    });
    req.once('error', () => reject(Error('docker_unavailable')));
    if (payload) req.write(payload);
    req.end();
  });
}

interface DockerInspectContainer {
  readonly Name?: string;
  readonly Config?: { readonly Tty?: boolean };
  readonly State?: { readonly Running?: boolean };
}

/**
 * Demultiplexes Docker's 8-byte multiplexed log framing (`[stream,0,0,0,lenBE32]`) while
 * preserving all ANSI color/style escape sequences intact for xterm.js rendering.
 */
class AnsiDockerLogDemuxer {
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly emit: (chunk: Buffer) => void) {}

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    const buf = this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
    let offset = 0;
    while (buf.length - offset >= 8) {
      const streamType = buf[offset];
      if (
        (streamType !== 0 && streamType !== 1 && streamType !== 2) ||
        buf[offset + 1] !== 0 ||
        buf[offset + 2] !== 0 ||
        buf[offset + 3] !== 0
      ) {
        this.emit(normalizeCrlfBytes(buf.subarray(offset)));
        this.pending = Buffer.alloc(0);
        return;
      }
      const len = buf.readUInt32BE(offset + 4);
      if (buf.length - offset < 8 + len) break;
      const payload = buf.subarray(offset + 8, offset + 8 + len);
      offset += 8 + len;
      if (payload.length > 0) this.emit(normalizeCrlfBytes(payload));
    }
    this.pending = offset < buf.length ? Buffer.from(buf.subarray(offset)) : Buffer.alloc(0);
  }
}

/** Opens a live ANSI-preserving log stream (`follow=1`) directly from Docker Engine Unix socket. */
export async function openDockerAnsiLogs(params: {
  readonly socketPath: string;
  readonly containerId: string;
  readonly tail: number;
  readonly callbacks: TerminalSourceCallbacks;
}): Promise<TerminalStreamSource> {
  if (!CONTAINER_ID_RE.test(params.containerId)) throw Error('invalid_terminal_container_id');
  const inspect = await dockerJsonRequest<DockerInspectContainer>(
    params.socketPath,
    'GET',
    `/v1.45/containers/${params.containerId}/json`,
  );
  if (inspect.status === 404) throw Error('container_not_found');
  if (inspect.status < 200 || inspect.status >= 300) throw Error('docker_request_failed');

  const tty = inspect.data?.Config?.Tty === true;
  const name = inspect.data?.Name?.replace(/^\/+/, '') || params.containerId.slice(0, 12);
  const tail = Math.max(1, Math.min(2000, Math.floor(params.tail)));
  const path = `/v1.45/containers/${params.containerId}/logs?stdout=1&stderr=1&follow=1&tail=${tail}&timestamps=0`;

  let closed = false;
  let responseStream: NodeJS.ReadableStream | undefined;
  const demuxer = new AnsiDockerLogDemuxer((buf) => {
    if (!closed && buf.length > 0) params.callbacks.onData(buf);
  });

  const req = httpRequest({ socketPath: params.socketPath, method: 'GET', path }, (res) => {
    if (!res.statusCode || res.statusCode >= 400) {
      res.destroy();
      if (!closed) {
        closed = true;
        params.callbacks.onError(
          res.statusCode === 404 ? 'container_not_found' : 'docker_request_failed',
        );
      }
      return;
    }
    responseStream = res;
    res.on('data', (chunk: Buffer) => {
      if (closed) return;
      if (tty) params.callbacks.onData(normalizeCrlfBytes(chunk));
      else demuxer.push(chunk);
    });
    res.once('end', () => {
      if (!closed) {
        closed = true;
        params.callbacks.onExit(0, null);
      }
    });
    res.once('error', () => {
      if (!closed) {
        closed = true;
        params.callbacks.onError('docker_request_failed');
      }
    });
  });

  req.once('error', () => {
    if (!closed) {
      closed = true;
      params.callbacks.onError('docker_unavailable');
    }
  });
  req.end();

  return {
    label: `logs:${name}`,
    scope: detectTerminalScope(),
    hostLabel: name,
    readOnly: true,
    write: () => {},
    resize: () => {},
    pause: () => responseStream?.pause(),
    resume: () => responseStream?.resume(),
    kill: () => {
      if (closed) return;
      closed = true;
      req.destroy();
    },
  };
}

function startDockerExecUpgrade(
  socketPath: string,
  execId: string,
): Promise<{ socket: Socket; head: Buffer }> {
  const body = JSON.stringify({ Detach: false, Tty: true });
  const requestText = [
    `POST /v1.45/exec/${execId}/start HTTP/1.1`,
    'Host: docker',
    'Content-Type: application/json',
    'Connection: Upgrade',
    'Upgrade: tcp',
    `Content-Length: ${Buffer.byteLength(body, 'utf8')}`,
    '',
    body,
  ].join('\r\n');

  return new Promise((resolve, reject) => {
    const socket = unixConnect({ path: socketPath });
    let settled = false;
    let headerBuf: Buffer = Buffer.alloc(0);

    const timer = setTimeout(() => fail(Error('docker_request_timeout')), 8_000);
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
    const onError = () => fail(Error('docker_unavailable'));
    const onClose = () => fail(Error('docker_exec_closed'));

    const onData = (chunk: Buffer) => {
      headerBuf = headerBuf.length > 0 ? Buffer.concat([headerBuf, chunk]) : chunk;
      const idx = headerBuf.indexOf(HEADER_END);
      if (idx < 0) {
        if (headerBuf.length > MAX_HTTP_HEADER_BYTES) fail(Error('docker_request_failed'));
        return;
      }
      const statusLine = headerBuf.subarray(0, idx).toString('latin1').split('\r\n')[0] ?? '';
      if (!/^HTTP\/1\.1\s+101\b/.test(statusLine)) {
        fail(Error('docker_exec_start_failed'));
        return;
      }
      const head = Buffer.from(headerBuf.subarray(idx + HEADER_END.length));
      settled = true;
      detach();
      resolve({ socket, head });
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.once('connect', () => {
      if (!settled) socket.write(requestText);
    });
  });
}

/** Opens an interactive full-duplex PTY shell inside a running Docker container via Docker Engine API. */
export async function openDockerExecPty(params: {
  readonly socketPath: string;
  readonly containerId: string;
  readonly cols: number;
  readonly rows: number;
  readonly callbacks: TerminalSourceCallbacks;
}): Promise<TerminalStreamSource> {
  if (!CONTAINER_ID_RE.test(params.containerId)) throw Error('invalid_terminal_container_id');
  const inspect = await dockerJsonRequest<DockerInspectContainer>(
    params.socketPath,
    'GET',
    `/v1.45/containers/${params.containerId}/json`,
  );
  if (inspect.status === 404) throw Error('container_not_found');
  if (inspect.status < 200 || inspect.status >= 300) throw Error('docker_request_failed');
  if (!inspect.data?.State?.Running) throw Error('container_not_running');

  const name = inspect.data.Name?.replace(/^\/+/, '') || params.containerId.slice(0, 12);
  const created = await dockerJsonRequest<{ readonly Id?: string }>(
    params.socketPath,
    'POST',
    `/v1.45/containers/${params.containerId}/exec`,
    {
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Env: ['TERM=xterm-256color', 'COLORTERM=truecolor'],
      Cmd: CONTAINER_SHELL_CMD,
    },
  );
  const execId = created.data?.Id;
  if (created.status < 200 || created.status >= 300 || !execId || !EXEC_ID_RE.test(execId)) {
    throw Error('docker_exec_create_failed');
  }

  const { socket, head } = await startDockerExecUpgrade(params.socketPath, execId);
  let closed = false;

  const resizeExec = (cols: number, rows: number) => {
    if (closed) return;
    const w = Math.max(2, Math.min(500, Math.floor(cols)));
    const h = Math.max(1, Math.min(300, Math.floor(rows)));
    void dockerJsonRequest(
      params.socketPath,
      'POST',
      `/v1.45/exec/${execId}/resize?h=${h}&w=${w}`,
    ).catch(() => {});
  };
  resizeExec(params.cols, params.rows);

  const finishExit = () => {
    if (closed) return;
    closed = true;
    void dockerJsonRequest<{ readonly ExitCode?: number | null }>(
      params.socketPath,
      'GET',
      `/v1.45/exec/${execId}/json`,
    )
      .then((res) =>
        params.callbacks.onExit(
          typeof res.data?.ExitCode === 'number' ? res.data.ExitCode : 0,
          null,
        ),
      )
      .catch(() => params.callbacks.onExit(0, null));
  };

  socket.on('data', (chunk: Buffer) => {
    if (!closed && chunk.length > 0) params.callbacks.onData(chunk);
  });
  socket.once('end', finishExit);
  socket.once('close', finishExit);
  socket.once('error', () => {
    if (!closed) {
      closed = true;
      params.callbacks.onError('docker_exec_error');
    }
  });

  if (head.length > 0) {
    queueMicrotask(() => {
      if (!closed) params.callbacks.onData(head);
    });
  }

  return {
    label: `exec:${name}`,
    scope: 'container',
    hostLabel: `${name} (${hostname()})`,
    readOnly: false,
    write: (data) => {
      if (!closed && !socket.destroyed && socket.writable && data.byteLength > 0) {
        socket.write(data);
      }
    },
    resize: resizeExec,
    pause: () => socket.pause(),
    resume: () => socket.resume(),
    kill: () => {
      if (closed) return;
      closed = true;
      socket.destroy();
    },
  };
}
