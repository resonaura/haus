/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { nvrCameraSource, type NvrCameraSource } from '../source-url.js';
import {
  missing,
  ownerId,
  uuid,
  type NvrCameraSessionsHost,
  type SessionCamera,
  type SessionEntry,
  type SessionNode,
} from './types.js';

export async function ensureSession(
  host: NvrCameraSessionsHost,
  camera: SessionCamera | undefined,
  owner: string,
  preview = false,
  preferredNode?: SessionNode,
  refresh = false,
): Promise<SessionEntry> {
  if (host.stopped) throw missing('camera_sessions_stopped');
  if (!ownerId(owner)) throw missing('invalid_warm_session');
  if (!camera?.available) throw missing('camera_unavailable');
  const peer = host.entries.get(`${camera.id}:${owner}`);
  if (
    peer?.peerSource &&
    (!preferredNode || preferredNode.id === peer.node.id) &&
    host.validNode(peer.node)
  ) {
    try {
      await host.ensure(camera, peer.peerSource, false, undefined, refresh);
      const renewed = await host.json(peer.node, `/v1/cameras/sessions/${peer.id}/lease`, {
        method: 'POST',
        data: { owner },
        timeout: 5000,
        signal: host.abort.signal,
      });
      host.validateSession(renewed);
      peer.id = renewed.id;
      peer.state = renewed.state;
      peer.until = host.now() + 60000;
      return peer;
    } catch {
      await host.release(camera.id, owner);
    }
  }
  if (preview && camera.batteryPowered) throw missing('camera_battery_preview_disabled');
  const source = nvrCameraSource(camera, host.registry());
  const key = `${camera.id}:${owner}`;
  const revision = host.revisions.get(key) ?? 0;
  const prior = host.pending.get(key);
  if (prior) {
    await prior.catch(() => {});
    if ((host.revisions.get(key) ?? 0) !== revision) throw missing('camera_session_cancelled');
    return host.ensure(camera, owner, preview, preferredNode, refresh);
  }
  // Serialize acquisition per camera, not just per owner. A recording,
  // dashboard and viewer can arrive together before the first producer is
  // registered; later owners must see that producer before choosing a node.
  const priorCamera = host.cameraPending.get(camera.id);
  const task = (async () => {
    await priorCamera?.catch(() => {});
    if (host.stopped || (host.revisions.get(key) ?? 0) !== revision)
      throw missing('camera_session_cancelled');
    return host.acquire(camera, owner, source, key, preferredNode, revision, refresh);
  })();
  host.cameraPending.set(camera.id, task);
  host.pending.set(key, task);
  try {
    return await task;
  } finally {
    if (host.pending.get(key) === task) host.pending.delete(key);
    if (host.cameraPending.get(camera.id) === task) host.cameraPending.delete(camera.id);
  }
}

export async function acquireSession(
  host: NvrCameraSessionsHost,
  camera: SessionCamera,
  owner: string,
  source: NvrCameraSource,
  key: string,
  preferredNode: SessionNode | undefined,
  revision: number,
  refresh = false,
): Promise<SessionEntry> {
  const old = host.entries.get(key);
  const fingerprint = createHash('sha256').update(JSON.stringify(source)).digest('hex');
  if (
    old &&
    old.fingerprint === fingerprint &&
    host.validNode(old.node) &&
    (!preferredNode || old.node.id === preferredNode.id)
  ) {
    old.until = host.now() + 60000;
    if (!refresh && host.now() - old.renewedAt < (owner === host.recordingOwner ? 3000 : 15000))
      return old;
    try {
      const value = await host.json(old.node, `/v1/cameras/sessions/${old.id}/lease`, {
        method: 'POST',
        data: { owner },
        signal: host.abort.signal,
        timeout: 3500,
      });
      host.validateSession(value);
      host.failedNodes.delete(old.node.id);
      const entry: SessionEntry = {
        ...old,
        id: value.id,
        state: value.state,
        renewedAt: host.now(),
        until: host.now() + 60000,
        audio: value.audio,
      };
      if (host.stopped || (host.revisions.get(key) ?? 0) !== revision) {
        await host.releaseEntry(entry);
        throw missing('camera_session_cancelled');
      }
      host.entries.set(key, entry);
      await host.updateBuffer(entry);
      if (old && (old.node.id !== entry.node.id || old.id !== entry.id))
        void host.releaseEntry(old);
      return entry;
    } catch (error) {
      host.nodeFailure(old.node, error);
    }
  }
  const choices = preferredNode
    ? host.candidates().filter((node) => node.id === preferredNode.id)
    : host.candidates();
  const shared = [...host.entries.values()].find(
    (entry) =>
      entry.cameraId === camera.id &&
      !entry.peerSource &&
      entry.fingerprint === fingerprint &&
      host.validNode(entry.node) &&
      (!preferredNode || entry.node.id === preferredNode.id),
  );
  if (shared) {
    // Attaching another owner to a healthy producer consumes no new source
    // slot. Prefer it even when another node currently looks less loaded.
    // Otherwise previews/viewers duplicate the camera's P2P reader remotely.
    const index = choices.findIndex((node) => node.id === shared.node.id);
    if (index >= 0) choices.splice(index, 1);
    choices.unshift(shared.node);
  }
  const assigned = host.cluster
    .nodes()
    .find(
      (node) =>
        node.id === host.continuityAssignments.get(camera.id) &&
        host.validNode(node) &&
        host.cluster.health
          .get(node.id)
          ?.remote?.cameraContinuity?.cameras?.some(
            (plan) => plan.cameraId === camera.id && plan.expiresAt > host.now(),
          ),
    );
  if (!shared && assigned && (!preferredNode || assigned.id === preferredNode.id)) {
    const index = choices.findIndex((node) => node.id === assigned.id);
    if (index >= 0) choices.splice(index, 1);
    choices.unshift(assigned);
  }
  const activityNode = host.activityAssignedNode?.(camera);
  if (
    !shared &&
    !assigned &&
    activityNode &&
    host.validNode(activityNode) &&
    (!preferredNode || preferredNode.id === activityNode.id)
  ) {
    const index = choices.findIndex((node) => node.id === activityNode.id);
    if (index >= 0) choices.splice(index, 1);
    choices.unshift(activityNode);
  }
  if (
    old &&
    host.validNode(old.node) &&
    (!preferredNode || old.node.id === preferredNode.id) &&
    !choices.some((node) => node.id === old.node.id)
  )
    choices.unshift(old.node);
  for (const node of choices.slice(0, 3)) {
    host.reserveNode(node.id, 1);
    try {
      const value = await host.json(node, '/v1/cameras/sessions', {
        method: 'POST',
        data: {
          cameraId: camera.id,
          source,
          owner,
          advertiseHost: await host.advertiseHost(node),
          preRollSeconds: host.config.pre_roll_seconds,
          requireAudio: host.config.record_audio !== false,
          recordAudio: host.config.record_audio !== false,
        },
        signal: host.abort.signal,
        timeout: 15000,
      });
      host.validateSession(value);
      host.failedNodes.delete(node.id);
      const entry: SessionEntry = {
        node,
        id: value.id,
        cameraId: camera.id,
        owner,
        fingerprint,
        state: value.state,
        renewedAt: host.now(),
        until: host.now() + 60000,
        audio: value.audio,
      };
      if (host.stopped || (host.revisions.get(key) ?? 0) !== revision) {
        await host.releaseEntry(entry);
        throw missing('camera_session_cancelled');
      }
      host.entries.set(key, entry);
      await host.updateBuffer(entry);
      if (old && (old.node.id !== entry.node.id || old.id !== entry.id))
        void host.releaseEntry(old);
      return entry;
    } catch (error) {
      host.nodeFailure(node, error);
      if (host.stopped || (host.revisions.get(key) ?? 0) !== revision) throw error;
    } finally {
      host.reserveNode(node.id, -1);
    }
  }
  throw missing(choices.length ? 'camera_nvr_session_unavailable' : 'camera_nvr_required');
}

