/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  archiveNodes,
  verifyArchivedBlob,
  type ArchiveNode,
  type ArchiveNodeHealth,
} from './archive.js';

export interface ArchiveBackupItem {
  readonly kind: string;
  readonly available?: boolean;
  readonly archiveGeneration?: number | null;
  readonly digest: string;
  readonly bytes: number;
}

export interface ArchiveRecoveryBackups {
  list(): readonly ArchiveBackupItem[];
  retry(kind: string): { readonly nextAt: number } | null | undefined;
  canSnapshot?(kind: string): boolean;
  readonly busy?: boolean;
  snapshot?(kind: string): Promise<ArchiveBackupItem | null | undefined>;
  path(digest: string): string;
}

export interface ArchiveRecoveryCluster {
  readonly store: {
    archiveGeneration(): Promise<number>;
  };
  readonly abort: AbortController;
  readonly health: Map<string, ArchiveNodeHealth>;
  readonly backups: ArchiveRecoveryBackups;
  readonly catalog: {
    hasLocation(digest: string, nodeId: string, kind: string): boolean;
  };
  nodes(): readonly ArchiveNode[];
  pinBlob(nodeId: string, digest: string): Promise<() => void>;
  replicate(
    path: string,
    digest: string,
    kind: string,
    nodes: readonly ArchiveNode[],
  ): Promise<unknown>;
}

export interface ArchiveRecoveryGrant {
  readonly generation: number;
  readonly nodes: Set<string>;
  release(): void;
}

/** Keep the original/prepared descriptor map recoverable before local removal. */
export async function archiveRecovery(
  cluster: ArchiveRecoveryCluster,
): Promise<ArchiveRecoveryGrant | null> {
  const generation = await cluster.store.archiveGeneration();
  if (!generation || !archiveNodes(cluster).length || !cluster.backups.snapshot) {
    return null;
  }
  let item = cluster.backups
    .list()
    .find(
      (entry) =>
        entry.kind === 'haus' &&
        entry.available !== false &&
        (entry.archiveGeneration ?? 0) >= generation,
    );
  const pins: Array<() => void> = [];
  let granted = false;
  try {
    if (!item) {
      const retry = cluster.backups.retry('haus');
      const busy = cluster.backups.canSnapshot
        ? !cluster.backups.canSnapshot('haus')
        : Boolean(cluster.backups.busy);
      if (busy || (retry && retry.nextAt > Date.now())) return null;
      item = (await cluster.backups.snapshot('haus')) ?? undefined;
    }
    if (!item || (item.archiveGeneration ?? 0) < generation) return null;
    const nodes = new Set<string>();
    for (const node of archiveNodes(cluster)) {
      const release = await cluster.pinBlob(node.id, item.digest);
      try {
        await cluster.replicate(cluster.backups.path(item.digest), item.digest, 'backup', [node]);
        if (!cluster.catalog.hasLocation(item.digest, node.id, 'backup')) {
          throw new Error('recovery_catalog_pending');
        }
        await verifyArchivedBlob(cluster, node, item);
        nodes.add(node.id);
        pins.push(release);
      } catch {
        release();
      }
    }
    if (!nodes.size) return null;
    granted = true;
    return {
      generation: item.archiveGeneration ?? generation,
      nodes,
      release: () => {
        for (const release of pins) release();
      },
    };
  } catch {
    return null;
  } finally {
    if (!granted) {
      for (const release of pins) release();
    }
  }
}
