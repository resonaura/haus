/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { unlink, stat } from "node:fs/promises";
import {
  archivedVariants,
  archiveNodes,
  verifyArchivedBlob,
  variantExtension,
} from "./recording-archive.mjs";
import { playbackReady } from "./playback/playback.mjs";
import { archiveRecovery } from "./archive-recovery.mjs";

/** Serialized local-only eviction; metadata, thumbnails, NVR originals and pre-roll stay. */
export class RecordingCache {
  constructor(config, store, cluster, catalog) {
    if (!catalog) throw new Error("retention_catalog_required");
    Object.assign(this, { config, store, cluster, catalog });
  }
  trim() {
    if (this.running) return this.running;
    this.running = this.work().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  async work() {
    const policy = this.config.max_storage_gb;
    const limit =
      this.config.max_storage_gb > 0
        ? this.config.max_storage_gb * 1024 ** 3
        : Infinity;
    // Rotation/verification runs asynchronously. Leave bounded space for new
    // captures before the hard admission limit, instead of oscillating just
    // below it and rejecting the next event until the following timer tick.
    const headroom = Number.isFinite(limit)
      ? Math.min(limit * 0.1, 512 * 1024 ** 2)
      : 0;
    const highWater = limit - headroom / 2;
    const target = limit - headroom;
    if ((await this.store.totals()).bytes < highWater) return 0;
    let freed = 0;
    const cursor = this.cursor;
    const rows = await this.catalog.evictionCandidates(cursor);
    if (!rows.length) {
      this.cursor = undefined;
      return 0;
    }
    const recovery = await archiveRecovery(this.cluster);
    if (!recovery) return 0;
    try {
      for (const { id, startAt } of rows) {
        if (this.config.max_storage_gb !== policy) break;
        if (this.cluster.stopped) break;
        this.cursor = { at: startAt, id };
        if ((await this.store.totals()).bytes < target) break;
        const release = this.store.evictMedia(id);
        if (!release) continue;
        const remotePins = [];
        try {
          const event = await this.store.get(id);
          if (!event || !playbackReady(event)) continue;
          const descriptors = await archivedVariants(this.store, event);
          if (descriptors.some((item) => !item)) continue;
          let verified = false;
          // One healthy storage node must contain every required variant. This
          // avoids leaving an event dependent on disconnected split copies.
          for (const node of archiveNodes(this.cluster).filter((node) =>
            recovery.nodes.has(node.id),
          )) {
            const complete = await this.catalog.hasArchiveCopies(id, node.id, descriptors);
            if (!complete) continue;
            const releases = [];
            try {
              for (const item of descriptors) {
                releases.push(await this.cluster.pinBlob(node.id, item.digest));
                await verifyArchivedBlob(this.cluster, node, item);
              }
              // A pause/remove during verification revokes the eviction grant.
              if (
                !archiveNodes(this.cluster).some(
                  (current) => current.id === node.id,
                )
              )
                throw new Error("archive_node_unavailable");
              remotePins.push(...releases);
              verified = true;
              break;
            } catch {
              for (const unpin of releases) unpin();
            }
          }
          if (!verified) continue;
          for (const item of descriptors) {
            if (
              this.config.max_storage_gb !== policy ||
              (await this.store.archiveGeneration()) > recovery.generation
            ) {
              // The current row was deliberately revisited as the next oldest
              // candidate; restarting the keyset scan avoids skipping it after
              // a policy or recovery snapshot changed during verification.
              this.cursor = undefined;
              return freed;
            }
            const local =
              item.variant === "original"
                ? event.localOriginal
                : event.localPlayback;
            if (!local) continue;
            const path = this.store.path(id, variantExtension(item.variant));
            const info = await stat(path).catch(() => null);
            if (info && info.size !== item.bytes)
              throw new Error("local_recording_changed");
            if (
              this.config.max_storage_gb !== policy ||
              (await this.store.archiveGeneration()) > recovery.generation
            ) {
              this.cursor = undefined;
              return freed;
            }
            await unlink(path).catch((error) => {
              if (error.code !== "ENOENT") throw error;
            });
            await this.catalog.setLocal(id, item.variant, false);
            this.cluster.backups.markChanged?.();
            freed += item.bytes;
          }
        } finally {
          for (const unpin of remotePins) unpin();
          release();
        }
      }
      if (rows.length < 64) this.cursor = undefined;
      return freed;
    } finally {
      recovery.release();
    }
  }
}
