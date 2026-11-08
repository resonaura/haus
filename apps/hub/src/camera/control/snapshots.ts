/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bridgeSnapshotSource,
  fetchBridgeSnapshot,
  type BridgeSnapshotSource,
} from '@haus/media/snapshot';
import { nodeRequest } from '@haus/servers';

export interface SnapshotCamera {
  id: string;
  available?: boolean;
  aliases?: string[];
  deviceId?: string | null;
  deviceIds?: string[];
  nativeProvider?: { bridgeId: string; [key: string]: unknown };
}

export interface SnapshotEntry {
  buffer: Buffer;
  mime: string;
  at: number;
  stale: boolean;
  checkedAt: number;
}

export interface SnapshotSessions {
  registry?: () => {
    states?: { entity_id: string; state: string; attributes?: Record<string, unknown> }[];
    entities?: {
      entity_id: string;
      device_id?: string | null;
      platform?: string;
      disabled_by?: unknown;
      hidden_by?: unknown;
    }[];
  };
  cluster: {
    nodes(): { id: string; url: string; key: string; enabled?: boolean; roles: string[] }[];
  };
  ensure(
    camera: SnapshotCamera,
    owner: string,
  ): Promise<{ id: string; node: { id: string; url: string; key: string; allowHttp?: boolean } }>;
  advertiseHost(node: {
    id: string;
    url: string;
    key: string;
    allowHttp?: boolean;
  }): Promise<string>;
  release(cameraId: string, owner: string): Promise<void>;
}

/** Images come from a leased Haus source. HA camera_proxy is deliberately never an input. */
export class CameraSnapshots {
  config: { data: string };
  sessions: SnapshotSessions;
  localCapture?: (camera: SnapshotCamera) => Promise<{ buffer: Buffer }>;
  bridgeSource?: (
    camera: SnapshotCamera,
  ) => Promise<BridgeSnapshotSource | undefined> | BridgeSnapshotSource | undefined;
  bridgeCapture: typeof fetchBridgeSnapshot;
  now: () => number;
  request: typeof nodeRequest;
  cache = new Map<string, SnapshotEntry>();
  pending = new Map<string, Promise<SnapshotEntry>>();
  active = 0;
  root: string;

  constructor({
    config,
    sessions,
    localCapture,
    bridgeSource,
    bridgeCapture = fetchBridgeSnapshot,
    now = Date.now,
    request = nodeRequest,
  }: {
    config: { data: string };
    sessions: SnapshotSessions;
    localCapture?: (camera: SnapshotCamera) => Promise<{ buffer: Buffer }>;
    bridgeSource?: (
      camera: SnapshotCamera,
    ) => Promise<BridgeSnapshotSource | undefined> | BridgeSnapshotSource | undefined;
    bridgeCapture?: typeof fetchBridgeSnapshot;
    now?: () => number;
    request?: typeof nodeRequest;
  }) {
    this.config = config;
    this.sessions = sessions;
    this.localCapture = localCapture;
    this.bridgeSource = bridgeSource;
    this.bridgeCapture = bridgeCapture;
    this.now = now;
    this.request = request;
    this.root = join(config.data, 'camera-snapshots');
  }

  file(id: string): string {
    return join(this.root, `${createHash('sha256').update(id).digest('hex')}.jpg`);
  }

