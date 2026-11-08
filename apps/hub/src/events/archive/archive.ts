/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { stat } from 'node:fs/promises';
import { nodeJson, nodeRequest } from '@haus/servers';
import { fileDigest } from '../../backup/backups.service.js';
import { playbackReady, PLAYBACK_VERSION, ORIGINAL_POLICY_VERSION } from '../playback.js';
import type { RecordingMetadataInput } from '../recording-metadata.js';
import type { ArchiveCandidate } from '../recording.archive.js';
import type { EventArchiveLocationRow, EventArchiveRow } from '../recording.entities.js';
import { archiveStorageMetadata, type ArchiveDescriptorRow } from './metadata.js';

export type ArchiveVariant = 'original' | 'prepared';

export interface ArchiveNodeCandidate {
  readonly id: string;
  readonly enabled?: boolean;
  readonly roles: readonly string[];
}

export interface ArchiveNode extends ArchiveNodeCandidate {
  readonly url: string;
  readonly key: string;
  readonly allowHttp?: boolean;
}

export interface ArchiveNodeHealth {
  readonly online?: boolean;
  readonly lastSeen?: number;
  readonly remote?: {
    readonly resources?: {
      readonly pressured?: boolean;
    };
    readonly storage?: {
      readonly verification?: {
        readonly supported?: boolean;
      };
      readonly usage?: {
        readonly version?: number;
      };
    };
  };
}

export interface ArchiveBlobDescriptor {
  readonly variant: string;
  readonly digest: string;
  readonly bytes: number;
  readonly version: number;
}

export interface ArchiveEventRecord extends RecordingMetadataInput {
  readonly status: string;
  readonly bytes: number;
  readonly playbackBytes: number;
  readonly playbackVersion: number;
  readonly localOriginal?: boolean;
  readonly localPlayback?: boolean;
  readonly mediaRevision?: number;
}

export interface ArchiveStore {
  pinMedia(id: string): Promise<() => void>;
  get(id: string): Promise<ArchiveEventRecord | null | undefined>;
  path(id: string, extension?: string): string;
  readonly archive: {
    descriptor(
      eventId: string,
      variant: string,
      version: number,
    ): Promise<ArchiveBlobDescriptor | null | undefined>;
    descriptors(eventId: string): Promise<readonly ArchiveDescriptorRow[]>;
    saveDescriptor(row: EventArchiveRow): Promise<void>;
    location(
      eventId: string,
      variant: string,
      nodeId: string,
      digest: string,
      version: number,
    ): Promise<EventArchiveLocationRow | null | undefined>;
    locations(
      eventId: string,
      variant: string,
      digest: string,
      version: number,
    ): Promise<readonly { readonly nodeId: string }[]>;
    saveLocation(row: EventArchiveLocationRow): Promise<void>;
    pendingCandidates(options: {
      nodeIds: readonly string[];
      copies: number;
      cursor?: { at: number; id: string };
      playbackVersion: number;
      originalPolicyVersion: number;
      limit?: number;
    }): Promise<readonly ArchiveCandidate[]>;
  };
}

export interface ArchiveCluster {
  readonly store: ArchiveStore;
  readonly abort: AbortController;
  readonly health: Map<string, ArchiveNodeHealth>;
  readonly errors: Map<string, string>;
  readonly catalog: {
    saveArchiveLocation(digest: string, nodeId: string, metadataHash?: string): Promise<void>;
  };
  readonly backups?: {
    markChanged?: () => void;
  };
  archiveCursor?: { at: number; id: string };
  stopped?: boolean;
  nodes(): readonly ArchiveNode[];
  pinBlob(nodeId: string, digest: string): Promise<() => void>;
}

export const variantExtension = (variant: string): 'playback.mp4' | 'mp4' =>
  variant === 'prepared' ? 'playback.mp4' : 'mp4';

export function archiveNodes<T extends ArchiveNodeCandidate>(
  cluster: {
    nodes(): readonly T[];
    readonly health: ReadonlyMap<string, ArchiveNodeHealth>;
  },
  now = Date.now(),
): T[] {
  return cluster.nodes().filter((node) => {
    const health = cluster.health.get(node.id);
    return (
      Boolean(node.enabled) &&
      node.roles.includes('storage') &&
      Boolean(health?.online) &&
      health?.remote?.resources?.pressured !== true &&
      typeof health?.lastSeen === 'number' &&
      now - health.lastSeen < 60000 &&
      health.remote?.storage?.verification?.supported === true
    );
  });
}

