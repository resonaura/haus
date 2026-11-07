/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from "node:crypto";
import { recordingMetadata } from "./recording-metadata.mjs";
import { nodeJson } from "@haus/servers";

/** Classification follows the authoritative archive descriptors, never filenames
 * or playback-version heuristics. It does not transfer or alter media bytes. */
export async function archiveStorageMetadata(store, event, digest) {
  const rows = await store.archive.descriptors(event.id);
  const original = rows.find((row) => row.variant === "original");
  const material = rows.find((row) => row.digest === digest);
  return {
    event: recordingMetadata(event),
    ...(original ? { originalDigest: original.digest } : {}),
    ...(material ? { variant: material.variant } : {}),
  };
}

/** Repair older node catalogs in small resumable batches without reuploading
 * originals or changing the preferred prepared copy. Unknown remains unknown. */
export async function refreshArchiveStorageMetadata(cluster) {
  const rows = await cluster.store.archive.metadataPage(
    cluster.storageMetadataCursor ?? 0,
    32,
  );
  if (!rows.length) {
    cluster.storageMetadataCursor = 0;
    return;
  }
  let sent = 0;
  for (const row of rows) {
    if (cluster.stopped || sent >= 8) break;
    cluster.storageMetadataCursor = row.cursor;
    const node = cluster
      .nodes()
      .find((item) => item.id === row.nodeId && item.enabled);
    if (
      !node ||
      cluster.health.get(node.id)?.remote?.storage?.usage?.version !== 1
    )
      continue;
    const event = await cluster.store.get(row.eventId);
    if (!event || event.status !== "ready") continue;
    const metadata = await archiveStorageMetadata(cluster.store, event, row.digest);
    const hash = createHash("sha256")
      .update(JSON.stringify(metadata))
      .digest("hex");
    const previous = cluster.catalog.location(row.digest, node.id);
    if (previous?.metadataHash === hash) continue;
    sent++;
    try {
      await nodeJson(node, "/v1/recordings", {
        method: "POST",
        data: { digest: row.digest, ...metadata },
        signal: cluster.abort.signal,
        timeout: 3000,
      });
      await cluster.catalog.saveArchiveLocation(row.digest, node.id, hash);
    } catch {
      /* Catalog-only retry on the next pass; preserved media stays authoritative. */
    }
  }
}
