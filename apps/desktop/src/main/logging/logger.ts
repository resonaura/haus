/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  createHausLogger,
  formatLogError,
  type HausLogger,
  type HausLoggerOptions,
} from '@haus/core';

const EXPECTED_IPC_ERROR_PATTERNS: readonly RegExp[] = [
  /Install Haus to record camera events/i,
  /Start Haus to view your recordings/i,
  /This camera is not providing a snapshot right now/i,
  /\bcamera[_\s]not[_\s]found\b/i,
  /\bhue_(?:scene_)?diagnostics_unavailable\b/i,
  /\bhue_config_entry_not_found\b/i,
  /The connected home changed/i,
  /Connect to your Haus Hub first/i,
  /This operation was aborted/i,
  /\bAbortError\b/i,
  /\bhelper_unavailable\b/i,
  /\bnot_found\b/i,
];

const TRANSIENT_IPC_ERROR_PATTERNS: readonly RegExp[] = [
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /EHOSTUNREACH/i,
  /ENOTFOUND/i,
  /Could not reach the Haus Hub/i,
  /fetch failed/i,
  /timed out/i,
  /502:|503:|504:/,
];

export type IpcErrorSeverity = 'expected' | 'transient' | 'unexpected';

/** Classifies an IPC error so expected/transient states never spam the terminal. */
export function classifyIpcError(channel: string, error: unknown): IpcErrorSeverity {
  const summary = formatLogError(error);
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError') return 'expected';
  if (EXPECTED_IPC_ERROR_PATTERNS.some((pattern) => pattern.test(summary))) {
    return 'expected';
  }
  if (TRANSIENT_IPC_ERROR_PATTERNS.some((pattern) => pattern.test(summary))) {
    return 'transient';
  }
  if (channel === 'haus:camera-snapshot' && /snapshot|camera|offline|unavailable/i.test(summary)) {
    return 'expected';
  }
  return 'unexpected';
}

export function createDesktopLogger(moduleName: string, options?: HausLoggerOptions): HausLogger {
  return createHausLogger(moduleName, options);
}

const channelLoggerCache = new Map<string, HausLogger>();

function moduleForChannel(channel: string): string {
  if (channel.includes('helper')) return 'Helper';
  if (channel.includes('camera')) return 'Camera';
  if (channel.includes('management') || channel.includes('provider')) return 'HubConn';
  if (channel.includes('terminal') || channel.includes('ssh')) return 'SSH';
  if (channel.includes('discover')) return 'Discovery';
  if (channel.includes('sidebar')) return 'Sidebar';
  return 'IPC';
}

function getChannelLogger(channel: string): HausLogger {
  const moduleName = moduleForChannel(channel);
  let logger = channelLoggerCache.get(moduleName);
  if (!logger) {
    logger = createDesktopLogger(moduleName);
    channelLoggerCache.set(moduleName, logger);
  }
  return logger;
}

/** Logs an IPC handler error cleanly without Electron's noisy stack-trace dumps. */
export function logIpcError(channel: string, error: unknown, logger?: HausLogger): void {
  const target = logger ?? getChannelLogger(channel);
  const summary = formatLogError(error);
  const severity = classifyIpcError(channel, error);
  const shortChannel = channel.replace(/^haus:/, '');

  if (severity === 'expected') {
    target.debug(`${shortChannel}: ${summary}`);
    return;
  }
  if (severity === 'transient') {
    const throttleKey = `${shortChannel}:${summary.replace(/\d+\.\d+\.\d+\.\d+:\d+/, 'host').slice(0, 64)}`;
    target.warnThrottled(throttleKey, `${shortChannel}: ${summary}`, 15_000);
    return;
  }
  target.error(`${shortChannel}: ${summary}`);
}

export const desktopLog = createDesktopLogger('Desktop');
export const sidebarLog = createDesktopLogger('Sidebar');
export const hubConnLog = createDesktopLogger('HubConn');
export const helperLog = createDesktopLogger('Helper');
