/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { getHausLogHistory, subscribeHausLogs } from '@haus/core';
import type { TerminalRuntimeScope, TerminalTarget } from '@haus/core/protocol';
import {
  normalizeCrlfBytes,
  openDockerAnsiLogs,
  openDockerExecPty,
  resolveDockerSocketPath,
} from './docker-stream.js';
import { detectTerminalScope, HubPtyProcess } from './pty.js';

export interface TerminalSourceCallbacks {
  readonly onData: (chunk: Buffer) => void;
  readonly onExit: (code: number | null, signal: string | null) => void;
  readonly onError: (reason: string) => void;
}

export interface TerminalStreamSource {
  readonly label: string;
  readonly scope: TerminalRuntimeScope;
  readonly hostLabel: string;
  readonly readOnly: boolean;
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(): void;
}

/** Neutral runtime descriptor for App-backed log/exec targets (avoids Hub/NestJS coupling). */
export interface TerminalAppRuntimeInfo {
  readonly externalId: string;
  readonly name: string;
  readonly containerId?: string;
  readonly logs?: readonly string[];
  readonly getLogs?: () => readonly string[];
  readonly subscribeLogs?: (onLine: (line: string) => void) => () => void;
}

export type TerminalAppRuntimeResolver = (
  actorId: string,
  appId: string,
) => Promise<TerminalAppRuntimeInfo | undefined>;

const ALLOWED_JOURNALCTL = ['/usr/bin/journalctl', '/bin/journalctl'] as const;
const ALLOWED_PM2 = ['/usr/local/bin/pm2', '/usr/bin/pm2', '/opt/homebrew/bin/pm2'] as const;
const MAX_QUEUED_LOG_LINES = 500;

function findBinary(candidates: readonly string[]): string | undefined {
  for (const bin of candidates) {
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

function lineToCrlfBuffer(line: string): Buffer {
  const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
  return Buffer.from(`${clean}\r\n`, 'utf8');
}

function openHubLogsSource(tail: number, callbacks: TerminalSourceCallbacks): TerminalStreamSource {
  let closed = false;
  let paused = false;
  const pending: Buffer[] = [];
  const emitOrQueue = (line: string) => {
    if (closed) return;
    const buf = lineToCrlfBuffer(line);
    if (paused) {
      pending.push(buf);
      if (pending.length > MAX_QUEUED_LOG_LINES) pending.shift();
      return;
    }
    callbacks.onData(buf);
  };

  const unsubscribe = subscribeHausLogs(emitOrQueue);
  const history = getHausLogHistory(tail);
  queueMicrotask(() => {
    if (closed) return;
    if (history.length > 0) {
      callbacks.onData(Buffer.from(`${history.join('\r\n')}\r\n`, 'utf8'));
    } else {
      callbacks.onData(
        Buffer.from(
          '\x1b[2mConnected to live Hub logs — waiting for new entries…\x1b[0m\r\n',
          'utf8',
        ),
      );
    }
  });

  return {
    label: 'hub-logs',
    scope: detectTerminalScope(),
    hostLabel: hostname(),
    readOnly: true,
    write: () => {},
    resize: () => {},
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      while (!closed && !paused && pending.length > 0) {
        const next = pending.shift();
        if (next) callbacks.onData(next);
      }
    },
    kill: () => {
      if (closed) return;
      closed = true;
      pending.length = 0;
      unsubscribe();
    },
  };
}

function openServiceLogsSource(
  manager: 'pm2' | 'systemd',
  rawServiceId: string,
  tail: number,
  callbacks: TerminalSourceCallbacks,
): TerminalStreamSource {
  const serviceId = rawServiceId.replace(/^(?:windows|wsl):/, '');
  if (!serviceId || serviceId.startsWith('-')) throw Error('invalid_terminal_service_id');
  const clampedTail = Math.max(1, Math.min(2000, Math.floor(tail)));

  let binary: string | undefined;
  let args: string[];
  let env: NodeJS.ProcessEnv;

  if (manager === 'systemd') {
    binary = findBinary(ALLOWED_JOURNALCTL);
    if (!binary) throw Error('service_logs_unavailable');
    args = ['-u', serviceId, '-n', String(clampedTail), '-f', '--output=short-iso', '--no-pager'];
    env = {
      TERM: 'xterm-256color',
      SYSTEMD_COLORS: '1',
      LANG: 'C.UTF-8',
      PATH: '/usr/bin:/bin',
    };
  } else {
    binary = findBinary(ALLOWED_PM2);
    if (!binary) throw Error('service_logs_unavailable');
    args = ['logs', serviceId, '--lines', String(clampedTail), '--raw'];
    env = {
      TERM: 'xterm-256color',
      FORCE_COLOR: '1',
      LANG: 'C.UTF-8',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    };
  }

  const child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false;
  const emit = (chunk: Buffer) => {
    if (!closed && chunk.length > 0) callbacks.onData(normalizeCrlfBytes(chunk));
  };
  child.stdout.on('data', emit);
  child.stderr.on('data', emit);
  child.once('error', () => {
    if (!closed) {
      closed = true;
      callbacks.onError('service_logs_unavailable');
    }
  });
  child.once('close', (code) => {
    if (!closed) {
      closed = true;
      callbacks.onExit(code, null);
    }
  });

  return {
    label: `${manager}:${serviceId}`,
    scope: detectTerminalScope(),
    hostLabel: hostname(),
    readOnly: true,
    write: () => {},
    resize: () => {},
    pause: () => {
      child.stdout.pause();
      child.stderr.pause();
    },
    resume: () => {
      child.stdout.resume();
      child.stderr.resume();
    },
    kill: () => {
      if (closed) return;
      closed = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore already-exited child.
      }
      setTimeout(() => {
        try {
          if (!child.killed) child.kill('SIGKILL');
        } catch {
          // Ignore already-exited child.
        }
      }, 800).unref();
    },
  };
}

