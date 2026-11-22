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

export interface ResolvedAppRuntime {
  readonly externalId: string;
  readonly entry: InstalledAppEntry;
  readonly containerId?: string;
  readonly bridge?: StandaloneRuntimeBridge;
}

/** Resolves an installed App's backing Docker container ID or in-process runtime bridge. */
export async function resolveInstalledAppRuntime(params: {
  readonly appId: string;
  readonly installedApps: ReadonlyMap<string, InstalledAppEntry>;
  readonly findByInventory: () => Promise<string | undefined>;
  readonly findBridge: ResolveAppBridgeFn;
  readonly lifecycle?: DockerAppLifecycle;
  readonly signal?: AbortSignal;
}): Promise<ResolvedAppRuntime | undefined> {
  let externalId = params.appId;
  let entry = params.installedApps.get(params.appId);
  if (!entry) {
    const mapped = await params.findByInventory();
    if (mapped) {
      externalId = mapped;
      entry = params.installedApps.get(mapped);
    }
  }
  if (!entry) return undefined;
  const bridge = params.findBridge(entry.manifest);
  if (bridge || !params.lifecycle) return { externalId, entry, bridge };
  const resolved = await resolveDockerContainer(entry, params.lifecycle, params.signal);
  return {
    externalId,
    entry,
    ...(resolved.status === 'found' ? { containerId: resolved.containerId } : {}),
  };
}
