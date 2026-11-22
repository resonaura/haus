/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type HausLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface HausLoggerSink {
  write(level: Exclude<HausLogLevel, 'silent'>, line: string): void;
}

export interface HausLoggerOptions {
  readonly level?: HausLogLevel;
  readonly color?: boolean;
  readonly sink?: HausLoggerSink;
  readonly now?: () => Date;
  readonly moduleWidth?: number;
}

export interface HausLogger {
  readonly module: string;
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
  warnThrottled(key: string, message: string, windowMs?: number, detail?: unknown): void;
  child(subModule: string): HausLogger;
}

const LEVEL_PRIORITY: Readonly<Record<HausLogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const LEVEL_BADGE: Readonly<
  Record<Exclude<HausLogLevel, 'silent'>, { readonly tag: string; readonly color: string }>
> = {
  debug: { tag: 'DBG', color: '\x1b[38;5;245m' },
  info: { tag: 'INF', color: '\x1b[38;5;78m' },
  warn: { tag: 'WRN', color: '\x1b[38;5;221m' },
  error: { tag: 'ERR', color: '\x1b[38;5;203m' },
};

/** Curated distinct 256-color ANSI palette per Haus module (legible on dark & light terminals). */
const MODULE_COLOR_PALETTE: Readonly<Record<string, string>> = {
  Hub: '\x1b[38;5;45m',
  Bootstrap: '\x1b[38;5;45m',
  Desktop: '\x1b[38;5;45m',
  Home: '\x1b[38;5;42m',
  Devices: '\x1b[38;5;42m',
  Rooms: '\x1b[38;5;77m',
  Live: '\x1b[38;5;75m',
  WS: '\x1b[38;5;75m',
  HTTP: '\x1b[38;5;110m',
  MQTT: '\x1b[38;5;141m',
  Kitsune: '\x1b[38;5;208m',
  HAFlow: '\x1b[38;5;209m',
  Tuya: '\x1b[38;5;203m',
  Camera: '\x1b[38;5;212m',
  Media: '\x1b[38;5;213m',
  NVR: '\x1b[38;5;205m',
  Cluster: '\x1b[38;5;44m',
  Sync: '\x1b[38;5;51m',
  Lease: '\x1b[38;5;80m',
  Helper: '\x1b[38;5;220m',
  HubConn: '\x1b[38;5;39m',
  IPC: '\x1b[38;5;147m',
  Auth: '\x1b[38;5;214m',
  Pairing: '\x1b[38;5;215m',
  Storage: '\x1b[38;5;111m',
  HomeKit: '\x1b[38;5;114m',
  Matter: '\x1b[38;5;115m',
  Zigbee: '\x1b[38;5;149m',
  Thread: '\x1b[38;5;120m',
  BLE: '\x1b[38;5;69m',
  Rules: '\x1b[38;5;216m',
  Scenes: '\x1b[38;5;217m',
  Providers: '\x1b[38;5;81m',
  Sidebar: '\x1b[38;5;183m',
  Discovery: '\x1b[38;5;87m',
  Backup: '\x1b[38;5;179m',
  Stats: '\x1b[38;5;152m',
  Nest: '\x1b[38;5;244m',
};

const FALLBACK_COLORS: readonly string[] = [
  '\x1b[38;5;39m',
  '\x1b[38;5;42m',
  '\x1b[38;5;45m',
  '\x1b[38;5;75m',
  '\x1b[38;5;81m',
  '\x1b[38;5;114m',
  '\x1b[38;5;141m',
  '\x1b[38;5;147m',
  '\x1b[38;5;179m',
  '\x1b[38;5;183m',
  '\x1b[38;5;208m',
  '\x1b[38;5;212m',
  '\x1b[38;5;214m',
  '\x1b[38;5;216m',
  '\x1b[38;5;220m',
];

function readEnv(key: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[key];
}

function defaultColorEnabled(): boolean {
  const explicit = readEnv('HAUS_LOG_COLOR')?.trim().toLowerCase();
  if (explicit === '0' || explicit === 'false' || explicit === 'never') return false;
  if (explicit === '1' || explicit === 'true' || explicit === 'always') return true;
  if (readEnv('NO_COLOR') !== undefined) return false;
  if (readEnv('FORCE_COLOR') && readEnv('FORCE_COLOR') !== '0') return true;
  if (readEnv('VITEST') !== undefined) return false;
  const term = readEnv('TERM')?.toLowerCase();
  if (term === 'dumb') return false;
  return true;
}

function defaultLogLevel(): HausLogLevel {
  const raw = readEnv('HAUS_LOG_LEVEL')?.trim().toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'silent') {
    return raw;
  }
  return 'info';
}

/** Picks a deterministic, legible ANSI color code for any module name. */
export function moduleAnsiColor(moduleName: string): string {
  const direct = MODULE_COLOR_PALETTE[moduleName];
  if (direct) return direct;
  const root = moduleName.split(':')[0] ?? moduleName;
  if (MODULE_COLOR_PALETTE[root]) return MODULE_COLOR_PALETTE[root]!;
  let hash = 2166136261;
  for (let i = 0; i < moduleName.length; i += 1) {
    hash ^= moduleName.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length]!;
}

/** Strips sensitive credentials, bearer tokens, cookies, and keys from log text. */
export function redactLogText(input: string): string {
  return input
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]')
    .replace(
      /\b(token|password|passwd|secret|local_key|access_token|refresh_token|ingress_session|authorization)\s*([=:])\s*(?:"[^"]*"|'[^']*'|[^\s,;&)}]+)/gi,
      '$1$2[redacted]',
    )
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function readErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('code' in value)) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : undefined;
}