function isVerifiedBlobResponse(
  value: unknown,
  descriptor: Pick<ArchiveBlobDescriptor, 'digest' | 'bytes'>,
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.verified === true &&
    record.digest === descriptor.digest &&
    record.bytes === descriptor.bytes
  );
}

/** A catalog row alone is never evidence that a worker still has intact media. */
export async function verifyArchivedBlob(
  cluster: Pick<ArchiveCluster, 'abort' | 'health'>,
  node: Pick<ArchiveNode, 'id' | 'url' | 'key' | 'allowHttp'>,
  descriptor: Pick<ArchiveBlobDescriptor, 'digest' | 'bytes'>,
): Promise<void> {
  const result: unknown = await nodeJson(node, `/v1/blobs/${descriptor.digest}/verify`, {
    method: 'POST',
    signal: cluster.abort.signal,
    timeout: 65000,
  });
  if (!isVerifiedBlobResponse(result, descriptor)) {
    throw new Error('archive_verification_failed');
  }
  const health = cluster.health.get(node.id);
  if (health) {
    cluster.health.set(node.id, {
      ...health,
      online: true,
      lastSeen: Date.now(),
    });
  }
}

export async function archiveEvent(cluster: ArchiveCluster, id: string): Promise<boolean> {
  const nodes = archiveNodes(cluster);
  if (!nodes.length) return false;
  const release = await cluster.store.pinMedia(id);
  try {
    const event = await cluster.store.get(id);
    if (!event || event.status !== 'ready' || !playbackReady(event)) return false;
    const variants: ArchiveVariant[] = [
      'original',
      ...(event.playbackBytes > 0 ? (['prepared'] as const) : []),
    ];
    const materials: Array<{
      variant: ArchiveVariant;
      version: number;
      descriptor: ArchiveBlobDescriptor;
      file: string;
      local: boolean;
    }> = [];
    for (const variant of variants) {
      const version = variant === 'prepared' ? event.playbackVersion : 0;
      let descriptor = await cluster.store.archive.descriptor(id, variant, version);
      const file = cluster.store.path(id, variantExtension(variant));
      const local = Boolean(variant === 'original' ? event.localOriginal : event.localPlayback);
      const expectedBytes = variant === 'original' ? event.bytes : event.playbackBytes;
      if (
        local &&
        (!descriptor || descriptor.version !== version || descriptor.bytes !== expectedBytes)
      ) {
        const info = await stat(file).catch(() => null);
        if (!info?.isFile() || info.size !== expectedBytes) return false;
        const digest = await fileDigest(file);
        const after = await stat(file).catch(() => null);
        if (
          !after ||
          after.ino !== info.ino ||
          after.size !== info.size ||
          after.mtimeMs !== info.mtimeMs ||
          (await cluster.store.get(id))?.mediaRevision !== event.mediaRevision
        ) {
          return false;
        }
        descriptor = { variant, digest, bytes: info.size, version };
        await cluster.store.archive.saveDescriptor({
          eventId: id,
          variant,
          digest,
          bytes: info.size,
          version,
        });
      }
      if (!descriptor || descriptor.version !== version) return false;
      materials.push({ variant, version, descriptor, file, local });
    }
    let copies = 0;
    for (const node of nodes) {
      let complete = true;
      for (const { variant, version, descriptor, file, local } of materials) {
        const saved = await cluster.store.archive.location(
          id,
          variant,
          node.id,
          descriptor.digest,
          version,
        );
        if (saved) continue;
        const unpin = await cluster.pinBlob(node.id, descriptor.digest);
        try {
          const head = await nodeRequest(node, `/v1/blobs/${descriptor.digest}`, {
            method: 'HEAD',
            signal: cluster.abort.signal,
            timeout: 5000,
          });
          const exists = head.ok && Number(head.headers.get('content-length')) === descriptor.bytes;
          await head.body?.cancel();
          if (!exists) {
            if (!local) {
              complete = false;
              break;
            }
            const uploaded = await nodeRequest(node, `/v1/blobs/${descriptor.digest}`, {
              method: 'PUT',
              file,
              digest: descriptor.digest,
              length: descriptor.bytes,
              signal: cluster.abort.signal,
              timeout: 600000,
            });
            await uploaded.body?.cancel();
            if (!uploaded.ok) throw new Error('archive_upload_failed');
          }
          await verifyArchivedBlob(cluster, node, descriptor);
          // A worker has one preferred catalog row per event. The original is
          // independently retained in the helper's backed-up archive map; it
          // must never overwrite an already-published prepared catalog entry.
          if (variant === 'prepared' || !event.playbackBytes) {
            await nodeJson(node, '/v1/recordings', {
              method: 'POST',
              data: {
                digest: descriptor.digest,
                ...(await archiveStorageMetadata(cluster.store, event, descriptor.digest)),
              },
              signal: cluster.abort.signal,
            });
          }
          if ((await cluster.store.get(id))?.mediaRevision !== event.mediaRevision) return false;
          await cluster.store.archive.saveLocation({
            eventId: id,
            variant,
            nodeId: node.id,
            digest: descriptor.digest,
            bytes: descriptor.bytes,
            version,
            verifiedAt: Date.now(),
          });
          await cluster.catalog.saveArchiveLocation(descriptor.digest, node.id);
          cluster.backups?.markChanged?.();
          cluster.errors.delete(node.id);
        } catch {
          cluster.errors.set(node.id, 'Archive pending · local recording kept');
          complete = false;
          break;
        } finally {
          unpin();
        }
      }
      if (complete && ++copies >= 2) break;
    }
    return copies > 0;
  } finally {
    release();
  }
}

