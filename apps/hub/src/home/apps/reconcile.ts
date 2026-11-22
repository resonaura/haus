/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { AppManifest, AppObservation, DockerAppLifecycle } from '@haus/apps';
import type { InstalledAppEntry } from '../app-driver.js';
import type { StandaloneHomePersistence } from '../home.persistence.js';

export type ResolvedDockerContainer =
  | {
      readonly status: 'found';
      readonly containerId: string;
      readonly observation?: AppObservation;
    }
  | { readonly status: 'missing' }
  | { readonly status: 'ambiguous' };

function defaultPlatform(): string {
  return process.arch === 'x64' ? 'linux/amd64' : `linux/${process.arch}`;
}

/**
 * Reconciles an in-memory `InstalledAppEntry` against a live Docker `AppObservation`.
 * Detects running-state changes and image/version drift when the live container differs from
 * persisted metadata (for example after an interrupted or skipped update).
 */
export function applyObservationToAppEntry(
  entry: InstalledAppEntry,
  observation: AppObservation,
): boolean {
  let changed = false;

  const nextState: 'running' | 'stopped' = observation.state === 'running' ? 'running' : 'stopped';
  if (entry.state !== nextState) {
    entry.state = nextState;
    changed = true;
  }

  const observedVersion = observation.version?.trim();
  if (observedVersion && observedVersion !== entry.manifest.version) {
    const observedImage =
      observation.image && !observation.image.startsWith('sha256:')
        ? observation.image
        : entry.manifest.image;
    entry.manifest = {
      ...entry.manifest,
      version: observedVersion,
      image: observedImage,
    };
    changed = true;
  }

  if (observation.imageId && /^sha256:[a-f0-9]{64}$/i.test(observation.imageId)) {
    if (!entry.image || entry.image.imageId !== observation.imageId) {
      entry.image = {
        reference: observation.image || observation.imageId,
        imageId: observation.imageId,
        digest: observation.imageId,
        source: entry.image?.source ?? 'local',
        platform: entry.image?.platform ?? defaultPlatform(),
      };
      changed = true;
    }
  }

  return changed;
}

/**
 * Resolves the Docker container backing `entry`, recovering it by `io.haus.app=<id>` label
 * whenever `entry.containerId` was stripped (e.g. after standby replication or migration).
 */
export async function resolveDockerContainer(
  entry: InstalledAppEntry,
  lifecycle: DockerAppLifecycle,
  signal?: AbortSignal,
): Promise<ResolvedDockerContainer> {
  if (entry.containerId) {
    return { status: 'found', containerId: entry.containerId };
  }
  if (typeof lifecycle.findContainer !== 'function') {
    return { status: 'missing' };
  }
  const found = await lifecycle.findContainer(entry.manifest.id, signal, entry.manifest.image);
  if (found.state === 'ambiguous') return { status: 'ambiguous' };
  if (found.state === 'missing') return { status: 'missing' };

  entry.containerId = found.containerId;
  applyObservationToAppEntry(entry, found.observation);
  return { status: 'found', containerId: found.containerId, observation: found.observation };
}

/**
 * Adopts live Docker containers for all locally runnable Docker apps on startup, restoring
 * missing `containerId` links and reconciling live version/image drift before supervisor wiring.
 */
export async function reconcileDockerApps(params: {
  readonly installedApps: ReadonlyMap<string, InstalledAppEntry>;
  readonly lifecycle?: DockerAppLifecycle;
  readonly persistence: StandaloneHomePersistence;
  readonly runnableIds?: ReadonlySet<string>;
  readonly isRuntimeBridged: (manifest: AppManifest) => boolean;
}): Promise<void> {
  const { installedApps, lifecycle, persistence, runnableIds, isRuntimeBridged } = params;
  if (!lifecycle) return;

  for (const [appId, entry] of installedApps) {
    if (runnableIds && !runnableIds.has(appId)) continue;
    if (isRuntimeBridged(entry.manifest)) continue;

    if (entry.containerId) {
      try {
        const obs = await lifecycle.observe(entry.containerId);
        if (applyObservationToAppEntry(entry, obs)) {
          await persistence.save('app', appId, entry);
        }
        continue;
      } catch {
        // Fall through to label-based lookup; do not discard containerId if Docker is unreachable.
      }
    }

    if (typeof lifecycle.findContainer !== 'function') continue;
    try {
      const found = await lifecycle.findContainer(appId);
      if (found.state === 'running' || found.state === 'stopped') {
        const prevContainerId = entry.containerId;
        entry.containerId = found.containerId;
        const mutated = applyObservationToAppEntry(entry, found.observation);
        if (prevContainerId !== found.containerId || mutated) {
          await persistence.save('app', appId, entry);
        }
      } else if (found.state === 'missing' && entry.containerId) {
        entry.containerId = undefined;
        entry.state = 'stopped';
        await persistence.save('app', appId, entry);
      }
    } catch {
      // Docker daemon unavailable; retain persisted metadata until reachable.
    }
  }
}