/** Formats an arbitrary error/unknown value into a compact single-line summary. */
export function formatLogError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const code = readErrorCode(error) ?? readErrorCode(cause);
    const base = error.message || error.name || 'Error';
    const causeMessage =
      cause instanceof Error && cause.message && !base.includes(cause.message)
        ? cause.message
        : undefined;
    const parts = [base];
    if (causeMessage) parts.push(causeMessage);
    else if (code && !base.includes(code)) parts.push(`(${code})`);
    return redactLogText(parts.join(' — '));
  }
  if (typeof error === 'string') return redactLogText(error);
  try {
    return redactLogText(JSON.stringify(error));
  } catch {
    return redactLogText(String(error));
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function pad3(n: number): string {
  return n < 10 ? `00${n}` : n < 100 ? `0${n}` : `${n}`;
}

function formatTimestamp(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
}

/** Formats one unified Haus log line with optional ANSI colors per level & module. */
export function formatHausLogLine(params: {
  readonly level: Exclude<HausLogLevel, 'silent'>;
  readonly module: string;
  readonly message: string;
  readonly detail?: unknown;
  readonly color?: boolean;
  readonly now?: Date;
  readonly moduleWidth?: number;
}): string {
  const time = formatTimestamp(params.now ?? new Date());
  const badge = LEVEL_BADGE[params.level];
  const width = params.moduleWidth ?? 11;
  const bracketed = `[${params.module}]`;
  const paddedModule =
    bracketed.length < width ? `${bracketed}${' '.repeat(width - bracketed.length)}` : bracketed;
  const cleanMessage = redactLogText(params.message);
  const detailText =
    params.detail !== undefined && params.detail !== null && params.detail !== ''
      ? formatLogError(params.detail)
      : '';
  const body = detailText
    ? cleanMessage
      ? `${cleanMessage} — ${detailText}`
      : detailText
    : cleanMessage;

  if (params.color === false) {
    return `${time}  ${badge.tag}  ${paddedModule}  ${body}`;
  }
  const modColor = moduleAnsiColor(params.module);
  const bodyColor =
    params.level === 'error'
      ? '\x1b[38;5;210m'
      : params.level === 'warn'
        ? '\x1b[38;5;223m'
        : params.level === 'debug'
          ? DIM
          : '';
  const bodyEnd = bodyColor ? RESET : '';
  return `${DIM}${time}${RESET}  ${BOLD}${badge.color}${badge.tag}${RESET}  ${BOLD}${modColor}${paddedModule}${RESET}  ${bodyColor}${body}${bodyEnd}`;
}

const MAX_LOG_HISTORY_LINES = 1500;
const logHistory: string[] = [];
const logListeners = new Set<(line: string) => void>();

function recordLogLine(coloredLine: string): void {
  logHistory.push(coloredLine);
  if (logHistory.length > MAX_LOG_HISTORY_LINES) {
    logHistory.splice(0, logHistory.length - MAX_LOG_HISTORY_LINES);
  }
  for (const listener of logListeners) {
    try {
      listener(coloredLine);
    } catch {
      // Never let a log subscriber disrupt logging.
    }
  }
}

/** Returns up to `tail` recent ANSI-colored Hub log lines from the in-memory ring buffer. */
export function getHausLogHistory(tail = 500): readonly string[] {
  const count = Math.max(1, Math.min(MAX_LOG_HISTORY_LINES, Math.floor(tail)));
  return logHistory.slice(-count);
}

/** Subscribes to live ANSI-colored Hub log lines. Returns an unsubscribe function. */
export function subscribeHausLogs(listener: (line: string) => void): () => void {
  logListeners.add(listener);
  return () => {
    logListeners.delete(listener);
  };
}

const defaultSink: HausLoggerSink = {
  write(level, line) {
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  },
};

/** Creates a unified, ANSI-colored per-module Haus logger with built-in redaction and throttling. */
export function createHausLogger(moduleName: string, options: HausLoggerOptions = {}): HausLogger {
  const sink = options.sink ?? defaultSink;
  const nowFn = options.now ?? (() => new Date());
  const moduleWidth = options.moduleWidth ?? 11;
  const throttled = new Map<string, number>();

  const emit = (
    level: Exclude<HausLogLevel, 'silent'>,
    message: string,
    detail?: unknown,
  ): void => {
    const minLevel = options.level ?? defaultLogLevel();
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;
    const color = options.color ?? defaultColorEnabled();
    const now = nowFn();
    const line = formatHausLogLine({
      level,
      module: moduleName,
      message,
      detail,
      color,
      now,
      moduleWidth,
    });
    sink.write(level, line);
    if (!options.sink) {
      const ansiLine = color
        ? line
        : formatHausLogLine({
            level,
            module: moduleName,
            message,
            detail,
            color: true,
            now,
            moduleWidth,
          });
      recordLogLine(ansiLine);
    }
  };

  return {
    module: moduleName,
    debug: (message, detail) => emit('debug', message, detail),
    info: (message, detail) => emit('info', message, detail),
    warn: (message, detail) => emit('warn', message, detail),
    error: (message, detail) => emit('error', message, detail),
    warnThrottled: (key, message, windowMs = 15_000, detail) => {
      const now = nowFn().getTime();
      const last = throttled.get(key) ?? -Infinity;
      if (now - last < windowMs) return;
      throttled.set(key, now);
      if (throttled.size > 200) {
        const cutoff = now - windowMs * 2;
        for (const [k, ts] of throttled) {
          if (ts < cutoff) throttled.delete(k);
        }
      }
      emit('warn', message, detail);
    },
    child: (subModule) => createHausLogger(`${moduleName}:${subModule}`, options),
  };
}
