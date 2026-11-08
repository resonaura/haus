/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { nodeJson } from '@haus/servers';
import { cameraAccessKey } from '@haus/media/access';
import { nvrCameraSource } from '../source-url.js';

export { cameraAccessKey };

export interface CameraAccessNode {
  id: string;
  key: string;
  url: string;
  allowHttp?: boolean;
  enabled?: boolean;
  roles: string[];
  livePriority?: number;
}

export interface CameraAccessHealth {
  online?: boolean;
  remote?: {
    features?: {
      directCameraAccess?: boolean;
      cameraAccessPolicy?: number;
    };
  };
}

export interface CameraAccessCluster {
  nodes(): CameraAccessNode[];
  health: ReadonlyMap<string, CameraAccessHealth>;
}

export interface CameraAccessCamera {
  id: string;
  aliases?: string[];
  available?: boolean;
  batteryPowered?: boolean;
  nativeProvider?: unknown;
  nativeSource?: { kind: 'rtsp' | 'p2p-restream'; url: string };
}

export interface CameraAccessRegistry {
  states?: { entity_id: string; state: string; attributes?: Record<string, unknown> }[];
  entities?: {
    entity_id: string;
    device_id?: string;
    platform?: string;
    disabled_by?: unknown;
    hidden_by?: unknown;
  }[];
  cameras: CameraAccessCamera[];
}

export interface CameraAccessSessions {
  registry(): CameraAccessRegistry;
  camera(cameraId: string): CameraAccessCamera | undefined;
  advertiseHost(node: CameraAccessNode): Promise<string>;
}

export interface CameraAccessConfig {
  pre_roll_seconds?: number;
  record_audio?: boolean;
}

export interface CameraAccessIssuedNode {
  nodeId: string;
  livePriority: number;
  url: string;
  allowHttp: boolean;
  id: string;
  cameraId: string;
  expiresAt: number;
  key: string;
}

export interface CameraAccessIssuedResult {
  cameraId: string;
  requestedId: string;
  expiresAt: number;
  nodes: CameraAccessIssuedNode[];
}

export type CameraAccessJson = (
  node: CameraAccessNode,
  path: string,
  input?: Parameters<typeof nodeJson>[2],
) => Promise<unknown>;

/** Provision camera-only capabilities over the existing paired node channel. Root keys never leave Helper. */
export class CameraAccessBootstrap {
  sessions: CameraAccessSessions;
  cluster: CameraAccessCluster;
  config: CameraAccessConfig;
  json: CameraAccessJson;
  now: () => number;
  pending = new Map<string, Promise<CameraAccessIssuedResult>>();
  reconciling: Promise<PromiseSettledResult<unknown>[]> | undefined = undefined;

  constructor({
    sessions,
    cluster,
    config,
    json = nodeJson,
    now = Date.now,
  }: {
    sessions: CameraAccessSessions;
    cluster: CameraAccessCluster;
    config: CameraAccessConfig;
    json?: CameraAccessJson;
    now?: () => number;
  }) {
    this.sessions = sessions;
    this.cluster = cluster;
    this.config = config;
    this.json = json;
    this.now = now;
  }

  nodes(): CameraAccessNode[] {
    return this.cluster
      .nodes()
      .filter((node) => {
        const health = this.cluster.health.get(node.id);
        return (
          node.enabled &&
          node.roles.includes('stream') &&
          health?.online &&
          health.remote?.features?.directCameraAccess === true &&
          health.remote?.features?.cameraAccessPolicy === 1
        );
      })
      .slice(0, 8);
  }

  reconcile(): Promise<unknown> {
    if (this.reconciling) return this.reconciling;
    const registry = this.sessions.registry();
    // Startup has no authoritative inventory yet. HA disconnect retains its last registry.
    if (!registry.states?.length) return Promise.resolve();
    const states = new Map(registry.states.map((state) => [state.entity_id, state.state]));
    const cameras = registry.cameras
      .filter((camera) => {
        if ([camera.id, ...(camera.aliases ?? [])].some((id) => states.get(id) === 'off'))
          return false;
        try {
          nvrCameraSource(camera, registry);
          return true;
        } catch {
          return false;
        }
      })
      .map((camera) => camera.id)
      .slice(0, 256);
    const task = Promise.allSettled(
      this.nodes().map((node) =>
        this.json(node, '/v1/camera-access/reconcile', {
          method: 'POST',
          timeout: 3000,
          data: { cameras },
        }),
      ),
    ).finally(() => {
      if (this.reconciling === task) this.reconciling = undefined;
    });
    this.reconciling = task;
    return task;
  }

  bootstrap(cameraId: string, clientId: string): Promise<CameraAccessIssuedResult> {
    if (!/^camera\.[a-z0-9_]+$/.test(cameraId) || !/^[a-f0-9-]{36}$/.test(clientId))
      throw Error('invalid_camera_access');
    const key = `${cameraId}:${clientId}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 32) throw Error('camera_access_busy');
    const task = this.issue(cameraId, clientId).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  async issue(cameraId: string, clientId: string): Promise<CameraAccessIssuedResult> {
    const camera = this.sessions.camera(cameraId);
    if (!camera?.available) throw Error('camera_unavailable');
    const source = nvrCameraSource(camera, this.sessions.registry());
    // Stable windows allow simultaneous instances on the same installation
    // to coexist without rotating each other's still-valid key.
    const expiresAt = (Math.floor(this.now() / 43200000) + 2) * 43200000;
    const id = createHash('sha256')
      .update([clientId, camera.id, expiresAt].join('\n'))
      .digest('hex')
      .slice(0, 32);
    const nodes = this.nodes();
    const issued = await Promise.allSettled(
      nodes.map(async (node) => {
        const result = (await this.json(node, '/v1/camera-access', {
          method: 'POST',
          timeout: 10000,
          data: {
            id,
            cameraId: camera.id,
            expiresAt,
            source,
            advertiseHost: await this.sessions.advertiseHost(node),
            preRollSeconds: this.config.pre_roll_seconds,
            requireAudio: this.config.record_audio !== false,
            recordAudio: this.config.record_audio !== false,
            batteryPowered: Boolean(camera.batteryPowered),
          },
        })) as { id?: string; cameraId?: string; expiresAt?: number };
        if (result.id !== id || result.cameraId !== camera.id || result.expiresAt !== expiresAt)
          throw Error('invalid_camera_access_response');
        return {
          nodeId: node.id,
          livePriority: node.livePriority ?? 0,
          url: node.url,
          allowHttp: Boolean(node.allowHttp),
          id,
          cameraId: camera.id,
          expiresAt,
          key: cameraAccessKey(node.key, id, camera.id, expiresAt),
        };
      }),
    );
    if (!this.sessions.camera(cameraId)?.available) {
      await this.reconcile();
      throw Error('camera_unavailable');
    }
    return {
      cameraId: camera.id,
      requestedId: cameraId,
      expiresAt,
      nodes: issued.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    };
  }
}
