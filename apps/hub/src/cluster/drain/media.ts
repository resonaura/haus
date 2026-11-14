/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { EntityManager } from 'typeorm';
import {
  EventArchiveEntity,
  EventArchiveLocationEntity,
  RecordingEventEntity,
  type EventArchiveRow,
} from '../../events/recording.entities.js';
import {
  BackupEntity,
  ClusterLocationEntity,
  ClusterMediaEntity,
} from '../../storage/entities/domains.js';
import type { Transactions } from '../../storage/transactions.js';

export interface ArchiveMediaRef {
  readonly eventId: string;
  readonly variant: string;
  readonly version: number;
}

export function resolveClusterMediaDirs(dataDir?: string): readonly string[] {
  const dirs = new Set<string>();
  const envMedia = process.env.HAUS_MEDIA?.trim();
  if (envMedia) dirs.add(resolve(envMedia));
  if (dataDir?.trim()) dirs.add(resolve(join(dataDir, 'media')));
  return Array.from(dirs);
}

function isContainedPath(baseDir: string, candidate: string): boolean {
  return candidate.startsWith(`${baseDir}${sep}`);
}

export async function findLocalDigestMediaPath(params: {
  readonly digest: string;
  readonly dataDir?: string;
  readonly archiveRefs?: readonly ArchiveMediaRef[];
  readonly transactions?: Transactions;
}): Promise<string | undefined> {
  const normalized = params.digest.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return undefined;

  let refs = params.archiveRefs ? [...params.archiveRefs] : [];
  if (params.transactions) {
    const dbRefs = await params.transactions.run(async (manager) =>
      loadArchiveRefsForDigest(manager, normalized),
    );
    refs = [...refs, ...dbRefs];
  }

  for (const mediaDir of resolveClusterMediaDirs(params.dataDir)) {
    for (const ref of refs) {
      const ext = ref.variant === 'prepared' ? 'playback.mp4' : 'mp4';
      const candidate = resolve(join(mediaDir, `${ref.eventId}.${ext}`));
      if (!isContainedPath(mediaDir, candidate)) continue;
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Keep checking other directories or fallbacks.
      }
    }
  }

  if (!params.dataDir?.trim()) return undefined;
  for (const subdir of ['media', 'backups', 'archive']) {
    const baseDir = resolve(join(params.dataDir, subdir));
    for (const suffix of ['', '.mp4', '.jpg', '.enc']) {
      const candidate = resolve(join(baseDir, `${normalized}${suffix}`));
      if (!isContainedPath(baseDir, candidate)) continue;
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Keep checking other subdirectories/extensions.
      }
    }
  }
  return undefined;
}

async function loadArchiveRefsForDigest(
  manager: EntityManager,
  digest: string,
): Promise<ArchiveMediaRef[]> {
  const seen = new Map<string, ArchiveMediaRef>();
  const rows: readonly Pick<EventArchiveRow, 'eventId' | 'variant' | 'version'>[] =
    await manager.find(EventArchiveEntity, { where: { digest } });
  for (const row of rows) {
    seen.set(`${row.eventId}:${row.variant}`, {
      eventId: row.eventId,
      variant: row.variant,
      version: row.version,
    });
  }
  const locs = await manager.find(EventArchiveLocationEntity, { where: { digest } });
  for (const loc of locs) {
    const key = `${loc.eventId}:${loc.variant}`;
    if (!seen.has(key)) {
      seen.set(key, { eventId: loc.eventId, variant: loc.variant, version: loc.version });
    }
  }
  return Array.from(seen.values());
}

/** Resolves a peer download path with optional validated event/variant hints for native NVR clips. */
export async function resolvePeerMediaDownloadPath(
  digest: string,
  kind: 'media' | 'backup',
  transactions?: Transactions,
): Promise<string> {
  const basePath = `/api/cluster/peer/media/${digest}`;
  if (kind !== 'media' || !transactions) return basePath;
  const refs = await transactions.run((manager) => loadArchiveRefsForDigest(manager, digest));
  const primary = refs[0];
  if (!primary) return basePath;
  const qs = new URLSearchParams({
    eventId: primary.eventId,
    variant: primary.variant,
  });
  return `${basePath}?${qs.toString()}`;
}

