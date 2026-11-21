/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { AppManifest, DockerAppLifecycle } from '@haus/apps';
import type { InstalledAppEntry, StandaloneRuntimeBridge } from '../app-driver.js';
import { resolveDockerContainer } from './reconcile.js';

/**
 * Streams real-time logs for an installed Haus App — either live stdout/stderr from a Docker
 * container (`follow=1`) or live buffered + streaming events from a runtime bridge (Homebridge).
 */
export async function streamInstalledAppLogs(params: {
  readonly entry: InstalledAppEntry;
  readonly lifecycle?: DockerAppLifecycle;
  readonly bridge?: StandaloneRuntimeBridge;
  readonly tail: number;
  readonly onLine: (line: string) => void;
  readonly signal: AbortSignal;
}): Promise<void> {
  const { entry, lifecycle, bridge, tail, onLine, signal } = params;
  const appId = entry.manifest.id;

  if (bridge) {
    const initial = [...entry.logs, ...(bridge.getLogs?.(appId) ?? [])];
    for (const line of initial.slice(-tail)) {
      if (signal.aborted) return;
      onLine(line);
    }
    if (!bridge.subscribeLogs) return;
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const unsub = bridge.subscribeLogs!(appId, (line) => {
        if (!signal.aborted) onLine(line);
      });
      signal.addEventListener(
        'abort',
        () => {
          unsub();
          resolve();
        },
        { once: true },
      );
    });
    return;
  }

  if (!lifecycle) {
    for (const line of entry.logs.slice(-tail)) {
      if (signal.aborted) return;
      onLine(line);
    }
    return;
  }

  const resolved = await resolveDockerContainer(entry, lifecycle, signal);
  if (resolved.status !== 'found') {
    for (const line of entry.logs.slice(-tail)) {
      if (signal.aborted) return;
      onLine(line);
    }
    return;
  }

  await lifecycle.streamLogs(resolved.containerId, { tail, timestamps: true }, onLine, signal);
}

export type ResolveAppBridgeFn = (
  manifest: Pick<AppManifest, 'id'> & Partial<Pick<AppManifest, 'image'>>,
) => StandaloneRuntimeBridge | undefined;
