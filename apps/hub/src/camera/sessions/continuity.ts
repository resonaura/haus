/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { nvrCameraSource } from '../source-url.js';
import {
  missing,
  privateIp,
  type NvrCameraSessionsHost,
  type SessionEntry,
  type SessionNode,
  type SessionNodeRemote,
} from './types.js';

export async function rememberAssignment(
  host: NvrCameraSessionsHost,
  entry: SessionEntry,
): Promise<void> {
  if (
    entry.owner !== host.recordingOwner ||
    host.continuityAssignments.get(entry.cameraId) === entry.node.id
  )
    return;
  await host.persistence.saveAssignment(entry.cameraId, entry.node.id);
  host.continuityAssignments.set(entry.cameraId, entry.node.id);
  host.continuitySent.clear();
}

export async function syncContinuity(host: NvrCameraSessionsHost, force = false): Promise<void> {
  if (host.continuityBusy || host.stopped || !host.registry().states?.length) return;
  host.continuityBusy = true;
  try {
    const registry = host.registry();
    const states = new Map((registry.states ?? []).map((state) => [state.entity_id, state.state]));
    await Promise.allSettled(
      host.cluster
        .nodes()
        .filter(
          (node) =>
            host.cluster.health.get(node.id)?.online &&
            host.cluster.health.get(node.id)?.remote?.features?.cameraContinuity === 1,
        )
        .map(async (node) => {
          const cameras: Record<string, unknown>[] = [];
          for (const camera of registry.cameras) {
            if (
              !node.enabled ||
              !node.roles.includes('stream') ||
              !camera.enabled ||
              !host.config.recording_enabled ||
              host.continuityAssignments.get(camera.id) !== node.id ||
              [camera.id, ...(camera.aliases ?? [])].some((id) => states.get(id) === 'off')
            )
              continue;
            try {
              cameras.push({
                cameraId: camera.id,
                source: nvrCameraSource(camera, registry),
                advertiseHost: await host.advertiseHost(node),
                preRollSeconds: host.config.pre_roll_seconds,
                requireAudio: host.config.record_audio !== false,
                recordAudio: host.config.record_audio !== false,
              });
            } catch {}
          }
          const fingerprint = createHash('sha256').update(JSON.stringify(cameras)).digest('hex');
          const previous = host.continuitySent.get(node.id);
          if (!force && previous?.fingerprint === fingerprint && host.now() - previous.at < 30000)
            return;
          const expiresAt = host.now() + 24 * 3600000;
          await host.json(node, '/v1/camera-continuity', {
            method: 'PUT',
            data: {
              cameras: cameras.map((camera) => ({ ...camera, expiresAt })),
            },
            signal: host.abort.signal,
            timeout: 5000,
          });
          host.continuitySent.set(node.id, { fingerprint, at: host.now() });
        }),
    );
  } finally {
    host.continuityBusy = false;
  }
}

export async function clearContinuityNode(host: NvrCameraSessionsHost, id: string): Promise<void> {
  await host.clearActivityNode?.(id);
  const node = host.cluster.nodes().find((item) => item.id === id);
  if (node && host.cluster.health.get(id)?.remote?.features?.cameraContinuity === 1)
    await host.json(node, '/v1/camera-continuity', {
      method: 'PUT',
      data: { cameras: [] },
      signal: host.abort.signal,
      timeout: 5000,
    });
}

export function nodeLoad(
  host: NvrCameraSessionsHost,
  node: SessionNode,
): {
  remote: SessionNodeRemote | undefined;
  capability: SessionNodeRemote['rtspSessions'];
  active: number;
} {
  const remote = host.cluster.health.get(node.id)?.remote;
  const capability = remote?.rtspSessions;
  const managed = new Set(
    [...host.entries.values()]
      .filter((entry) => entry.node.id === node.id)
      .map((entry) => entry.id),
  ).size;
  return {
    remote,
    capability,
    active: Math.max(capability?.active ?? 0, managed) + (host.nodeReservations.get(node.id) ?? 0),
  };
}

export function sourceHealth(
  host: NvrCameraSessionsHost,
): { id: string; available: boolean; expiresAt: number }[] {
  return (host.cameras ?? []).slice(0, 256).map((camera) => {
    const buffer = host.buffers.get(camera.id);
    const expiresAt =
      buffer?.status === 'buffering' &&
      !buffer.stopped &&
      typeof buffer.lastAdvance === 'number' &&
      Number.isFinite(buffer.lastAdvance)
        ? buffer.lastAdvance + 15000
        : 0;
    return {
      id: camera.id,
      available: Boolean(camera.available && expiresAt > host.now()),
      expiresAt,
    };
  });
}

export function candidates(host: NvrCameraSessionsHost): SessionNode[] {
  return host.cluster
    .nodes()
    .filter((node) => {
      const health = host.cluster.health.get(node.id);
      const { remote, capability, active } = host.nodeLoad(node);
      return Boolean(
        node.enabled &&
        (host.failedNodes.get(node.id)?.until ?? 0) <= host.now() &&
        node.roles.includes('stream') &&
        health?.online &&
        capability?.profile === 1 &&
        capability.webrtc === true &&
        capability.recording === true &&
        capability.max > active &&
        !remote?.resources?.pressured,
      );
    })
    .sort((a, b) => {
      const score = (node: SessionNode) => {
        const { remote, capability, active } = host.nodeLoad(node);
        return (
          active / Math.max(1, capability?.max ?? 1) +
          (remote?.host?.cpu?.usage ?? remote?.resources?.cpu ?? 0)
        );
      };
      return score(a) - score(b);
    });
}

export function reserveNode(host: NvrCameraSessionsHost, nodeId: string, delta: number): void {
  const next = (host.nodeReservations.get(nodeId) ?? 0) + delta;
  if (next > 0) host.nodeReservations.set(nodeId, next);
  else host.nodeReservations.delete(nodeId);
}

export function validNode(host: NvrCameraSessionsHost, node: SessionNode): boolean {
  return Boolean(
    (host.failedNodes.get(node.id)?.until ?? 0) <= host.now() &&
    host.cluster
      .nodes()
      .some(
        (current) => current.id === node.id && current.enabled && current.roles.includes('stream'),
      ) &&
    host.cluster.health.get(node.id)?.online,
  );
}

export function nodeFailure(host: NvrCameraSessionsHost, node: SessionNode, error: unknown): void {
  if (host.stopped || host.abort.signal.aborted) return;
  const err = error as { name?: string; status?: number; code?: string } | undefined;
  // Source rejection/capacity is not evidence that every camera on a node failed.
  if (
    !['TypeError', 'AbortError', 'TimeoutError'].includes(err?.name ?? '') &&
    ![502, 504].includes(err?.status ?? 0) &&
    err?.code !== 'node_unavailable'
  )
    return;
  const failures = Math.min(4, (host.failedNodes.get(node.id)?.failures ?? 0) + 1);
  host.failedNodes.set(node.id, {
    failures,
    until: host.now() + Math.min(30000, 3000 * 2 ** (failures - 1)),
  });
  if (host.failedNodes.size > 64) {
    const oldest = host.failedNodes.keys().next().value;
    if (oldest) host.failedNodes.delete(oldest);
  }
}

export async function advertiseHost(
  host: NvrCameraSessionsHost,
  node: SessionNode,
): Promise<string> {
  const hostname = new URL(node.url).hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await host.resolve(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !privateIp(address)))
    throw missing('camera_node_private_address_required');
  return addresses[0].address;
}