export function validateSession(value: unknown): asserts value is SessionEntry {
  const candidate = value as
    | {
        id?: unknown;
        state?: unknown;
        capabilities?: { webrtc?: unknown; recording?: unknown };
      }
    | undefined;
  if (
    !uuid(candidate?.id) ||
    (candidate.state !== 'ready' && candidate.state !== 'warming') ||
    candidate.capabilities?.webrtc !== true ||
    candidate.capabilities?.recording !== true
  )
    throw missing('invalid_camera_node_response');
}

export async function updateBuffer(
  host: NvrCameraSessionsHost,
  entry: SessionEntry,
): Promise<void> {
  await host.rememberAssignment(entry);
  const buffer = host.buffers.get(entry.cameraId);
  if (buffer && entry.owner === host.recordingOwner) {
    buffer.status = entry.state === 'ready' ? 'buffering' : 'starting';
    buffer.lastError = undefined;
    buffer.expectedAudio = host.config.record_audio !== false;
    if (entry.state === 'ready') {
      buffer.lastAdvance = host.now();
      buffer.lastSegmentAt = host.now();
    }
  }
}

export async function touchSession(
  host: NvrCameraSessionsHost,
  camera: SessionCamera,
  owner: string,
  active: boolean,
  preview = false,
): Promise<Record<string, unknown>> {
  if (!ownerId(owner) || typeof active !== 'boolean') throw missing('invalid_warm_session');
  if (!active) {
    await host.release(camera.id, owner);
    return { warm: false };
  }
  try {
    const entry = await host.ensure(camera, owner, preview);
    return {
      warm: true,
      transport: 'nvr-webrtc',
      sessionId: entry.id,
      state: entry.state,
      expiresAt: entry.until,
    };
  } catch (error) {
    return { warm: false, reason: (error as Error).message };
  }
}

export async function releaseEntry(
  host: NvrCameraSessionsHost,
  entry: SessionEntry,
): Promise<void> {
  await host
    .request(entry.node, `/v1/cameras/sessions/${entry.id}`, {
      method: 'DELETE',
      data: { owner: entry.owner },
      timeout: 5000,
    })
    .then((r) => r.body?.cancel())
    .catch(() => {});
}

export async function releaseSession(
  host: NvrCameraSessionsHost,
  cameraId: string,
  owner: string,
): Promise<void> {
  const key = `${cameraId}:${owner}`;
  const entry = host.entries.get(key);
  host.entries.delete(key);
  host.revisions.set(key, (host.revisions.get(key) ?? 0) + 1);
  for (const viewer of host.viewers.values())
    if (viewer.cameraId === cameraId && viewer.owner === owner)
      await host.closeViewer(cameraId, owner, viewer.viewerId);
  if (entry) await host.releaseEntry(entry);
  if (entry?.peerSource) await host.release(cameraId, entry.peerSource);
}
