/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { archivePending } from "../recording-archive.mjs";
import {
  archiveStorageMetadata,
  refreshArchiveStorageMetadata,
} from "../archive-storage-metadata.mjs";
import { nodeRequest, nodeJson } from "@haus/servers";
import { fileDigest } from "../backup/backups.mjs";

/** Manages media and backup replication, storage synchronisation, and blob pruning across cluster nodes. */
export class ClusterReplicationEngine {
  constructor(cluster) {
    this.cluster = cluster;
    this.busy = false;
    this.running = undefined;
  }

  tick() {
    if (this.busy || this.cluster.stopped) return this.running;
    this.running = this.work().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  async replicate(file, digest, kind, nodes) {
    const row =
      kind === "media"
        ? this.cluster.catalog.mediaForDigest(digest)
        : null;
    const release = row ? await this.cluster.store.pinMedia(row.eventId) : () => {};
    try {
      return await this.replicatePinned(file, digest, kind, nodes);
    } finally {
      release();
    }
  }

  async replicatePinned(file, digest, kind, nodes) {
    const info = await stat(file).catch(() => null);
    if (!info) return;
    const bytes = info.size;
    for (const node of nodes) {
      if (this.cluster.stopped) return;
      const release = await this.cluster.pinBlob(node.id, digest);
      try {
        let metadata, metadataHash;
        if (kind === "media") {
          const row = this.cluster.catalog.mediaForDigest(digest);
          if (!row) continue;
          const event = await this.cluster.store.get(row.eventId);
          if (!event) continue;
          metadata = await archiveStorageMetadata(
            this.cluster.store,
            event,
            digest,
          );
          metadataHash = createHash("sha256")
            .update(JSON.stringify(metadata))
            .digest("hex");
        }
        const location = this.cluster.catalog.location(digest, node.id);
        if (
          location?.kind === kind &&
          (kind !== "media" ||
            (location.catalog_version === 1 &&
              location.metadata_hash === metadataHash))
        )
          continue;
        const status = this.cluster.health.get(node.id)?.remote;
        if (
          !location &&
          status?.storage &&
          (status.storage.availableBytes ??
            status.storage.maxBytes -
              status.storage.usedBytes -
              status.storage.reservedBytes) < bytes
        )
          throw new Error("storage_full");
        const head = await nodeRequest(node, `/v1/blobs/${digest}`, {
          method: "HEAD",
          signal: this.cluster.abort.signal,
        });
        const exists = head.ok;
        await head.body?.cancel();
        if (!exists) {
          const response = await nodeRequest(node, `/v1/blobs/${digest}`, {
            method: "PUT",
            file,
            digest,
            length: bytes,
            signal: this.cluster.abort.signal,
            timeout: 600000,
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error("replication_failed");
          }
          await response.body?.cancel();
        }
        if (kind === "backup") {
          const backupMeta = this.cluster.backups
            .list()
            .find((item) => item.digest === digest);
          await nodeJson(node, "/v1/backups", {
            method: "POST",
            data: {
              digest,
              kind: backupMeta.kind,
              createdAt: backupMeta.createdAt,
              bytes: backupMeta.bytes,
            },
            signal: this.cluster.abort.signal,
          });
        }
        if (kind === "media") {
          await nodeJson(node, "/v1/recordings", {
            method: "POST",
            data: {
              digest,
              ...metadata,
            },
            signal: this.cluster.abort.signal,
          });
        }
        await this.cluster.catalog.saveLocation({
          digest,
          nodeId: node.id,
          kind,
          catalogVersion: kind === "media" ? 1 : 0,
          metadataHash: metadataHash ?? null,
        });
        this.cluster.errors.delete(node.id);
      } catch {
        this.cluster.errors.set(node.id, "Copy pending · will retry");
      } finally {
        release();
      }
    }
  }

  async work() {
    this.busy = true;
    try {
      await this.cluster.refreshHealth();
      const peers = this.cluster.nodes().filter(
        (node) => node.enabled && this.cluster.health.get(node.id)?.online,
      );
      const nodes = peers.filter((node) => node.roles.includes("storage"));
      const workers = peers.filter((node) => node.roles.length > 0);
      // Configuration/HA recovery copies go to every storage node by default.
      for (const item of this.cluster.backups.list())
        await this.cluster.replicate(
          this.cluster.backups.path(item.digest),
          item.digest,
          "backup",
          nodes,
        );
      // Keep the helper authoritative; node failures never discard its original media.
      const nodeIds = nodes.map((node) => node.id);
      const eventIds = await this.cluster.catalog.replicationCandidates(
        nodeIds,
        Math.min(2, nodeIds.length),
      );
      for (const id of eventIds) {
        const release = await this.cluster.store.pinMedia(id);
        try {
          const event = await this.cluster.store.get(id);
          if (!event) continue;
          const version = event.playbackVersion;
          let media = this.cluster.catalog.media(id);
          const file = this.cluster.store.path(
            id,
            event.playbackBytes ? "playback.mp4" : "mp4",
          );
          if (!media || media.version !== version) {
            try {
              media = {
                digest: await fileDigest(file),
                bytes: (await stat(file)).size,
                version,
              };
              await this.cluster.catalog.saveMedia({ eventId: id, ...media });
            } catch {
              continue;
            }
          }
          const ranked = [...nodes].sort(
            (a, b) =>
              this.cluster.health.get(a.id)?.remote.storage.usedBytes /
                Math.max(1, this.cluster.health.get(a.id)?.remote.storage.maxBytes) -
              this.cluster.health.get(b.id)?.remote.storage.usedBytes /
                Math.max(1, this.cluster.health.get(b.id)?.remote.storage.maxBytes),
          );
          const existing = new Set(
            this.cluster.catalog
              .locationsForDigest(media.digest)
              .map((row) => row.nodeId),
          );
          ranked.sort(
            (a, b) => Number(existing.has(b.id)) - Number(existing.has(a.id)),
          );
          await this.cluster.replicate(file, media.digest, "media", ranked.slice(0, 2));
        } finally {
          release();
        }
      }
      await this.cluster.refreshHealth({ force: true });
      await archivePending(this.cluster);
      await refreshArchiveStorageMetadata(this.cluster);
      await this.cluster.refreshHealth({ force: true });
      await this.cluster.recordingCache?.trim();
      await this.cluster.prune(workers);
    } finally {
      this.busy = false;
    }
  }

  async prune(nodes) {
    await this.cluster.catalog.pruneOrphanedMedia();
    const backups = new Set(this.cluster.backups.list().map((item) => item.digest));
    const media = new Set(
      this.cluster.catalog.mediaRows().map((row) => row.digest),
    );
    for (const digest of await this.cluster.store.archive.digestsForExistingEvents())
      media.add(digest);
    for (const node of nodes) {
      const rows = this.cluster.catalog.locationsForNode(node.id);
      for (const row of rows) {
        if (
          row.kind !== "preparation" &&
          (row.kind === "backup" ? backups : media).has(row.digest)
        )
          continue;
        const key = `${node.id}:${row.digest}`;
        if (this.cluster.blobPins.has(key) || this.cluster.blobDeletes.has(key)) continue;
        const remove = (async () => {
          try {
            const response = await nodeRequest(
              node,
              `/v1/blobs/${row.digest}`,
              {
                method: "DELETE",
                signal: this.cluster.abort.signal,
                timeout: 10000,
              },
            );
            await response.body?.cancel();
            if (response.ok)
              await this.cluster.catalog.removeLocation(row.digest, node.id);
          } catch {
          } finally {
            this.cluster.blobDeletes.delete(key);
          }
        })();
        this.cluster.blobDeletes.set(key, remove);
        await remove;
      }
    }
    await this.cluster.store.archive.pruneOrphans();
  }
}
