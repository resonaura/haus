/*
 * Haus — A thoughtful home for Home Assistant.
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
  constructor(store, backups, { now = Date.now } = {}) {
    this.store = store;
    this.backups = backups;
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
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS cluster_nodes(id TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS cluster_locations(digest TEXT NOT NULL,node_id TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(digest,node_id));
 CREATE TABLE IF NOT EXISTS cluster_media(event_id TEXT PRIMARY KEY,digest TEXT NOT NULL,bytes INTEGER NOT NULL,version INTEGER NOT NULL);`);
    // Existing blob copies remain valid; their catalog may predate newly
    // supported repair fields. Reconcile metadata without uploading the blob.
    const columns = new Set(
      store.db
        .prepare("PRAGMA table_info(cluster_locations)")
        .all()
        .map((column) => column.name),
    );
    if (!columns.has("catalog_version"))
      store.db.exec(
        "ALTER TABLE cluster_locations ADD COLUMN catalog_version INTEGER NOT NULL DEFAULT 0",
      );
    if (!columns.has("metadata_hash"))
      store.db.exec(
        "ALTER TABLE cluster_locations ADD COLUMN metadata_hash TEXT",
      );
  }
  nodes() {
    return this.store.db
      .prepare("SELECT id,value FROM cluster_nodes")
      .all()
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
    this.store.db
      .prepare(
        "INSERT INTO cluster_locations(digest,node_id,kind)VALUES(?,?,'preparation') ON CONFLICT(digest,node_id)DO NOTHING",
      )
      .run(digest, nodeId);
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
        backupCopies: this.store.db
          .prepare(
            "SELECT count(*) AS n FROM cluster_locations WHERE node_id=? AND kind='backup'",
          )
          .get(node.id).n,
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
    this.store.db
      .prepare("INSERT INTO cluster_nodes(id,value)VALUES(?,?)")
      .run(node.id, JSON.stringify(node));
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
    this.store.db.prepare("UPDATE cluster_nodes SET value=? WHERE id=?").run(
      JSON.stringify({
        ...node,
        ...(patch.livePriority !== undefined ? { livePriority: patch.livePriority } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(Object.hasOwn(patch, "sshServerId")
          ? { sshServerId: patch.sshServerId }
          : {}),
      }),
      id,
    );
    this.invalidateHealth();
    this.backups.markChanged();
    return this.status();
  }
  remove(id) {
    this.store.db.prepare("DELETE FROM cluster_nodes WHERE id=?").run(id);
    this.store.db
      .prepare("DELETE FROM cluster_locations WHERE node_id=?")
      .run(id);
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
  enableRecordingCache(config) {
    this.recordingCache = new RecordingCache(config, this.store, this);
    return this.recordingCache;
  }
  archiveMedia(event, variant, range, signal, method) {
    return archivedMedia(this, event, variant, range, signal, method);
  }
  async source(event) {
    const media = this.store.db
      .prepare("SELECT * FROM cluster_media WHERE event_id=? AND version=?")
      .get(event.id, event.playbackVersion);
    if (!media) return null;
    const locations = new Set(
      this.store.db
        .prepare("SELECT node_id FROM cluster_locations WHERE digest=?")
        .all(media.digest)
        .map((row) => row.node_id),
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
    const media = this.store.db
      .prepare("SELECT * FROM cluster_media WHERE event_id=? AND version=?")
      .get(event.id, event.playbackVersion);
    if (!media) return null;
    const locations = new Set(
      this.store.db
        .prepare("SELECT node_id FROM cluster_locations WHERE digest=?")
        .all(media.digest)
        .map((row) => row.node_id),
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
