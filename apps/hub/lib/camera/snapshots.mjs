/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { bridgeSnapshotSource, fetchBridgeSnapshot } from '@haus/media/snapshot';
import { nodeRequest } from '@haus/servers';

/** Images come from a leased Haus source. HA camera_proxy is deliberately never an input. */
export class CameraSnapshots {
  constructor({
    config,
    sessions,
    localCapture,
    bridgeSource,
    bridgeCapture = fetchBridgeSnapshot,
    now = Date.now,
    request = nodeRequest,
  }) {
    Object.assign(this, {
      config,
      sessions,
      localCapture,
      bridgeSource,
      bridgeCapture,
      now,
      request,
    });
    this.cache = new Map();
    this.pending = new Map();
    this.active = 0;
    this.root = join(config.data, 'camera-snapshots');
  }
  file(id) {
    return join(this.root, `${createHash('sha256').update(id).digest('hex')}.jpg`);
  }
  async snapshot(camera) {
    if (!camera || !/^camera\.[a-z0-9_]+$/.test(camera.id)) throw Error('invalid_camera');
    const old = this.cache.get(camera.id);
    if (old && this.now() - old.checkedAt < 3000)
      return { ...old, stale: old.stale || this.now() - old.at >= 30000 };
    if (this.pending.has(camera.id)) return this.pending.get(camera.id);
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
        const value = { buffer, mime: 'image/jpeg', at, stale: true, checkedAt: this.now() };
        this.cache.set(camera.id, value);
        return value;
      })
      .finally(() => this.pending.delete(camera.id));
    this.pending.set(camera.id, task);
    return task;
  }
  async capture(camera) {
    let source;
    try {
      source =
        camera.nativeProvider ? await this.bridgeSource?.(camera) :
          bridgeSnapshotSource(camera, this.sessions.registry?.() ?? {}) ??
          (await this.bridgeSource?.(camera));
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
      const reader = response.body.getReader();
      const chunks = [];
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
  async remember(id, buffer, at = this.now(), stale = false) {
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
    const value = { buffer, mime: 'image/jpeg', at, stale, checkedAt: this.now() };
    this.cache.set(id, value);
    return value;
  }
  async stop() {
    await Promise.allSettled(this.pending.values());
  }
}
