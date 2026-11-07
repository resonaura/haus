/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { archivePending, archivedMedia } from "../recording-archive.mjs";
import { RecordingCache } from "../recording-cache.mjs";
import { randomUUID } from "node:crypto";
import { nodeAddress, nodeRequest, nodeJson } from "@haus/servers";
import {
  prepareClusterPlayback,
  playbackCandidates,
} from "./playback.mjs";
import { ClusterHealthTracker } from "./health.mjs";
import { ClusterReplicationEngine } from "./replication.mjs";
const validSshServerId = (value) =>
  typeof value === "string" &&
  /^ssh:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
    value,
  );
export class Cluster {
  constructor(store, backups, { catalog, now = Date.now } = {}) {
    if (!catalog) throw new Error("cluster_catalog_required");
    this.store = store;
    this.backups = backups;
    this.catalog = catalog;
    this.now = now;
    this.health = new Map();
    this.stopped = false;
    this.abort = new AbortController();
    this.errors = new Map();
    this.playbackNodes = new Set();
    this.blobPins = new Map();
    this.blobDeletes = new Map();
    this.healthTracker = new ClusterHealthTracker(this);
    this.replicationEngine = new ClusterReplicationEngine(this);
  }
  async initialize() {
    await this.catalog.initialize();
    this.store.clusterCatalog = this.catalog;
  }
  nodes() {
    return this.catalog
      .nodes()
      .map((row) => ({ id: row.id, ...JSON.parse(row.value) }));
  }
  /** Pins synchronize replica adoption and temporary playback against pruning. */
  async pinBlob(nodeId, digest) {
    const key = `${nodeId}:${digest}`;
    while (this.blobDeletes.has(key)) await this.blobDeletes.get(key);
    this.abort.signal.throwIfAborted();
    this.blobPins.set(key, (this.blobPins.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.blobPins.get(key) ?? 1) - 1;
      if (remaining) this.blobPins.set(key, remaining);
      else this.blobPins.delete(key);
    };
  }
  notePlaybackUpload(nodeId, digest) {
    return this.catalog.ensureLocation(digest, nodeId, "preparation");
  }
  canPreparePlayback() {
    return playbackCandidates(this).length > 0;
  }
  preparePlayback(event, options) {
    return prepareClusterPlayback(this, event, options);
  }
  status() {
    const backups = this.backups.list();
    return {
      optional: true,
      nodes: this.nodes().map(({ key, ...node }) => ({
        ...node,
        ...this.health.get(node.id),
        error: this.errors.get(node.id),
        backupCopies: this.catalog.backupCount(node.id),
      })),
      backups: {
        items: backups,
        busy: this.backups.busy,
        error: this.backups.error,
      },
      sync: { enabled: true, authority: "helper" },
      busy: this.busy,
    };
  }
  async add(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 100 ||
      typeof input.key !== "string" ||
      input.key.length < 32 ||
      input.key.length > 256 ||
      typeof input.allowHttp !== "boolean" ||
      !Array.isArray(input.roles) ||
      input.roles.length > 2 ||
      input.roles.some((role) => !["storage", "stream"].includes(role)) ||
      (input.sshServerId !== undefined && !validSshServerId(input.sshServerId))
    )
      throw new Error("invalid_node");
    const node = {
      id: randomUUID(),
      name: input.name.trim(),
      url: nodeAddress(input.url, input.allowHttp),
      key: input.key,
      roles: [...new Set(input.roles)],
      allowHttp: input.allowHttp,
      enabled: true,
      ...(input.sshServerId ? { sshServerId: input.sshServerId } : {}),
    };
    if (this.nodes().some((item) => item.url === node.url))
      throw new Error("invalid_duplicate_node");
    if (
      node.sshServerId &&
      this.nodes().some((item) => item.sshServerId === node.sshServerId)
    )
      throw new Error("invalid_duplicate_ssh_server");
    const status = await nodeJson(node, "/v1/status", {
      signal: this.abort.signal,
      timeout: 10000,
    });
    if (
      status.protocol !== 1 ||
      typeof status.nodeId !== "string" ||
      !status.storage ||
      !status.streams
    )
      throw new Error("invalid_node_protocol");
    if (
      Array.isArray(status.roles) &&
      node.roles.some((role) => !status.roles.includes(role))
    )
      throw new Error("invalid_node_roles");
    // Enrollment requests can overlap while checking different remote hosts.
    // Recheck identities immediately before the synchronous catalog write.
    if (this.nodes().some((item) => item.url === node.url))
      throw new Error("invalid_duplicate_node");
    if (
      node.sshServerId &&
      this.nodes().some((item) => item.sshServerId === node.sshServerId)
    )
      throw new Error("invalid_duplicate_ssh_server");
    node.instanceId = status.instanceId;
    await this.catalog.saveNode({ id: node.id, value: JSON.stringify(node) });
    this.health.set(node.id, {
      online: true,
      lastSeen: Date.now(),
      remote: status,
    });
    this.invalidateHealth();
    this.backups.markChanged();
    return { ...this.status(), pairedNodeId: node.id };
  }
  async update(id, patch) {
    const node = this.nodes().find((node) => node.id === id);
    if (!node) throw new Error("invalid_node");
    if (
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch) ||
      !Object.keys(patch).length ||
      Object.keys(patch).some(
        (key) => !["enabled", "storageLimitBytes", "sshServerId", "livePriority"].includes(key),
      ) ||
      (patch.enabled !== undefined && typeof patch.enabled !== "boolean") ||
      (patch.livePriority !== undefined && (!Number.isInteger(patch.livePriority) || patch.livePriority < 0 || patch.livePriority > 100)) ||
      (patch.sshServerId !== undefined &&
        patch.sshServerId !== null &&
        !validSshServerId(patch.sshServerId)) ||
      (Object.hasOwn(patch, "sshServerId") &&
        Object.keys(patch).length !== 1) ||
      (patch.storageLimitBytes !== undefined &&
        patch.storageLimitBytes !== null &&
        (!Number.isSafeInteger(patch.storageLimitBytes) ||
          patch.storageLimitBytes < 1024 ** 2))
    )
      throw new Error("invalid_node");
    if (
      patch.sshServerId &&
      this.nodes().some(
        (item) => item.id !== id && item.sshServerId === patch.sshServerId,
      )
    )
      throw new Error("invalid_duplicate_ssh_server");
    if (Object.hasOwn(patch, "storageLimitBytes")) {
      const settings = await nodeJson(node, "/v1/settings", {
        method: "PATCH",
        data: { storageLimitBytes: patch.storageLimitBytes },
        signal: this.abort.signal,
        timeout: 10000,
      });
      if (settings.storageLimitBytes !== patch.storageLimitBytes)
        throw new Error("invalid_node_settings");
      const health = this.health.get(id);
      if (health?.remote)
        this.health.set(id, {
          ...health,
          remote: {
            ...health.remote,
            settings,
            storage: {
              ...health.remote.storage,
              storageLimitBytes: settings.storageLimitBytes,
            },
          },
        });
    }
    const updated = {
        ...node,
        ...(patch.livePriority !== undefined ? { livePriority: patch.livePriority } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(Object.hasOwn(patch, "sshServerId")
          ? { sshServerId: patch.sshServerId }
          : {}),
      };
    await this.catalog.saveNode({ id, value: JSON.stringify(updated) });
    this.invalidateHealth();
    this.backups.markChanged();
    return this.status();
  }
  async remove(id) {
    await this.catalog.removeNode(id);
    this.health.delete(id);
    this.invalidateHealth();
    this.backups.markChanged();
    return this.status();
  }
  get busy() {
    return this.replicationEngine.busy;
  }
  set busy(val) {
    this.replicationEngine.busy = val;
  }
  get running() {
    return this.replicationEngine.running;
  }
  set running(val) {
    this.replicationEngine.running = val;
  }
  get healthRevision() {
    return this.healthTracker.revision;
  }
  set healthRevision(val) {
    this.healthTracker.revision = val;
  }
  get healthSampledAt() {
    return this.healthTracker.sampledAt;
  }
  set healthSampledAt(val) {
    this.healthTracker.sampledAt = val;
  }
  get healthRefresh() {
    return this.healthTracker.running;
  }
  get healthRefreshForced() {
    return this.healthTracker.refreshForced;
  }
  get forcedHealthRefresh() {
    return this.healthTracker.forcedRunning;
  }
  invalidateHealth() {
    this.healthTracker.invalidate();
  }
  refreshHealth(options) {
    return this.healthTracker.refresh(options);
  }
  poll() {
    return this.healthTracker.poll();
  }
  replicate(file, digest, kind, nodes) {
    return this.replicationEngine.replicate(file, digest, kind, nodes);
  }
  replicatePinned(file, digest, kind, nodes) {
    return this.replicationEngine.replicatePinned(file, digest, kind, nodes);
  }
  tick() {
    return this.replicationEngine.tick();
  }
  work() {
    return this.replicationEngine.work();
  }
  prune(nodes) {
    return this.replicationEngine.prune(nodes);
  }
  enableRecordingCache(config, catalog) {
    this.recordingCache = new RecordingCache(config, this.store, this, catalog);
    return this.recordingCache;
  }
  archiveMedia(event, variant, range, signal, method) {
    return archivedMedia(this, event, variant, range, signal, method);
  }
  async source(event) {
    const media = this.catalog.media(event.id);
    if (media?.version !== event.playbackVersion) return null;
    if (!media) return null;
    const locations = new Set(
      this.catalog.locationsForDigest(media.digest).map((row) => row.nodeId),
    );
    const nodes = this.nodes()
      .filter(
        (node) =>
          node.enabled &&
          node.roles.includes("stream") &&
          locations.has(node.id) &&
          this.health.get(node.id)?.online,
      )
      .sort(
        (a, b) =>
          (this.health.get(a.id)?.remote.streams.active ?? 0) -
          (this.health.get(b.id)?.remote.streams.active ?? 0),
      );
    for (const node of nodes)
      try {
        const grant = await nodeJson(node, "/v1/grants", {
          method: "POST",
          data: { digest: media.digest },
          signal: this.abort.signal,
          timeout: 5000,
        });
        if (
          typeof grant.path !== "string" ||
          !grant.path.startsWith(`/media/${media.digest}?`)
        )
          continue;
        return {
          url: new URL(grant.path, node.url).href,
          expiresAt: grant.expiresAt,
        };
      } catch {}
    return null;
  }
  async media(event, range, signal) {
    const media = this.catalog.media(event.id);
    if (media?.version !== event.playbackVersion) return null;
    if (!media) return null;
    const locations = new Set(
      this.catalog.locationsForDigest(media.digest).map((row) => row.nodeId),
    );
    const candidates = this.nodes()
      .filter(
        (node) =>
          node.enabled &&
          node.roles.includes("stream") &&
          locations.has(node.id) &&
          this.health.get(node.id)?.online,
      )
      .sort(
        (a, b) =>
          (this.health.get(a.id)?.remote.streams.active ?? 0) -
          (this.health.get(b.id)?.remote.streams.active ?? 0),
      );
    for (const node of candidates) {
      try {
        const response = await nodeRequest(node, `/v1/blobs/${media.digest}`, {
          signal,
          timeout: 600000,
          headerTimeout: 3000,
          headers: range ? { Range: range } : {},
        });
        if (response.ok) return response;
        await response.body?.cancel();
      } catch {}
    }
    return null;
  }
  async stop() {
    this.stopped = true;
    this.abort.abort();
    await Promise.allSettled([
      this.running,
      this.healthRefresh,
      this.forcedHealthRefresh,
      this.recordingCache?.running,
    ]);
  }
}
