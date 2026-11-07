/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ORIGINAL_POLICY_VERSION } from "./compatible.mjs";
import { playbackReady, PLAYBACK_VERSION } from "./playback.mjs";

/** Drain a bounded page of pending recordings on idle NVRs, never on HA fallback. */
export class RecentPlayback {
  constructor(store, recorder, cluster, { catalog, now = Date.now } = {}) {
    if (!catalog) throw new Error("retention_catalog_required");
    Object.assign(this, { store, recorder, cluster, catalog, now });
  }
  blocked() {
    return Boolean(
      this.recorder.stopped ||
      this.recorder.playbackJobs.size ||
      this.recorder.encoding.activeWork ||
      this.recorder.encoding.pending.length,
    );
  }
  async tick() {
    if (this.busy || this.blocked()) return;
    // Admission must be owned before the first asynchronous catalog operation.
    this.busy = true;
    try {
      await this.work();
    } finally {
      this.busy = false;
    }
  }
  async work() {
    await this.catalog.prunePreparations(PLAYBACK_VERSION, ORIGINAL_POLICY_VERSION);
    const rows = await this.catalog.pendingPreparations(
      PLAYBACK_VERSION, ORIGINAL_POLICY_VERSION, this.now(),
    );
    for (const id of rows) {
      if (this.blocked()) return;
      const event = await this.store.get(id);
      if (!event) continue;
      const camera = this.recorder.cameras?.find(
        (item) => item.id === event.cameraId,
      );
      if (
        !camera?.enabled ||
        event.localOriginal === false ||
        playbackReady(event) ||
        !this.cluster.canPreparePlayback(event)
      ) {
        // A disabled or not-yet-replicated page must not hide older footage.
        await this.catalog.deferPreparation(id, this.now() + 15000);
        continue;
      }
      await this.catalog.deferPreparation(id, this.now() + 60000);
      if (this.blocked()) return;
      const current = await this.store.get(id);
      if (!current || current.localOriginal === false || playbackReady(current) ||
        !this.recorder.cameras?.some((camera) => camera.id === current.cameraId && camera.enabled) ||
        !this.cluster.canPreparePlayback(current)) return;
      try {
        await this.recorder.preparePlayback(current, -10, { remoteOnly: true });
      } catch {
        // Foreground playback retains its normal fallback and retry policy.
      } finally {
        if (playbackReady((await this.store.get(id)) ?? {})) await this.catalog.clearPreparation(id);
      }
      return;
    }
  }
}
