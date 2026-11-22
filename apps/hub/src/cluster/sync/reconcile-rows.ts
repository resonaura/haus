/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { In, type EntityManager } from 'typeorm';
import { reconcileDeviceUserAssignments, type HausDevice } from '@haus/core';
import type { ClusterWorkloadRow } from '../../storage/cluster/entities.js';
import {
  StandaloneHomeEntryEntity,
  type StandaloneHomeEntryRow,
} from '../../storage/standalone/entities.js';
import { normalizeReplicatedAppValue } from './merge.js';

/**
 * Reconciles a replicated device JSON row against the local persisted device row so stale
 * peer availability/endpoint syncs never clobber newer user room assignments or renames.
 */
export function mergeReplicatedDeviceValue(
  incomingRaw: string,
  localRow: StandaloneHomeEntryRow | undefined,
  incomingUpdatedAt: number,
): { readonly value: string; readonly updatedAt: number; readonly preservedRoomId?: string } {
  if (!localRow) return { value: incomingRaw, updatedAt: incomingUpdatedAt };
  try {
    const incoming = JSON.parse(incomingRaw) as unknown;
    const local = JSON.parse(localRow.value) as unknown;
    if (
      !incoming ||
      typeof incoming !== 'object' ||
      Array.isArray(incoming) ||
      !local ||
      typeof local !== 'object' ||
      Array.isArray(local)
    ) {
      return { value: incomingRaw, updatedAt: incomingUpdatedAt };
    }
    const incomingDevice = incoming as HausDevice;
    const localDevice = local as HausDevice;
    const merged = reconcileDeviceUserAssignments(localDevice, incomingDevice);
    const preservedLocalEdit =
      merged.roomId !== incomingDevice.roomId || merged.name !== incomingDevice.name;
    if (!preservedLocalEdit) {
      return { value: incomingRaw, updatedAt: incomingUpdatedAt };
    }
    const preservedRoomId =
      merged.roomId && merged.roomId !== 'unassigned' && merged.roomId !== 'default'
        ? merged.roomId
        : undefined;
    return {
      value: JSON.stringify(merged),
      updatedAt: Math.max(incomingUpdatedAt, localRow.updatedAt),
      ...(preservedRoomId ? { preservedRoomId } : {}),
    };
  } catch {
    return { value: incomingRaw, updatedAt: incomingUpdatedAt };
  }
}

/** Loads local app/device rows and reconciles incoming config rows while protecting user edits. */
export async function normalizeReplicatedConfigEntries(params: {
  readonly manager: EntityManager;
  readonly entries: readonly StandaloneHomeEntryRow[];
  readonly allowedKinds: ReadonlySet<string>;
  readonly localHubId: string;
  readonly ownership: ReadonlyMap<string, ClusterWorkloadRow>;
}): Promise<{
  readonly normalizedRows: StandaloneHomeEntryRow[];
  readonly preservedRoomIds: Set<string>;
}> {
  const existingRows = await params.manager.find(StandaloneHomeEntryEntity, {
    where: { kind: In(['app', 'device']) },
  });
  const existingApps = new Map<string, Record<string, unknown>>();
  const existingDevices = new Map<string, StandaloneHomeEntryRow>();
  for (const row of existingRows) {
    if (row.kind === 'device') {
      existingDevices.set(row.entryId, row);
      continue;
    }
    try {
      const parsedLocal = JSON.parse(row.value) as unknown;
      if (parsedLocal && typeof parsedLocal === 'object' && !Array.isArray(parsedLocal)) {
        existingApps.set(row.entryId, parsedLocal as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed local row.
    }
  }

  const normalizedRows: StandaloneHomeEntryRow[] = [];
  const preservedRoomIds = new Set<string>();
  for (const entry of params.entries) {
    if (!params.allowedKinds.has(entry.kind)) continue;
    if (entry.kind === 'device') {
      const merged = mergeReplicatedDeviceValue(
        entry.value,
        existingDevices.get(entry.entryId),
        entry.updatedAt,
      );
      if (merged.preservedRoomId) preservedRoomIds.add(merged.preservedRoomId);
      normalizedRows.push({
        kind: entry.kind,
        entryId: entry.entryId,
        value: merged.value,
        updatedAt: merged.updatedAt,
      });
      continue;
    }
    const normalizedValue =
      entry.kind === 'app'
        ? normalizeReplicatedAppValue(
            entry.value,
            entry.entryId,
            params.localHubId,
            params.ownership,
            existingApps,
          )
        : entry.value;
    normalizedRows.push({
      kind: entry.kind,
      entryId: entry.entryId,
      value: normalizedValue,
      updatedAt: entry.updatedAt,
    });
  }
  return { normalizedRows, preservedRoomIds };
}

/** Records delivered bundle digests/timestamps while excluding rejected envelopes. */
export function recordPeerSyncDelivery(params: {
  readonly recipientHubId: string;
  readonly digests: ReadonlyArray<{ readonly syncKey: string; readonly sha256: string }>;
  readonly rejected: ReadonlyArray<{ readonly resourceId: string }>;
  readonly requestedKinds: readonly ('credential' | 'config' | 'cache')[];
  readonly includeHistory: boolean;
  readonly cacheStatesDigest?: string;
  readonly syncStartedAt: number;
  readonly peerLastSentDigest: Map<string, string>;
  readonly peerLastSentStatesDigest: Map<string, string>;
  readonly peerLastHistorySyncAt: Map<string, number>;
  readonly peerLastSyncedKindAt: Map<string, number>;
}): void {
  const rejectedKeys = new Set(params.rejected.map((item) => item.resourceId));
  for (const item of params.digests) {
    if (!rejectedKeys.has(item.syncKey)) {
      params.peerLastSentDigest.set(`${params.recipientHubId}:${item.syncKey}`, item.sha256);
    }
  }
  if (params.cacheStatesDigest && !rejectedKeys.has('cache:bundle')) {
    params.peerLastSentStatesDigest.set(params.recipientHubId, params.cacheStatesDigest);
  }
  if (
    params.includeHistory &&
    params.requestedKinds.includes('cache') &&
    !rejectedKeys.has('cache:bundle')
  ) {
    params.peerLastHistorySyncAt.set(params.recipientHubId, params.syncStartedAt);
  }
  for (const kind of params.requestedKinds) {
    if (!rejectedKeys.has(`${kind}:bundle`)) {
      params.peerLastSyncedKindAt.set(`${params.recipientHubId}:${kind}`, params.syncStartedAt);
    }
  }
}