export async function saveEvacuatedBlobAndLocations(params: {
  readonly digest: string;
  readonly kind: 'media' | 'backup';
  readonly bytes: Buffer;
  readonly survivingHubId: string;
  readonly departedHubId: string;
  readonly dataDir?: string;
  readonly transactions?: Transactions;
  readonly mediaSaveHook?: (digest: string, kind: string, bytes: Buffer) => Promise<void>;
}): Promise<void> {
  const { digest, kind, bytes, survivingHubId, departedHubId, dataDir, transactions } = params;
  const archiveRefs = transactions
    ? await transactions.run((manager) => loadArchiveRefsForDigest(manager, digest))
    : [];

  if (params.mediaSaveHook) {
    await params.mediaSaveHook(digest, kind, bytes);
  } else if (
    kind === 'media' &&
    archiveRefs.length > 0 &&
    resolveClusterMediaDirs(dataDir).length > 0
  ) {
    const mediaDir = resolveClusterMediaDirs(dataDir)[0];
    await mkdir(mediaDir, { recursive: true, mode: 0o750 });
    for (const ref of archiveRefs) {
      const ext = ref.variant === 'prepared' ? 'playback.mp4' : 'mp4';
      await writeFile(join(mediaDir, `${ref.eventId}.${ext}`), bytes, { mode: 0o600 });
    }
  } else if (dataDir) {
    const folder = join(dataDir, kind === 'backup' ? 'backups' : 'media');
    await mkdir(folder, { recursive: true, mode: 0o750 });
    await writeFile(join(folder, digest), bytes, { mode: 0o600 });
  }

  if (!transactions) return;
  const now = Date.now();
  await transactions.run(async (manager) => {
    await manager.upsert(
      ClusterLocationEntity,
      { digest, nodeId: survivingHubId, kind, catalogVersion: 1, metadataHash: digest },
      ['digest', 'nodeId'],
    );
    await manager.delete(ClusterLocationEntity, { digest, nodeId: departedHubId });

    for (const ref of archiveRefs) {
      await manager.upsert(
        EventArchiveEntity,
        {
          eventId: ref.eventId,
          variant: ref.variant,
          digest,
          bytes: bytes.length,
          version: ref.version,
        },
        ['eventId', 'variant'],
      );
      await manager.upsert(
        EventArchiveLocationEntity,
        {
          eventId: ref.eventId,
          variant: ref.variant,
          nodeId: survivingHubId,
          digest,
          bytes: bytes.length,
          version: ref.version,
          verifiedAt: now,
        },
        ['eventId', 'variant', 'nodeId'],
      );
      await manager.delete(EventArchiveLocationEntity, {
        eventId: ref.eventId,
        variant: ref.variant,
        nodeId: departedHubId,
      });
      await manager.update(
        RecordingEventEntity,
        { id: ref.eventId },
        ref.variant === 'prepared' ? { localPlayback: true } : { localOriginal: true },
      );
    }
  });
}

export async function collectSoleCopyAssets(params: {
  readonly nodeId: string;
  readonly localHubId: string;
  readonly isLocalNode: boolean;
  readonly enabledPeerIds: ReadonlySet<string>;
  readonly dataDir?: string;
  readonly transactions?: Transactions;
}): Promise<{
  readonly soleCopyMediaDigests: readonly string[];
  readonly soleCopyBackupDigests: readonly string[];
  readonly soleCopyMediaBytes: number;
}> {
  const soleCopyMediaDigests: string[] = [];
  const soleCopyBackupDigests: string[] = [];
  let soleCopyMediaBytes = 0;

  if (!params.transactions) {
    return { soleCopyMediaDigests, soleCopyBackupDigests, soleCopyMediaBytes };
  }

  await params.transactions.run(async (manager) => {
    const allLocations = await manager.find(ClusterLocationEntity);
    const mediaRows = await manager.find(ClusterMediaEntity);
    const mediaBytesByDigest = new Map<string, number>();
    for (const m of mediaRows) mediaBytesByDigest.set(m.digest, m.bytes);
    const backupRows = await manager.find(BackupEntity);
    const backupBytesByDigest = new Map<string, number>();
    for (const b of backupRows) backupBytesByDigest.set(b.digest, b.bytes);

    const locationsByDigest = new Map<string, Set<string>>();
    const kindByDigest = new Map<string, string>();
    for (const loc of allLocations) {
      const set = locationsByDigest.get(loc.digest) ?? new Set<string>();
      set.add(loc.nodeId);
      locationsByDigest.set(loc.digest, set);
      kindByDigest.set(loc.digest, loc.kind);
    }

    const archiveEntries = await manager.find(EventArchiveEntity);
    const archiveLocs = await manager.find(EventArchiveLocationEntity);
    const archiveRefsByDigest = new Map<string, ArchiveMediaRef[]>();
    const addArchiveRef = (digest: string, ref: ArchiveMediaRef) => {
      const list = archiveRefsByDigest.get(digest) ?? [];
      if (!list.some((x) => x.eventId === ref.eventId && x.variant === ref.variant)) {
        list.push(ref);
        archiveRefsByDigest.set(digest, list);
      }
    };
    for (const entry of archiveEntries) {
      addArchiveRef(entry.digest, {
        eventId: entry.eventId,
        variant: entry.variant,
        version: entry.version,
      });
    }
    for (const aloc of archiveLocs) {
      const set = locationsByDigest.get(aloc.digest) ?? new Set<string>();
      set.add(aloc.nodeId);
      locationsByDigest.set(aloc.digest, set);
      addArchiveRef(aloc.digest, {
        eventId: aloc.eventId,
        variant: aloc.variant,
        version: aloc.version,
      });
      if (!mediaBytesByDigest.has(aloc.digest)) {
        mediaBytesByDigest.set(aloc.digest, aloc.bytes);
      }
    }

    for (const [digest, holders] of locationsByDigest) {
      if (!holders.has(params.nodeId)) continue;
      const otherSurvivingHolders = Array.from(holders).filter(
        (holderId) =>
          holderId !== params.nodeId &&
          (holderId === params.localHubId || params.enabledPeerIds.has(holderId)),
      );
      if (otherSurvivingHolders.length > 0) continue;

      if (
        !params.isLocalNode &&
        (await findLocalDigestMediaPath({
          digest,
          dataDir: params.dataDir,
          archiveRefs: archiveRefsByDigest.get(digest) ?? [],
        }))
      ) {
        continue;
      }

      const kind = kindByDigest.get(digest) ?? 'media';
      if (kind === 'backup') {
        soleCopyBackupDigests.push(digest);
      } else {
        soleCopyMediaDigests.push(digest);
        soleCopyMediaBytes +=
          mediaBytesByDigest.get(digest) ?? backupBytesByDigest.get(digest) ?? 0;
      }
    }
  });

  return { soleCopyMediaDigests, soleCopyBackupDigests, soleCopyMediaBytes };
}
