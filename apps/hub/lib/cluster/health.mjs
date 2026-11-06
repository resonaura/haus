/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { nodeJson } from "@haus/servers";

/** Tracks cluster peer health, caching status with bounded refresh rates. */
export class ClusterHealthTracker {
  constructor(cluster) {
    this.cluster = cluster;
    this.refreshPromise = undefined;
    this.refreshForced = false;
    this.forcedRefreshPromise = undefined;
    this.sampledAt = undefined;
    this.revision = 0;
  }

  get running() {
    return this.refreshPromise;
  }

  get forcedRunning() {
    return this.forcedRefreshPromise;
  }

  invalidate() {
    this.revision += 1;
    this.sampledAt = undefined;
  }

  /** Dashboard refreshes stay independent of slow archive work, without extra media polling. */
  refresh({ force = false } = {}) {
    if (this.cluster.stopped) return Promise.resolve();
    if (this.refreshPromise) {
      if (!force || this.refreshForced) return this.refreshPromise;
      if (!this.forcedRefreshPromise)
        this.forcedRefreshPromise = this.refreshPromise
          .catch(() => {})
          .then(() => this.refresh({ force: true }))
          .finally(() => {
            this.forcedRefreshPromise = undefined;
          });
      return this.forcedRefreshPromise;
    }
    const at = this.cluster.now();
    if (
      !force &&
      this.sampledAt !== undefined &&
      at >= this.sampledAt &&
      at - this.sampledAt < 250
    )
      return Promise.resolve();
    const rev = this.revision;
    this.refreshForced = force;
    this.refreshPromise = Promise.resolve()
      .then(() => this.cluster.poll())
      .finally(() => {
        if (rev === this.revision) this.sampledAt = at;
        this.refreshPromise = undefined;
        this.refreshForced = false;
      });
    return this.refreshPromise;
  }

  async poll() {
    const nodes = this.cluster.nodes().filter((node) => node.enabled);
    let index = 0;
    const worker = async () => {
      while (index < nodes.length && !this.cluster.stopped) {
        const node = nodes[index++];
        try {
          const remote = await nodeJson(node, "/v1/status", {
            signal: this.cluster.abort.signal,
            timeout: 5000,
          });
          if (
            this.cluster.stopped ||
            !this.cluster.nodes().some(
              (current) => current.id === node.id && current.enabled,
            )
          )
            continue;
          if (remote.protocol !== 1 || typeof remote.instanceId !== "string")
            throw new Error();
          if (node.instanceId !== remote.instanceId) {
            this.cluster.store.db
              .prepare("DELETE FROM cluster_locations WHERE node_id=?")
              .run(node.id);
            this.cluster.store.db
              .prepare("UPDATE cluster_nodes SET value=? WHERE id=?")
              .run(
                JSON.stringify({ ...node, instanceId: remote.instanceId }),
                node.id,
              );
          }
          this.cluster.health.set(node.id, {
            online: true,
            lastSeen: this.cluster.now(),
            remote,
          });
        } catch {
          if (
            this.cluster.stopped ||
            !this.cluster.nodes().some(
              (current) => current.id === node.id && current.enabled,
            )
          )
            continue;
          this.cluster.health.set(node.id, {
            ...this.cluster.health.get(node.id),
            online: false,
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, nodes.length) }, worker),
    );
  }
}
