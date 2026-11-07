/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash, randomUUID } from "node:crypto";
import { nodeJson } from "@haus/servers";
import { nvrCameraSource } from "../camera/sessions.mjs";

/** Controller-authorized history fences catalog adoption; settings never opt in implicitly. */
export class AutonomousActivity {
  constructor({
    store,
    config,
    cluster,
    sessions,
    catalog = sessions.catalog,
    now = Date.now,
    json = nodeJson,
  }) {
    Object.assign(this, { store, config, cluster, sessions, now, json });
    this.sent = new Map();
    this.pending = new Map();
    this.revokingNodes = new Set();
    this.observed = new Map();
    this.assignments = new Map();
    this.interruptedCursors = new Map();
    if (!catalog) throw Error("camera_catalog_required");
    this.catalog = catalog.activity;
    this.queuedTriggers = Promise.resolve();
  }
  active(id) {
    return this.catalog.active(id);
  }
  enabled(camera) {
    if (
      !camera?.enabled ||
      !camera.motionDetection?.enabled ||
      !this.config.recording_enabled
    )
      return false;
    const states = new Map(
      (this.sessions.registry().states ?? []).map((row) => [
        row.entity_id,
        row.state,
      ]),
    );
    return ![camera.id, ...(camera.aliases ?? [])].some(
      (id) => states.get(id) === "off",
    );
  }
  capable(node) {
    return (
      node?.enabled &&
      !this.revokingNodes.has(node.id) &&
      node.roles.includes("stream") &&
      this.cluster.health.get(node.id)?.online &&
      this.cluster.health.get(node.id)?.remote?.features
        ?.autonomousCameraActivity === 1
    );
  }
  priorNode(camera) {
    const policy = this.active(camera.id);
    const node = this.cluster
      .nodes()
      .find((node) => node.id === policy?.nodeId);
    if (!this.enabled(camera) || !this.capable(node)) return undefined;
    return this.cluster.health
      .get(node.id)
      ?.remote?.cameraActivity?.cameras?.some(
        (plan) =>
          plan.cameraId === camera.id &&
          plan.policyId === policy.policyId &&
          plan.expiresAt > this.now(),
      )
      ? node
      : undefined;
  }
  ensure(camera, node) {
    const task = (this.assignments.get(camera.id) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.ensureOne(camera, node));
    this.assignments.set(camera.id, task);
    return task.finally(() => {
      if (this.assignments.get(camera.id) === task)
        this.assignments.delete(camera.id);
    });
  }
  async retire(policy) {
    await this.catalog.retire(policy.policyId, this.now());
    this.observed.delete(policy.cameraId);
    this.sent.delete(policy.nodeId);
    this.cluster.backups?.markChanged?.();
  }
  async drainReleases(cameraId) {
    await this.catalog.expireReleases(this.now());
    const releases = this.catalog.releases(cameraId);
    for (const release of releases) {
      const node = this.cluster
        .nodes()
        .find((node) => node.id === release.nodeId);
      // An unreachable old owner cannot acknowledge revocation. Retain the
      // release for rejoin and fence its new events locally, without blocking
      // a healthy admitted replacement indefinitely.
      if (!this.capable(node)) continue;
      await this.pending.get(node.id)?.catch(() => {});
      await this.syncNode(node, true);
    }
  }
  async ensureOne(camera, node) {
    if (this.stopped) throw Error("activity_stopped");
    let policy = this.active(camera.id);
    if (!this.enabled(camera) || !this.capable(node))
      throw Error("activity_assignment_unavailable");
    if (!policy || policy.nodeId !== node.id) {
      if (policy) await this.retire(policy);
      await this.drainReleases(camera.id);
      if (this.stopped || !this.enabled(camera) || !this.capable(node))
        throw Error("activity_assignment_unavailable");
      const id = randomUUID();
      await this.catalog.savePolicy({policyId: id, cameraId: camera.id, nodeId: node.id, createdAt: this.now(), expiresAt: this.now() + 86340000, revokedAt: null});
      policy = this.active(camera.id);
      this.cluster.backups?.markChanged?.();
      this.sent.delete(node.id);
    }
    await this.syncNode(node);
    const status = await this.json(node, "/v1/camera-activity", {
      timeout: 4000,
    });
    const current = status.cameras?.find(
      (plan) =>
        plan.cameraId === camera.id && plan.policyId === policy.policyId,
    );
    if (!current) throw Error("activity_assignment_unavailable");
    this.observed.set(camera.id, current);
    if (current.admitted === false) throw Error("activity_source_capacity");
    return current;
  }
  syncNode(node, force = false) {
    if (this.pending.has(node.id))
      return force
        ? this.pending.get(node.id).then(() => this.syncNode(node, true))
        : this.pending.get(node.id);
    const task = this.send(node, force).finally(() => {
      if (this.pending.get(node.id) === task) this.pending.delete(node.id);
    });
    this.pending.set(node.id, task);
    return task;
  }
  async send(node, force) {
    if (this.stopped || !this.capable(node)) return;
    const registry = this.sessions.registry(),
      plans = [],
      expiresAt = this.now() + 86340000;
    for (const policy of this.catalog.policies(node.id)) {
      const camera = registry.cameras.find(
        (camera) => camera.id === policy.cameraId,
      );
      if (!this.enabled(camera)) {
        await this.retire(policy);
        continue;
      }
      plans.push({
        cameraId: camera.id,
        policyId: policy.policyId,
        mode: camera.motionDetection.mode,
        source: nvrCameraSource(camera, registry),
        advertiseHost: await this.sessions.advertiseHost(node),
        requireAudio: this.config.record_audio !== false,
        recordAudio: this.config.record_audio !== false,
        preRollSeconds: this.config.pre_roll_seconds,
        postRollSeconds: this.config.post_roll_seconds,
        maxEventSeconds: this.config.max_event_seconds,
        expiresAt,
      });
    }
    const fingerprint = createHash("sha256")
        .update(
          JSON.stringify(plans.map((plan) => ({ ...plan, expiresAt: 0 }))),
        )
        .digest("hex"),
      old = this.sent.get(node.id);
    if (
      !force &&
      old?.fingerprint === fingerprint &&
      this.now() - old.at < 30000
    )
      return;
    await this.json(node, "/v1/camera-activity", {
      method: "PUT",
      data: { cameras: plans },
      timeout: 6000,
    });
    await this.catalog.acknowledge(node.id, plans.map(plan => plan.policyId), expiresAt);
    this.sent.set(node.id, { fingerprint, at: this.now() });
  }
  async revoke(id) {
    const policy = this.active(id);
    if (!policy) return;
    await this.retire(policy);
    const node = this.cluster
      .nodes()
      .find((node) => node.id === policy.nodeId);
    this.sent.delete(policy.nodeId);
    if (node) {
      await this.pending.get(node.id)?.catch(() => {});
      await this.syncNode(node, true);
    }
  }
  async clearNode(id) {
    const node = this.cluster.nodes().find((node) => node.id === id);
    if (
      !node ||
      this.cluster.health.get(id)?.remote?.features
        ?.autonomousCameraActivity !== 1
    )
      return;
    this.revokingNodes.add(id);
    try {
      await this.pending.get(id)?.catch(() => {});
      await this.json(node, "/v1/camera-activity", {
        method: "PUT",
        data: { cameras: [] },
        timeout: 6000,
      });
      await this.catalog.clearNode(id, this.now());
      this.cluster.backups?.markChanged?.();
      this.sent.delete(id);
    } finally {
      this.revokingNodes.delete(id);
    }
  }
  authorizes(node, value) {
    const event = value?.event,
      origin = event?.origin;
    if (
      origin?.kind !== "camera-activity" ||
      !/^[a-f0-9-]{36}$/.test(origin.policyId ?? "")
    )
      return false;
    const policy = this.catalog.policy(origin.policyId, event.cameraId, node.id);
    return Boolean(
      policy &&
      Number.isSafeInteger(event.startAt) &&
      Number.isSafeInteger(event.endAt) &&
      event.startAt >= policy.createdAt - 30000 &&
      event.startAt <=
        Math.min(policy.expiresAt, policy.revokedAt ?? Infinity) &&
      event.endAt <=
        Math.min(policy.expiresAt, policy.revokedAt ?? Infinity) + 300000 &&
      event.endAt > event.startAt &&
      event.endAt - event.startAt <= 300000 &&
      Array.isArray(event.kinds) &&
      event.kinds.length > 0 &&
      event.kinds.length <= 5 &&
      event.kinds.every((kind) =>
        ["motion", "person", "pet", "vehicle", "doorbell"].includes(kind),
      ),
    );
  }
  async sync() {
    for (const node of this.cluster.nodes())
      await this.syncNode(node).catch(() => {});
    await this.flushTriggers();
    await this.recoverInterrupted();
  }
  async recoverInterrupted() {
    for (const node of this.cluster
      .nodes()
      .filter((node) => this.capable(node))) {
      try {
        const cursor = this.interruptedCursors.get(node.id);
        const result = await this.json(
          node,
          "/v1/camera-activity/interrupted" +
            (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""),
          { timeout: 4000 },
        );
        if (!Array.isArray(result.items)) continue;
        this.interruptedCursors.set(
          node.id,
          /^\d{1,16}$/.test(result.nextCursor ?? "")
            ? result.nextCursor
            : undefined,
        );
        for (const value of result.items.slice(0, 16)) {
          if (
            value.state !== "interrupted" ||
            !/^[a-f0-9-]{36}$/.test(value.event?.id ?? "") ||
            !this.sessions.camera(value.event.cameraId) ||
            !this.authorizes(node, value)
          )
            continue;
          const previous = await this.store.get(value.event.id);
          if (previous && previous.cameraId !== value.event.cameraId) continue;
          if (!previous) await this.store.adoptActivity(value.event);
          await this.store.interruptActivity(value.event.id, value.error);
          this.cluster.backups?.markChanged?.();
          await this.json(
            node,
            `/v1/camera-activity/interrupted/${value.event.id}`,
            { method: "POST", data: {}, timeout: 4000 },
          );
        }
      } catch {
        /* Keep the interrupted journal until the home records its state. */
      }
    }
  }
  triggerNative(id, kind, source, at) {
    if (this.stopped) return false;
    const policy = this.active(id),
      camera = this.sessions.camera(id);
    if (!policy || policy.expiresAt <= this.now() || !this.enabled(camera))
      return false;
    const remote = this.cluster.health
      .get(policy.nodeId)
      ?.remote?.cameraActivity?.cameras?.find(
        (plan) => plan.cameraId === id && plan.policyId === policy.policyId,
      );
    const observed = this.observed.get(id) ?? remote;
    if (
      observed?.policyId !== policy.policyId ||
      observed.admitted !== true ||
      observed.ready !== true
    )
      return false;
    if (
      !Number.isSafeInteger(at) ||
      Math.abs(at - this.now()) > 30000 ||
      !["motion", "person", "pet", "vehicle", "doorbell"].includes(kind)
    )
      return true;
    const token = createHash("sha256")
      .update(JSON.stringify([policy.policyId, id, kind, source, at]))
      .digest("hex")
      .slice(0, 32);
    const requestId = `${token.slice(0, 8)}-${token.slice(8, 12)}-${token.slice(12, 16)}-${token.slice(16, 20)}-${token.slice(20)}`;
    const row = {
      requestId,
      nodeId: policy.nodeId,
      value: JSON.stringify({requestId, cameraId: id, policyId: policy.policyId, kind, at}),
      expiresAt: at + 30000,
    };
    this.queuedTriggers = this.queuedTriggers.then(() => this.catalog.enqueue(row));
    void this.queuedTriggers.then(() => this.flushTriggers()).catch(error => {
      this.triggerError = error;
      process.emitWarning(error);
    });
    return true;
  }
  flushTriggers() {
    if (this.flushing) return this.flushing;
    this.flushing = this.sendTriggers().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }
  async sendTriggers() {
    if (this.stopped) return;
    await this.queuedTriggers;
    await this.catalog.expireTriggers(this.now());
    for (const row of this.catalog.triggers()) {
      const value = JSON.parse(row.value),
        policy = this.active(value.cameraId),
        node = this.cluster.nodes().find((node) => node.id === row.nodeId);
      if (!policy || policy.policyId !== value.policyId) {
        await this.catalog.removeTrigger(row.requestId);
        continue;
      }
      if (!this.capable(node)) continue;
      try {
        await this.json(node, "/v1/camera-activity/trigger", {
          method: "POST",
          data: value,
          timeout: 4000,
        });
        await this.catalog.removeTrigger(row.requestId);
      } catch {
        /* Retry the same recording intent only; never issue another physical command. */
      }
    }
  }
  async stop() {
    this.stopped = true;
    await Promise.allSettled(this.assignments.values());
    await Promise.allSettled(this.pending.values());
    await this.queuedTriggers;
    await this.flushing;
  }
}
