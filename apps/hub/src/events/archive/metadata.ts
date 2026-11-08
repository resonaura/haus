/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { nodeJson } from '@haus/servers';
import { recordingMetadata, type RecordingMetadataInput } from '../recording-metadata.js';
import type { ArchiveMetadataRow } from '../recording.archive.js';

const BATCH_ROWS = 32;
const MAX_SENDS_PER_PASS = 8;

export interface ArchiveDescriptorRow {
  readonly variant: string;
  readonly digest: string;
}

/** Event persistence consumed by archive classification. */
export interface ArchiveMetadataStore {
  readonly archive: {
    descriptors(eventId: string): Promise<readonly ArchiveDescriptorRow[]>;
    metadataPage(cursor: number, limit?: number): Promise<readonly ArchiveMetadataRow[]>;
  };
  get(id: string): Promise<(RecordingMetadataInput & { status: string }) | null | undefined>;
}

export interface ArchiveStorageNode {
  readonly id: string;
  readonly enabled: boolean;
  readonly url: string;
  readonly key: string;
  readonly allowHttp?: boolean;
}

/** Cluster services needed to repair remote catalogs without owning their lifecycle. */
export interface ArchiveMetadataCluster {
  readonly store: ArchiveMetadataStore;
  readonly abort: AbortController;
  readonly health: ReadonlyMap<string, { remote?: { storage?: { usage?: { version?: number } } } }>;
  readonly catalog: {
    location(digest: string, nodeId: string): { metadataHash?: string | null } | undefined;
    saveArchiveLocation(digest: string, nodeId: string, metadataHash?: string): Promise<void>;
  };
  stopped?: boolean;
  storageMetadataCursor?: number;
  nodes(): readonly ArchiveStorageNode[];
}

export interface ArchiveStorageMetadata extends Record<string, unknown> {
  event: Record<string, unknown>;
  originalDigest?: string;
  variant?: string;
}

/**
 * Classification follows the authoritative archive descriptors, never filenames
 * or playback-version heuristics. It does not transfer or alter media bytes.
 */
export async function archiveStorageMetadata(
  store: { readonly archive: Pick<ArchiveMetadataStore['archive'], 'descriptors'> },
  event: RecordingMetadataInput,
  digest: string,
): Promise<ArchiveStorageMetadata> {
  const rows = await store.archive.descriptors(event.id);
  const original = rows.find((row) => row.variant === 'original');
  const material = rows.find((row) => row.digest === digest);
  return {
    event: recordingMetadata(event),
    ...(original ? { originalDigest: original.digest } : {}),
    ...(material ? { variant: material.variant } : {}),
  };
}

/**
 * Repair older node catalogs in small resumable batches without reuploading
 * originals or changing the preferred prepared copy. Unknown remains unknown.
 */
export async function refreshArchiveStorageMetadata(
  cluster: ArchiveMetadataCluster,
): Promise<void> {
  const rows = await cluster.store.archive.metadataPage(
    cluster.storageMetadataCursor ?? 0,
    BATCH_ROWS,
  );
  if (!rows.length) {
    cluster.storageMetadataCursor = 0;
    return;
  }
  let sent = 0;
  for (const row of rows) {
    if (cluster.stopped || sent >= MAX_SENDS_PER_PASS) break;
    cluster.storageMetadataCursor = row.cursor;
    const node = cluster.nodes().find((item) => item.id === row.nodeId && item.enabled);
    if (!node || cluster.health.get(node.id)?.remote?.storage?.usage?.version !== 1) continue;
    const event = await cluster.store.get(row.eventId);
    if (!event || event.status !== 'ready') continue;
    const metadata = await archiveStorageMetadata(cluster.store, event, row.digest);
    const hash = createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
    if (cluster.catalog.location(row.digest, node.id)?.metadataHash === hash) continue;
    sent++;
    try {
      await nodeJson(node, '/v1/recordings', {
        method: 'POST',
        data: { digest: row.digest, ...metadata },
        signal: cluster.abort.signal,
        timeout: 3000,
      });
      await cluster.catalog.saveArchiveLocation(row.digest, node.id, hash);
    } catch {
      // Catalog-only retry on the next pass; preserved media stays authoritative.
    }
  }
}
