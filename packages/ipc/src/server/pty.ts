/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TerminalRuntimeScope } from '@haus/core/protocol';

const FRAME_DATA = 1;
const FRAME_RESIZE = 2;
const FRAME_EXIT = 3;
const MAX_PTY_FRAME_BYTES = 131_072;

const ALLOWED_SHELLS = [
  '/usr/bin/bash',
  '/bin/bash',
  '/bin/zsh',
  '/usr/bin/zsh',
  '/bin/sh',
  '/usr/bin/sh',
] as const;

const ALLOWED_PYTHONS = [
  '/opt/ha-venv/bin/python',
  '/usr/bin/python3',
  '/usr/local/bin/python3',
  '/opt/homebrew/bin/python3',
] as const;

function resolvePythonBinary(): string {
  for (const candidate of ALLOWED_PYTHONS) {
    if (existsSync(candidate)) return candidate;
  }
  return 'python3';
}

function resolveShellBinary(): string {
  const configured = process.env.SHELL?.trim();
  if (
    configured &&
    (ALLOWED_SHELLS as readonly string[]).includes(configured) &&
    existsSync(configured)
  ) {
    return configured;
  }
  for (const candidate of ALLOWED_SHELLS) {
    if (existsSync(candidate)) return candidate;
  }
  throw Error('terminal_shell_unavailable');
}

function resolvePtyBridgePath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const adjacent = join(currentDir, 'pty-bridge.py');
  if (existsSync(adjacent)) return adjacent;
  const srcFallback = join(currentDir, '..', '..', 'src', 'server', 'pty-bridge.py');
  if (existsSync(srcFallback)) return srcFallback;
  throw Error('terminal_pty_bridge_missing');
}

function resolveSafeHome(): string {
  try {
    const dir = homedir();
    if (dir && existsSync(dir)) return dir;
  } catch {
    // Fall back to /data or root.
  }
  return existsSync('/data') ? '/data' : '/';
}

/**
 * Constructs a strictly allowlisted shell environment so Hub secrets
 * (DATABASE_URL, HAUS_API_TOKEN, PGPASSWORD, master keys, etc.) are never exposed to PTY shells.
 */
export function buildSanitizedTerminalEnv(shellPath: string, safeHome: string): NodeJS.ProcessEnv {
  let user = 'node';
  try {
    user = userInfo().username || 'node';
  } catch {
    user = process.env.USER || 'node';
  }
  const safePath =
    process.env.PATH && process.env.PATH.length <= 2048
      ? process.env.PATH
      : '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  const lang =
    typeof process.env.LANG === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(process.env.LANG)
      ? process.env.LANG
      : 'C.UTF-8';
  return {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: lang,
    PATH: safePath,
    HOME: safeHome,
    USER: user,
    LOGNAME: user,
    SHELL: shellPath,
    HOSTNAME: hostname(),
  };
}

export function detectTerminalScope(): TerminalRuntimeScope {
  if (process.env.HAUS_CONTAINER === '1' || existsSync('/.dockerenv')) {
    return 'container';
  }
  return 'host';
}

export interface HubPtyCallbacks {
  readonly onData: (chunk: Buffer) => void;
  readonly onExit: (code: number | null, signal: string | null) => void;
  readonly onError: (reason: string) => void;
}

export class HubPtyProcess {
  readonly shellName: string;
  readonly scope: TerminalRuntimeScope;
  readonly hostLabel: string;
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer: Buffer = Buffer.alloc(0);
  private exited = false;
  private closed = false;

  constructor(
    cols: number,
    rows: number,
    private readonly callbacks: HubPtyCallbacks,
  ) {
    if (process.platform === 'win32') {
      throw Error('terminal_platform_unsupported');
    }
    const shellPath = resolveShellBinary();
    const pythonPath = resolvePythonBinary();
    const bridgePath = resolvePtyBridgePath();
    const safeHome = resolveSafeHome();
    const env = buildSanitizedTerminalEnv(shellPath, safeHome);

    this.shellName = basename(shellPath);
    this.scope = detectTerminalScope();
    this.hostLabel = hostname();

    this.child = spawn(
      pythonPath,
      ['-I', '-u', bridgePath, shellPath, String(cols), String(rows)],
      {
        cwd: safeHome,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    this.child.stdout.on('data', (chunk: Buffer) => this.consumeStdout(chunk));
    this.child.stderr.on('data', () => {
      // Discard helper stderr so internal paths/tracebacks never leak over the terminal channel.
    });
    this.child.once('error', () => {
      if (this.closed) return;
      this.closed = true;
      this.callbacks.onError('terminal_spawn_failed');
    });
    this.child.once('close', (code) => {
      if (this.closed) return;
      this.closed = true;
      if (!this.exited) {
        this.exited = true;
        this.callbacks.onExit(code, null);
      }
    });
  }

  private consumeStdout(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length >= 5) {
      const frameType = this.buffer.readUInt8(0);
      const length = this.buffer.readUInt32BE(1);
      if (length > MAX_PTY_FRAME_BYTES) {
        this.kill();
        this.callbacks.onError('terminal_pty_protocol_error');
        return;
      }
      if (this.buffer.length < 5 + length) break;
      const payload = this.buffer.subarray(5, 5 + length);
      this.buffer = this.buffer.subarray(5 + length);
      if (frameType === FRAME_DATA && payload.length > 0) {
        this.callbacks.onData(payload);
      } else if (frameType === FRAME_EXIT && payload.length >= 5) {
        const code = payload.readInt32BE(0);
        const sigLen = payload.readUInt8(4);
        const sig =
          sigLen > 0 && payload.length >= 5 + sigLen
            ? payload.subarray(5, 5 + sigLen).toString('utf8')
            : null;
        this.exited = true;
        this.callbacks.onExit(code >= 0 ? code : null, sig);
      }
    }
  }

  private sendFrame(frameType: number, payload: Uint8Array): void {
    if (this.closed || this.child.stdin.destroyed) return;
    const frame = Buffer.allocUnsafe(5 + payload.byteLength);
    frame.writeUInt8(frameType, 0);
    frame.writeUInt32BE(payload.byteLength, 1);
    frame.set(payload, 5);
    this.child.stdin.write(frame);
  }

  write(data: Uint8Array): void {
    if (data.byteLength === 0) return;
    this.sendFrame(FRAME_DATA, data);
  }

  resize(cols: number, rows: number): void {
    const payload = Buffer.alloc(4);
    payload.writeUInt16BE(rows, 0);
    payload.writeUInt16BE(cols, 2);
    this.sendFrame(FRAME_RESIZE, payload);
  }

  pause(): void {
    if (!this.closed) this.child.stdout.pause();
  }

  resume(): void {
    if (!this.closed) this.child.stdout.resume();
  }

  kill(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.child.stdin.end();
    } catch {
      // Ignore already-closed stdin.
    }
    try {
      this.child.kill('SIGTERM');
    } catch {
      // Ignore already-exited child.
    }
    setTimeout(() => {
      try {
        if (!this.child.killed) this.child.kill('SIGKILL');
      } catch {
        // Ignore already-exited child.
      }
    }, 1000).unref();
  }
}
