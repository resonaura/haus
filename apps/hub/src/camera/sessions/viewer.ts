/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import {
  missing,
  ownerId,
  uuid,
  type NvrCameraSessionsHost,
  type SessionCamera,
  type SessionEntry,
  type SessionNode,
  type ViewerEntry,
} from './types.js';

export function liveCandidates(host: NvrCameraSessionsHost): SessionNode[] {
  return host.cluster
    .nodes()
    .filter((node) => node.enabled && node.roles.includes('stream') && host.validNode(node))
    .sort(
      (a, b) =>
        (b.livePriority ?? 0) - (a.livePriority ?? 0) ||
        (host.nodeLoad(a).remote?.resources?.cpu ?? 0) -
          (host.nodeLoad(b).remote?.resources?.cpu ?? 0),
    );
}

export async function peerEntry(
  host: NvrCameraSessionsHost,
  camera: SessionCamera,
  owner: string,
  source: SessionEntry,
  node: SessionNode,
): Promise<SessionEntry> {
  if (source.node.id === node.id) return host.ensure(camera, owner, false, node, true);
  const prior = host.entries.get(`${camera.id}:${owner}`);
  if (prior?.node.id === node.id && prior.peerSource === source.owner)
    return host.ensure(camera, owner, false, node, true);
  const grant = (await host.json(source.node, '/v1/rtsp-peer/grant', {
    method: 'POST',
    data: { sessionId: source.id, owner: source.owner },
    timeout: 5000,
  })) as { token?: string; path?: string };
  const value = await host.json(node, '/v1/cameras/sessions', {
    method: 'POST',
    data: {
      cameraId: camera.id,
      owner,
      advertiseHost: await host.advertiseHost(node),
      preRollSeconds: host.config.pre_roll_seconds,
      requireAudio: host.config.record_audio !== false,
      recordAudio: host.config.record_audio !== false,
      peer: {
        url: source.node.url,
        allowHttp: source.node.allowHttp,
        token: grant.token,
        path: grant.path,
      },
    },
    signal: host.abort.signal,
    timeout: 15000,
  });
  host.validateSession(value);
  const entry: SessionEntry = {
    ...source,
    ...value,
    node,
    owner,
    peerSource: source.owner,
    until: host.now() + 60000,
  };
  host.entries.set(`${camera.id}:${owner}`, entry);
  if (prior) await host.releaseEntry(prior);
  return entry;
}

export async function ensureLive(
  host: NvrCameraSessionsHost,
  camera: SessionCamera,
  owner: string,
): Promise<SessionEntry> {
  const choices = host.liveCandidates();
  if (!((choices[0]?.livePriority ?? 0) > 0))
    return host.ensure(camera, owner, false, undefined, true);
  const sourceOwner = `peer-source-${createHash('sha256').update(owner).digest('hex').slice(0, 32)}`;
  let retained = false;
  try {
    const source = await host.ensure(camera, sourceOwner, false, undefined, true);
    for (const node of choices) {
      if (!((node.livePriority ?? 0) > 0) || node.id === source.node.id) break;
      if (
        !host.cluster.health.get(node.id)?.remote?.features?.rtspPeer ||
        !host.cluster.health.get(source.node.id)?.remote?.features?.rtspPeer
      )
        continue;
      try {
        const entry = await host.peerEntry(camera, owner, source, node);
        retained = entry.peerSource === sourceOwner;
        return entry;
      } catch {
        /* A preferred worker never prevents a direct healthy viewer. */
      }
    }
    return await host.ensure(camera, owner, false, source.node, true);
  } finally {
    // Failed peer/direct opens have no viewer entry through which close() could release this owner.
    // Successful peer viewers retain it until their own close; recording owners are never touched.
    if (!retained) await host.release(camera.id, sourceOwner).catch(() => {});
  }
}

