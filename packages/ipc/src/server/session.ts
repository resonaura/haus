/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Duplex } from 'node:stream';
import { createHausLogger } from '@haus/core';
import { TERMINAL_IDLE_TIMEOUT_MS, type TerminalTarget } from '@haus/core/protocol';
import type { TerminalCryptoSession } from '../crypto.js';
import {
  configureLowLatencySocket,
  IPC_UPGRADE_ACCEPT_BUFFER,
  RawIpcFrameReader,
} from '../transport.js';
import {
  openTerminalSource,
  type TerminalAppRuntimeResolver,
  type TerminalStreamSource,
} from './sources.js';

const PAUSE_WATERMARK_BYTES = 512 * 1024;
const RESUME_WATERMARK_BYTES = 128 * 1024;
const SOCKET_BACKPRESSURE_PAUSE_BYTES = 512 * 1024;
const SOCKET_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const HEARTBEAT_MS = 15_000;
const AUTH_RECHECK_MS = 10_000;

export interface ActiveLocalTerminalSession {
  readonly id: string;
  readonly adminSessionId?: string;
  readonly close: (reason?: string) => void;
}

export function startLocalTerminalSession(params: {
  readonly socket: Duplex;
  readonly head: Buffer;
  readonly ticketId: string;
  readonly actorId: string;
  readonly target: TerminalTarget;
  readonly cols: number;
  readonly rows: number;
  readonly crypto: TerminalCryptoSession;
  readonly appResolver?: TerminalAppRuntimeResolver;
  readonly adminSessionId?: string;
  readonly peerHubId?: string;
  readonly checkAuthorized: () => Promise<boolean>;
  readonly onClosed: () => void;
}): ActiveLocalTerminalSession {
  const logger = createHausLogger('Terminal');
  const {
    socket,
    head,
    ticketId: id,
    target,
    cols,
    rows,
    crypto,
    adminSessionId,
    peerHubId,
  } = params;
  configureLowLatencySocket(socket);

  let closed = false;
  let alive = true;
  let pingCounter = 0;
  let lastActivity = Date.now();
  let outstanding = 0;
  let sourcePaused = false;
  let readySent = false;
  let source: TerminalStreamSource | undefined;
  const reader = new RawIpcFrameReader();
  const earlyChunks: Buffer[] = head.length > 0 ? [head] : [];
  const earlyOutboundData: Buffer[] = [];
  let earlyExit: { readonly code: number | null; readonly signal: string | null } | undefined;
  let earlyError: string | undefined;

  const updateBackpressure = () => {
    if (!source || closed) return;
    const shouldPause =
      outstanding >= PAUSE_WATERMARK_BYTES ||
      socket.writableLength >= SOCKET_BACKPRESSURE_PAUSE_BYTES;
    const shouldResume =
      outstanding < RESUME_WATERMARK_BYTES && socket.writableLength < RESUME_WATERMARK_BYTES;
    if (shouldPause && !sourcePaused) {
      sourcePaused = true;
      source.pause();
    } else if (shouldResume && sourcePaused) {
      sourcePaused = false;
      source.resume();
    }
  };

  const cleanup = (reason = 'closed') => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(authRecheck);
    reader.reset();
    earlyChunks.length = 0;
    earlyOutboundData.length = 0;
    source?.kill();
    crypto.destroy();
    try {
      if (!socket.destroyed) socket.destroy();
    } catch {
      // Ignore already-destroyed socket.
    }
    params.onClosed();
    logger.info(`Closed direct IPC session ${id.slice(0, 12)} (${target.kind}: ${reason})`);
  };

  const sendEncrypted = (
    frame: Parameters<TerminalCryptoSession['sealServer']>[0],
    prefix?: Buffer,
  ) => {
    if (closed || socket.destroyed || !socket.writable) return;
    if (socket.writableLength > SOCKET_MAX_BUFFERED_BYTES) {
      cleanup('backpressure_exceeded');
      return;
    }
    try {
      const wire = crypto.sealServer(frame);
      socket.write(prefix ? Buffer.concat([prefix, wire]) : wire);
      updateBackpressure();
    } catch {
      cleanup('encryption_error');
    }
  };

  const heartbeat = setInterval(() => {
    if (closed || !source) return;
    if (Date.now() - lastActivity > TERMINAL_IDLE_TIMEOUT_MS) {
      cleanup('idle_timeout');
      return;
    }
    if (!alive) {
      cleanup('heartbeat_timeout');
      return;
    }
    alive = false;
    pingCounter = (pingCounter + 1) >>> 0;
    sendEncrypted({ t: 'ping', n: pingCounter });
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const authRecheck = setInterval(() => {
    if (closed) return;
    void params
      .checkAuthorized()
      .then((valid) => {
        if (!valid && !closed) cleanup('authorization_revoked');
      })
      .catch(() => {
        if (!closed) cleanup('authorization_check_failed');
      });
  }, AUTH_RECHECK_MS);
  authRecheck.unref();

  const handleEnvelope = (envelope: Buffer) => {
    if (closed || !source) return;
    let msg;
    try {
      msg = crypto.openClient(envelope);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'frame_invalid';
      logger.warn(`Closing terminal ${id.slice(0, 12)}: ${reason}`);
      cleanup(reason);
      return;
    }
    alive = true;
    lastActivity = Date.now();
    if (msg.t === 'data') {
      if (!source.readOnly) source.write(msg.d);
    } else if (msg.t === 'resize') {
      if (!source.readOnly) source.resize(msg.cols, msg.rows);
    } else if (msg.t === 'ack') {
      outstanding = Math.max(0, outstanding - msg.bytes);
      updateBackpressure();
    } else if (msg.t === 'ping') {
      sendEncrypted({ t: 'pong', n: msg.n });
    } else if (msg.t === 'pong') {
      alive = true;
    } else if (msg.t === 'close') {
      cleanup('client_closed');
    }
  };

  const onSocketData = (chunk: Buffer) => {
    if (closed) return;
    if (!source) {
      earlyChunks.push(chunk);
      return;
    }
    try {
      reader.push(chunk, handleEnvelope);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'framing_error';
      logger.warn(`Closing terminal ${id.slice(0, 12)}: ${reason}`);
      cleanup(reason);
    }
  };

  socket.on('drain', updateBackpressure);
  socket.on('data', onSocketData);
  socket.once('close', () => cleanup('socket_closed'));
  socket.once('end', () => cleanup('socket_ended'));
  socket.once('error', () => cleanup('socket_error'));

  const emitData = (chunk: Buffer) => {
    if (closed || chunk.length === 0) return;
    if (!readySent) {
      earlyOutboundData.push(chunk);
      return;
    }
    lastActivity = Date.now();
    outstanding += chunk.length;
    sendEncrypted({ t: 'data', d: chunk });
  };
  const emitExit = (code: number | null, signal: string | null) => {
    if (closed) return;
    if (!readySent) {
      earlyExit = { code, signal };
      return;
    }
    sendEncrypted({ t: 'exit', code, signal });
    setTimeout(() => cleanup('source_exited'), 50).unref();
  };
  const emitError = (reason: string) => {
    if (closed) return;
    if (!readySent) {
      earlyError = reason;
      return;
    }
    sendEncrypted({ t: 'error', code: reason });
    setTimeout(() => cleanup(reason), 50).unref();
  };

  void openTerminalSource({
    target,
    cols,
    rows,
    actorId: params.actorId,
    appResolver: params.appResolver,
    callbacks: { onData: emitData, onExit: emitExit, onError: emitError },
  })
    .then((opened) => {
      if (closed) {
        opened.kill();
        return;
      }
      source = opened;
      sendEncrypted(
        {
          t: 'ready',
          cols,
          rows,
          shell: opened.label,
          scope: opened.scope,
          hostname: opened.hostLabel,
          ...(opened.readOnly ? { readOnly: true } : {}),
        },
        IPC_UPGRADE_ACCEPT_BUFFER,
      );
      readySent = true;
      while (!closed && earlyOutboundData.length > 0) {
        const chunk = earlyOutboundData.shift();
        if (chunk) emitData(chunk);
      }
      logger.info(
        `Opened direct E2EE IPC ${target.kind} ${id.slice(0, 12)} (${opened.scope}/${opened.label}${peerHubId ? ` via peer ${peerHubId}` : ''})`,
      );
      if (earlyError) {
        emitError(earlyError);
        return;
      }
      if (earlyExit) {
        emitExit(earlyExit.code, earlyExit.signal);
        return;
      }
      while (!closed && earlyChunks.length > 0) {
        const next = earlyChunks.shift();
        if (next) onSocketData(next);
      }
    })
    .catch((error: unknown) => {
      if (closed) return;
      const code = error instanceof Error ? error.message : 'terminal_spawn_failed';
      sendEncrypted({ t: 'error', code }, IPC_UPGRADE_ACCEPT_BUFFER);
      setTimeout(() => cleanup(code), 50).unref();
    });

  return { id, adminSessionId, close: cleanup };
}
