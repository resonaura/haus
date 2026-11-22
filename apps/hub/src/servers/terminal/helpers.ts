/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { TerminalAppRuntimeResolver } from '@haus/ipc/server';
import type { StandaloneHomeService } from '../../home/home.service.js';

export function readUpgradeHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return typeof value === 'string'
    ? value.trim()
    : Array.isArray(value)
      ? value[0]?.trim()
      : undefined;
}

export function rejectUpgradeResponse(socket: Duplex, status: number, label: string): void {
  try {
    socket.end(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\n\r\n`);
  } catch {
    socket.destroy();
  }
}

export function createHubAppRuntimeResolver(
  homeService?: StandaloneHomeService,
): TerminalAppRuntimeResolver {
  return async (actorId, appId) => {
    const resolved = await homeService?.appManager.resolveAppRuntime(actorId, appId);
    if (!resolved) return undefined;
    const bridge = resolved.bridge;
    return {
      externalId: resolved.externalId,
      name: resolved.entry.manifest.name,
      containerId: resolved.containerId,
      logs: resolved.entry.logs,
      getLogs: bridge?.getLogs ? () => bridge.getLogs!(resolved.externalId) ?? [] : undefined,
      subscribeLogs: bridge?.subscribeLogs
        ? (onLine) => bridge.subscribeLogs!(resolved.externalId, onLine)
        : undefined,
    };
  };
}