async function openAppStreamSource(params: {
  readonly kind: 'app-logs' | 'app-exec';
  readonly appId: string;
  readonly tail: number;
  readonly cols: number;
  readonly rows: number;
  readonly actorId: string;
  readonly appResolver?: TerminalAppRuntimeResolver;
  readonly callbacks: TerminalSourceCallbacks;
}): Promise<TerminalStreamSource> {
  if (!params.appResolver) throw Error('app_not_found');
  const resolved = await params.appResolver(params.actorId, params.appId);
  if (!resolved) throw Error('app_not_found');

  if (params.kind === 'app-exec') {
    if (!resolved.containerId) throw Error('app_terminal_requires_container');
    return openDockerExecPty({
      socketPath: resolveDockerSocketPath(),
      containerId: resolved.containerId,
      cols: params.cols,
      rows: params.rows,
      callbacks: params.callbacks,
    });
  }

  if (resolved.containerId) {
    return openDockerAnsiLogs({
      socketPath: resolveDockerSocketPath(),
      containerId: resolved.containerId,
      tail: params.tail,
      callbacks: params.callbacks,
    });
  }

  let closed = false;
  let paused = false;
  const pending: Buffer[] = [];
  const emitOrQueue = (line: string) => {
    if (closed) return;
    const buf = lineToCrlfBuffer(line);
    if (paused) {
      pending.push(buf);
      if (pending.length > MAX_QUEUED_LOG_LINES) pending.shift();
      return;
    }
    params.callbacks.onData(buf);
  };

  const initial = [...(resolved.logs ?? []), ...(resolved.getLogs?.() ?? [])].slice(-params.tail);
  const unsub = resolved.subscribeLogs?.(emitOrQueue);
  queueMicrotask(() => {
    if (closed) return;
    if (initial.length > 0) {
      params.callbacks.onData(Buffer.from(`${initial.join('\r\n')}\r\n`, 'utf8'));
    } else {
      params.callbacks.onData(
        Buffer.from('\x1b[2mConnected to App logs — waiting for output…\x1b[0m\r\n', 'utf8'),
      );
    }
    if (!unsub) params.callbacks.onExit(0, null);
  });

  return {
    label: `app-logs:${resolved.externalId}`,
    scope: detectTerminalScope(),
    hostLabel: resolved.name,
    readOnly: true,
    write: () => {},
    resize: () => {},
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      while (!closed && !paused && pending.length > 0) {
        const next = pending.shift();
        if (next) params.callbacks.onData(next);
      }
    },
    kill: () => {
      if (closed) return;
      closed = true;
      pending.length = 0;
      unsub?.();
    },
  };
}

/** Opens the concrete stream source for any validated direct-IPC `TerminalTarget`. */
export async function openTerminalSource(params: {
  readonly target: TerminalTarget;
  readonly cols: number;
  readonly rows: number;
  readonly actorId: string;
  readonly appResolver?: TerminalAppRuntimeResolver;
  readonly callbacks: TerminalSourceCallbacks;
}): Promise<TerminalStreamSource> {
  const { target, cols, rows, callbacks } = params;
  switch (target.kind) {
    case 'shell': {
      const pty = new HubPtyProcess(cols, rows, callbacks);
      return {
        label: pty.shellName,
        scope: pty.scope,
        hostLabel: pty.hostLabel,
        readOnly: false,
        write: (data) => pty.write(data),
        resize: (c, r) => pty.resize(c, r),
        pause: () => pty.pause(),
        resume: () => pty.resume(),
        kill: () => pty.kill(),
      };
    }
    case 'hub-logs':
      return openHubLogsSource(target.tail ?? 500, callbacks);
    case 'docker-logs':
      return openDockerAnsiLogs({
        socketPath: resolveDockerSocketPath(),
        containerId: target.containerId,
        tail: target.tail ?? 500,
        callbacks,
      });
    case 'docker-exec':
      return openDockerExecPty({
        socketPath: resolveDockerSocketPath(),
        containerId: target.containerId,
        cols,
        rows,
        callbacks,
      });
    case 'service-logs':
      return openServiceLogsSource(target.manager, target.serviceId, target.tail ?? 400, callbacks);
    case 'app-logs':
    case 'app-exec':
      return openAppStreamSource({
        kind: target.kind,
        appId: target.appId,
        tail: target.kind === 'app-logs' ? (target.tail ?? 500) : 0,
        cols,
        rows,
        actorId: params.actorId,
        appResolver: params.appResolver,
        callbacks,
      });
  }
}
