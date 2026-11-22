/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { In, type EntityManager } from 'typeorm';
import { StandaloneHomeEntryEntity, type StandaloneHomeEntryRow } from './entities.js';

export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const TOMBSTONED_CONFIG_KINDS = new Set([
  'room',
  'device',
  'device_alias',
  'scene',
  'script',
  'automation',
  'app',
  'ignored_matter_node',
  'integration_entry',
  'repair_issue',
]);

export async function clearConfigTombstones(
  manager: EntityManager,
  rows: readonly StandaloneHomeEntryRow[],
): Promise<void> {
  const keys = rows
    .filter((row) => TOMBSTONED_CONFIG_KINDS.has(row.kind))
    .map((row) => `${row.kind}:${row.entryId}`);
  if (keys.length === 0) return;
  await manager.delete(StandaloneHomeEntryEntity, {
    kind: 'config_tombstone',
    entryId: In(keys),
  });
}

export async function recordConfigTombstone(
  manager: EntityManager,
  kind: string,
  entryId: string,
  deletedAt = Date.now(),
): Promise<void> {
  if (!TOMBSTONED_CONFIG_KINDS.has(kind)) return;
  await manager.upsert(
    StandaloneHomeEntryEntity,
    {
      kind: 'config_tombstone',
      entryId: `${kind}:${entryId}`,
      value: JSON.stringify({ kind, entryId, deletedAt }),
      updatedAt: deletedAt,
    },
    ['kind', 'entryId'],
  );
}

/**
 * Merges incoming deletion tombstones with local ones (LWW), prunes expired tombstones,
 * removes local config entries superseded by a tombstone, and filters out stale incoming
 * rows so deleted rooms/devices/scenes/automations never resurrect across failovers.
 */
export async function reconcileConfigTombstones(
  manager: EntityManager,
  incomingRows: readonly StandaloneHomeEntryRow[],
  incomingTombstones: readonly StandaloneHomeEntryRow[] | undefined,
  localActiveWorkloadIds: ReadonlySet<string>,
  nowMs = Date.now(),
): Promise<{ readonly rows: StandaloneHomeEntryRow[]; readonly removed: number }> {
  const cutoff = nowMs - TOMBSTONE_RETENTION_MS;
  const localTombstones = await manager.find(StandaloneHomeEntryEntity, {
    where: { kind: 'config_tombstone' },
  });
  const tombstones = new Map<string, StandaloneHomeEntryRow>();
  const expiredKeys: string[] = [];
  for (const row of localTombstones) {
    if (row.updatedAt < cutoff) {
      expiredKeys.push(row.entryId);
      continue;
    }
    tombstones.set(row.entryId, row);
  }
  const toSaveTombstones: StandaloneHomeEntryRow[] = [];
  for (const row of incomingTombstones ?? []) {
    if (row.kind !== 'config_tombstone' || row.updatedAt < cutoff) continue;
    const prev = tombstones.get(row.entryId);
    if (!prev || row.updatedAt > prev.updatedAt) {
      tombstones.set(row.entryId, row);
      toSaveTombstones.push(row);
    }
  }
  if (expiredKeys.length > 0) {
    await manager.delete(StandaloneHomeEntryEntity, {
      kind: 'config_tombstone',
      entryId: In(expiredKeys),
    });
  }
  for (let i = 0; i < toSaveTombstones.length; i += 100) {
    await manager.upsert(StandaloneHomeEntryEntity, toSaveTombstones.slice(i, i + 100), [
      'kind',
      'entryId',
    ]);
  }

  const resurrectedKeys: string[] = [];
  const rows = incomingRows.filter((row) => {
    const key = `${row.kind}:${row.entryId}`;
    const tomb = tombstones.get(key);
    if (!tomb) return true;
    if (row.updatedAt > tomb.updatedAt) {
      resurrectedKeys.push(key);
      tombstones.delete(key);
      return true;
    }
    return false;
  });
  if (resurrectedKeys.length > 0) {
    await manager.delete(StandaloneHomeEntryEntity, {
      kind: 'config_tombstone',
      entryId: In(resurrectedKeys),
    });
  }

  let removed = 0;
  if (tombstones.size > 0) {
    const localRows = await manager.find(StandaloneHomeEntryEntity, {
      select: { kind: true, entryId: true, updatedAt: true },
      where: { kind: In([...TOMBSTONED_CONFIG_KINDS]) },
    });
    for (const local of localRows) {
      const tomb = tombstones.get(`${local.kind}:${local.entryId}`);
      if (!tomb || local.updatedAt > tomb.updatedAt) continue;
      if (local.kind === 'app' && localActiveWorkloadIds.has(`app:${local.entryId}`)) continue;
      if (
        local.kind === 'integration_entry' &&
        (localActiveWorkloadIds.has(`integration:${local.entryId}`) ||
          localActiveWorkloadIds.has(`integration:tuya:${local.entryId}`))
      ) {
        continue;
      }
      await manager.delete(StandaloneHomeEntryEntity, { kind: local.kind, entryId: local.entryId });
      removed += 1;
    }
  }
  return { rows, removed };
}
