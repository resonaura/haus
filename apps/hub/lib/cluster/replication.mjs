/*
 * Haus — A thoughtful home for Home Assistant.
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
        ? this.cluster.store.db
            .prepare("SELECT event_id FROM cluster_media WHERE digest=?")
            .get(digest)
        : null;
    const release = row ? await this.cluster.store.pinMedia(row.event_id) : () => {};
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
          const row = this.cluster.store.db
            .prepare("SELECT event_id FROM cluster_media WHERE digest=?")
            .get(digest);
          if (!row) continue;
          metadata = archiveStorageMetadata(
            this.cluster.store,
            this.cluster.store.get(row.event_id),
            digest,
          );
          metadataHash = createHash("sha256")
            .update(JSON.stringify(metadata))
            .digest("hex");
        }
        const location = this.cluster.store.db
          .prepare(
            "SELECT kind, catalog_version, metadata_hash FROM cluster_locations WHERE digest=? AND node_id=?",
          )
          .get(digest, node.id);
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
        this.cluster.store.db
          .prepare(
            "INSERT OR REPLACE INTO cluster_locations(digest,node_id,kind,catalog_version,metadata_hash)VALUES(?,?,?,?,?)",
          )
          .run(
            digest,
            node.id,
            kind,
            kind === "media" ? 1 : 0,
            metadataHash ?? null,
          );
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
      const events = nodeIds.length
        ? this.cluster.store.db
            .prepare(
              `SELECT e.id FROM events e LEFT JOIN cluster_media m ON m.event_id=e.id WHERE e.status='ready' AND (m.event_id IS NULL OR m.version!=e.playback_version OR (SELECT count(*) FROM cluster_locations l WHERE l.digest=m.digest AND l.catalog_version=1 AND l.node_id IN (${nodeIds.map(() => "?").join(",")}))<?) ORDER BY e.start_at DESC LIMIT 8`,
            )
            .all(...nodeIds, Math.min(2, nodeIds.length))
        : [];
      for (const { id } of events) {
        const release = await this.cluster.store.pinMedia(id);
        try {
          const event = this.cluster.store.get(id);
          const version = event.playbackVersion;
          let media = this.cluster.store.db
            .prepare("SELECT * FROM cluster_media WHERE event_id=?")
            .get(id);
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
              this.cluster.store.db
                .prepare(
                  "INSERT OR REPLACE INTO cluster_media(event_id,digest,bytes,version)VALUES(?,?,?,?)",
                )
                .run(id, media.digest, media.bytes, version);
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
            this.cluster.store.db
              .prepare("SELECT node_id FROM cluster_locations WHERE digest=?")
              .all(media.digest)
              .map((row) => row.node_id),
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
    const backups = new Set(this.cluster.backups.list().map((item) => item.digest));
    const media = new Set(
      this.cluster.store.db
        .prepare(
          "SELECT digest FROM cluster_media WHERE event_id IN(SELECT id FROM events)",
        )
        .all()
        .map((row) => row.digest),
    );
    for (const { digest } of this.cluster.store.db
      .prepare(
        "SELECT digest FROM event_archive WHERE event_id IN(SELECT id FROM events)",
      )
      .all())
      media.add(digest);
    for (const node of nodes) {
      const rows = this.cluster.store.db
        .prepare("SELECT digest,kind FROM cluster_locations WHERE node_id=?")
        .all(node.id);
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
              this.cluster.store.db
                .prepare(
                  "DELETE FROM cluster_locations WHERE digest=? AND node_id=?",
                )
                .run(row.digest, node.id);
          } catch {
          } finally {
            this.cluster.blobDeletes.delete(key);
          }
        })();
        this.cluster.blobDeletes.set(key, remove);
        await remove;
      }
    }
    this.cluster.store.db.exec(
      "DELETE FROM cluster_media WHERE event_id NOT IN(SELECT id FROM events); DELETE FROM event_archive WHERE event_id NOT IN(SELECT id FROM events); DELETE FROM event_archive_locations WHERE event_id NOT IN(SELECT id FROM events)",
    );
  }
}