  async snapshot(camera: SnapshotCamera | undefined): Promise<SnapshotEntry> {
    if (!camera || !/^camera\.[a-z0-9_]+$/.test(camera.id)) throw Error('invalid_camera');
    const old = this.cache.get(camera.id);
    if (old && this.now() - old.checkedAt < 3000)
      return { ...old, stale: old.stale || this.now() - old.at >= 30000 };
    const existing = this.pending.get(camera.id);
    if (existing) return existing;
    const task = this.capture(camera)
      .catch(async () => {
        if (old) {
          const value = { ...old, stale: true, checkedAt: this.now() };
          this.cache.set(camera.id, value);
          return value;
        }
        const buffer = await readFile(this.file(camera.id));
        if (buffer.length > 6 * 1024 ** 2 || buffer[0] !== 255 || buffer[1] !== 216)
          throw Error('snapshot_unavailable');
        const at = (await stat(this.file(camera.id))).mtimeMs;
        const value: SnapshotEntry = {
          buffer,
          mime: 'image/jpeg',
          at,
          stale: true,
          checkedAt: this.now(),
        };
        this.cache.set(camera.id, value);
        return value;
      })
      .finally(() => this.pending.delete(camera.id));
    this.pending.set(camera.id, task);
    return task;
  }

  async capture(camera: SnapshotCamera): Promise<SnapshotEntry> {
    let source: BridgeSnapshotSource | undefined;
    try {
      if (camera.nativeProvider) {
        source = await this.bridgeSource?.(camera);
      } else {
        const registry = this.sessions.registry?.() ?? {};
        source =
          bridgeSnapshotSource(
            {
              id: camera.id,
              aliases: camera.aliases,
              deviceId: camera.deviceId ?? undefined,
              deviceIds: camera.deviceIds,
            },
            {
              states: registry.states,
              entities: registry.entities?.map((entity) => ({
                ...entity,
                device_id: entity.device_id ?? undefined,
              })),
            },
          ) ?? (await this.bridgeSource?.(camera));
      }
    } catch {
      /* Missing optional discovery does not block older providers. */
    }
    if (source) {
      // An advertised provider never falls through to a potentially generated Offline stream.
      const image = await this.bridgeCapture(source, { now: this.now });
      return await this.remember(camera.id, image.buffer, image.at, image.stale);
    }
    if (this.active >= 2) throw Error('snapshot_busy');
    this.active++;
    const owner = `snapshot-${randomUUID()}`;
    try {
      if (
        this.localCapture &&
        !this.sessions.cluster.nodes().some((node) => node.enabled && node.roles.includes('stream'))
      ) {
        const image = await this.localCapture(camera);
        return await this.remember(camera.id, image.buffer);
      }
      const entry = await this.sessions.ensure(camera, owner);
      const response = await this.request(entry.node, '/v1/homekit', {
        method: 'POST',
        timeout: 12000,
        data: {
          action: 'snapshot',
          cameraId: camera.id,
          owner,
          sessionId: entry.id,
          address: await this.sessions.advertiseHost(entry.node),
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw Error('snapshot_unavailable');
      }
      const reader = response.body?.getReader();
      if (!reader) throw Error('snapshot_unavailable');
      const chunks: Buffer[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 6 * 1024 ** 2) throw Error('snapshot_too_large');
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const buffer = Buffer.concat(chunks);
      return await this.remember(camera.id, buffer);
    } finally {
      this.active--;
      await this.sessions.release(camera.id, owner);
    }
  }

  async remember(
    id: string,
    buffer: Buffer,
    at = this.now(),
    stale = false,
  ): Promise<SnapshotEntry> {
    if (!buffer || buffer.length > 6 * 1024 ** 2 || buffer[0] !== 255 || buffer[1] !== 216)
      throw Error('snapshot_unavailable');
    const previous = this.cache.get(id);
    if (previous?.at === at && previous.buffer.equals(buffer)) {
      const value = { ...previous, stale, checkedAt: this.now() };
      this.cache.set(id, value);
      return value;
    }
    await mkdir(this.root, { mode: 0o700, recursive: true });
    const file = this.file(id);
    await writeFile(file + '.next', buffer, { mode: 0o600 });
    await utimes(file + '.next', at / 1000, at / 1000);
    await rename(file + '.next', file);
    const value: SnapshotEntry = { buffer, mime: 'image/jpeg', at, stale, checkedAt: this.now() };
    this.cache.set(id, value);
    return value;
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.pending.values());
  }
}