export async function archivePending(cluster: ArchiveCluster): Promise<void> {
  const nodes = archiveNodes(cluster);
  const count = Math.min(2, nodes.length);
  if (!count) return;
  const cursor = cluster.archiveCursor;
  const events = await cluster.store.archive.pendingCandidates({
    nodeIds: nodes.map((node) => node.id),
    copies: count,
    cursor,
    playbackVersion: PLAYBACK_VERSION,
    originalPolicyVersion: ORIGINAL_POLICY_VERSION,
    limit: 8,
  });
  if (!events.length) {
    cluster.archiveCursor = undefined;
    return;
  }
  for (const { id, startAt } of events) {
    cluster.archiveCursor = { at: startAt, id };
    if (cluster.stopped) break;
    await archiveEvent(cluster, id).catch(() => {});
  }
  if (events.length < 8) cluster.archiveCursor = undefined;
}

export async function archivedVariants(
  store: Pick<ArchiveStore, 'archive'>,
  event: Pick<ArchiveEventRecord, 'id' | 'playbackBytes' | 'playbackVersion'>,
): Promise<Array<ArchiveBlobDescriptor | null | undefined>> {
  const variants: ArchiveVariant[] = [
    'original',
    ...(event.playbackBytes > 0 ? (['prepared'] as const) : []),
  ];
  return Promise.all(
    variants.map((variant) =>
      store.archive.descriptor(
        event.id,
        variant,
        variant === 'prepared' ? event.playbackVersion : 0,
      ),
    ),
  );
}

export async function archivedMedia(
  cluster: Pick<ArchiveCluster, 'store' | 'nodes' | 'health' | 'pinBlob'>,
  event: Pick<ArchiveEventRecord, 'id' | 'playbackVersion'>,
  variant: string,
  range?: string,
  signal?: AbortSignal,
  method = 'GET',
): Promise<{ response: Response; release: () => void } | null> {
  const descriptor = await cluster.store.archive.descriptor(
    event.id,
    variant,
    variant === 'prepared' ? event.playbackVersion : 0,
  );
  if (!descriptor) return null;
  const locations = new Set(
    (
      await cluster.store.archive.locations(
        event.id,
        variant,
        descriptor.digest,
        descriptor.version,
      )
    ).map((row) => row.nodeId),
  );
  for (const node of archiveNodes(cluster).filter((item) => locations.has(item.id))) {
    const release = await cluster.pinBlob(node.id, descriptor.digest);
    try {
      const response = await nodeRequest(node, `/v1/blobs/${descriptor.digest}`, {
        method,
        signal,
        timeout: 600000,
        headerTimeout: 3000,
        headers: range ? { Range: range } : {},
      });
      const total = response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];
      if (
        (response.status === 200 &&
          Number(response.headers.get('content-length')) === descriptor.bytes) ||
        (response.status === 206 && Number(total) === descriptor.bytes)
      ) {
        // Server holds the event pin through the pipeline; cluster retention can
        // never delete this digest while its event still exists and is pinned.
        return { response, release };
      }
      await response.body?.cancel();
    } catch {
      // Try next healthy archive location when a storage node fails or times out.
    }
    release();
  }
  return null;
}