export async function openViewer(
  host: NvrCameraSessionsHost,
  camera: SessionCamera,
  owner: string,
  viewerId: string,
  offer: unknown,
): Promise<{ answer: { type: string; sdp: string }; candidates: unknown[] }> {
  if (
    !ownerId(owner) ||
    !uuid(viewerId) ||
    typeof offer !== 'string' ||
    offer.length > 64000 ||
    !offer.startsWith('v=0')
  )
    throw missing('invalid_camera_viewer');
  const key = `${owner}:${viewerId}`;
  if (host.closedViewers.has(key)) throw missing('camera_viewer_closed');
  if (host.viewers.has(key)) throw missing('camera_viewer_exists');
  if (host.viewers.size >= 64) throw missing('camera_viewer_busy');
  const task = (async () => {
    // A node can restart while the short warm-lease cache is still fresh.
    // Confirm its producer exists before sending a browser offer, allowing
    // ensure() to reopen/fail over rather than fail the first camera open.
    const entry = await host.ensureLive(camera, owner);
    const result = (await host.json(entry.node, `/v1/cameras/sessions/${entry.id}/webrtc`, {
      method: 'POST',
      data: { owner, offer },
      signal: host.abort.signal,
      timeout: 20000,
    })) as {
      viewerId?: string;
      answer?: { type?: string; sdp?: string };
      candidates?: unknown[];
    };
    if (
      !uuid(result?.viewerId) ||
      result.answer?.type !== 'answer' ||
      typeof result.answer.sdp !== 'string' ||
      result.answer.sdp.length > 64000
    )
      throw missing('invalid_camera_viewer_response');
    const viewer: ViewerEntry = { ...entry, viewerId, remoteId: result.viewerId };
    if (host.stopped || host.closedViewers.has(key)) {
      await host.deleteViewer(viewer);
      throw missing('camera_viewer_closed');
    }
    host.viewers.set(key, viewer);
    return {
      answer: { type: 'answer', sdp: result.answer.sdp },
      candidates: Array.isArray(result.candidates) ? result.candidates.slice(0, 128) : [],
    };
  })();
  host.viewers.set(key, {
    cameraId: camera.id,
    owner,
    viewerId,
    pending: task,
  });
  try {
    return await task;
  } catch (error) {
    if (host.viewers.get(key)?.pending === task) host.viewers.delete(key);
    throw error;
  }
}

export async function deleteViewer(
  host: NvrCameraSessionsHost,
  viewer: ViewerEntry,
): Promise<void> {
  if (!viewer.node || !viewer.id || !viewer.remoteId) return;
  await host
    .request(viewer.node, `/v1/cameras/sessions/${viewer.id}/viewers/${viewer.remoteId}`, {
      method: 'DELETE',
      data: { owner: viewer.owner },
      timeout: 5000,
    })
    .then((r) => r.body?.cancel())
    .catch(() => {});
}

export async function viewerCandidate(
  host: NvrCameraSessionsHost,
  cameraId: string,
  owner: string,
  viewerId: string,
  candidate: { candidate?: unknown } | undefined,
): Promise<unknown> {
  const viewer = host.viewers.get(`${owner}:${viewerId}`);
  if (
    !viewer ||
    viewer.cameraId !== cameraId ||
    viewer.pending ||
    !viewer.node ||
    !viewer.id ||
    !candidate ||
    typeof candidate.candidate !== 'string' ||
    candidate.candidate.length > 2048
  )
    throw Error('invalid_camera_candidate');
  return host.json(viewer.node, `/v1/cameras/sessions/${viewer.id}/webrtc/candidate`, {
    method: 'POST',
    data: { owner, viewerId: viewer.remoteId, candidate },
    timeout: 5000,
    signal: host.abort.signal,
  });
}

export async function closeViewer(
  host: NvrCameraSessionsHost,
  cameraId: string,
  owner: string,
  viewerId: string,
): Promise<{ closed: boolean }> {
  if (!ownerId(owner) || !uuid(viewerId)) throw missing('invalid_camera_viewer');
  const key = `${owner}:${viewerId}`;
  host.closedViewers.set(key, host.now() + 120000);
  if (host.closedViewers.size > 512) {
    const oldest = host.closedViewers.keys().next().value;
    if (oldest) host.closedViewers.delete(oldest);
  }
  const viewer = host.viewers.get(key);
  if (viewer && viewer.cameraId !== cameraId) throw missing('camera_viewer_not_found');
  host.viewers.delete(key);
  if (viewer?.remoteId) await host.deleteViewer(viewer);
  return { closed: true };
}
