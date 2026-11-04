/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash, randomBytes } from 'node:crypto';
import { cameraFailureCode } from './node-client.mjs';
import { kitsuneDeviceIdentity } from '@haus/kitsune';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const uuid = (value) => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

/** Camera-only capabilities cannot change sources, HomeKit pairing or the cluster. */
export class HaCameras {
  constructor({
    store,
    registry,
    snapshots,
    sessions,
    now = Date.now,
    onRevoke = () => {},
    log = (value) => console.warn(JSON.stringify(value)),
  }) {
    Object.assign(this, { store, registry, snapshots, sessions, now, onRevoke, log });
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS ha_camera_clients(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,created_at INTEGER NOT NULL)',
    );
    if (
      !store.db
        .prepare('PRAGMA table_info(ha_camera_clients)')
        .all()
        .some((column) => column.name === 'native_entities')
    )
      store.db.exec(
        'ALTER TABLE ha_camera_clients ADD COLUMN native_entities INTEGER NOT NULL DEFAULT 0',
      );
    this.codes = new Map();
    this.viewers = new Map();
    this.stopped = false;
    this.timer = setInterval(() => void this.tick().catch(() => {}), 15000);
    this.timer.unref();
  }
  setup(input) {
    if (input.action === 'revoke' && /^[a-f0-9]{24}$/.test(input.clientId)) {
      this.onRevoke(input.clientId);
      this.store.db.prepare('DELETE FROM ha_camera_clients WHERE id=?').run(input.clientId);
      for (const state of this.viewers.values())
        if (state.clientId === input.clientId) void this.close(state);
      return { revoked: true };
    }
    if (
      input.action !== 'setup' ||
      Object.keys(input).some((key) => !['action', 'nativeEntities'].includes(key)) ||
      (input.nativeEntities !== undefined && typeof input.nativeEntities !== 'boolean')
    )
      throw Error('invalid_ha_integration');
    for (const [key, value] of this.codes) if (value.until < this.now()) this.codes.delete(key);
    if (this.codes.size >= 4) this.codes.delete(this.codes.keys().next().value);
    const setupCode = randomBytes(24).toString('hex'),
      expiresAt = this.now() + 600000;
    this.codes.set(hash(setupCode), {
      until: expiresAt,
      nativeEntities: input.nativeEntities === true,
    });
    return {
      setupCode,
      expiresAt,
      nativeEntities: input.nativeEntities === true,
      url: 'http://127.0.0.1:8099',
    };
  }
  enroll(input) {
    if (typeof input?.code !== 'string' || !/^[a-f0-9]{48}$/.test(input.code))
      throw Error('invalid_ha_setup_code');
    const digest = hash(input.code),
      scope = this.codes.get(digest);
    this.codes.delete(digest);
    if (!scope || scope.until < this.now() || this.stopped) throw Error('invalid_ha_setup_code');
    if (this.store.db.prepare('SELECT count(*) AS n FROM ha_camera_clients').get().n >= 16)
      throw Error('ha_integration_busy');
    const token = randomBytes(32).toString('hex'),
      id = randomBytes(12).toString('hex');
    this.store.db
      .prepare(
        'INSERT INTO ha_camera_clients(id,token_hash,created_at,native_entities)VALUES(?,?,?,?)',
      )
      .run(id, hash(token), this.now(), scope.nativeEntities ? 1 : 0);
    return { clientId: id, token, profile: 1, nativeEntities: scope.nativeEntities };
  }
  canManageNative(clientId) {
    return (
      this.store.db
        .prepare('SELECT native_entities FROM ha_camera_clients WHERE id=?')
        .get(clientId)?.native_entities === 1
    );
  }
  authenticate(req) {
    const authorization = req.headers.authorization ?? '';
    let token = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1];
    // HA Generic Camera supports Basic auth for still images. This compatibility
    // form cannot list cameras, create viewers or perform any mutation.
    if (
      !token &&
      req.method === 'GET' &&
      /^\/ha\/cameras\/camera\.[a-z0-9_]+\/snapshot$/.test(req.url ?? '')
    ) {
      const encoded = /^Basic ([A-Za-z0-9+/=]{1,128})$/i.exec(authorization)?.[1];
      if (encoded)
        token = /^haus:([a-f0-9]{64})$/.exec(Buffer.from(encoded, 'base64').toString('utf8'))?.[1];
    }
    return token
      ? this.store.db
          .prepare('SELECT id FROM ha_camera_clients WHERE token_hash=?')
          .get(hash(token))?.id
      : undefined;
  }
  async revoke(clientId) {
    this.onRevoke(clientId);
    this.store.db.prepare('DELETE FROM ha_camera_clients WHERE id=?').run(clientId);
    await Promise.allSettled(
      [...this.viewers.values()]
        .filter((state) => state.clientId === clientId)
        .map((state) => this.close(state)),
    );
    return { revoked: true };
  }
  cameras() {
    return this.registry().cameras.map((camera) => ({
      id: camera.id,
      name: camera.name,
      available: camera.available === true,
      deviceId: camera.deviceId ?? null,
      areaId: camera.areaId ?? null,
      ...(camera.kitsuneProvider ? { native: { ...kitsuneDeviceIdentity(camera.kitsuneProvider), primary: true } } : {}),
      ...(camera.nativeProvider
        ? {
            native: {
              ...camera.nativeProvider,
              primary:
                !!this.registry().states?.length &&
                !this.registry().states.some(
                  (state) =>
                    state.entity_id === camera.id &&
                    this.registry().entities?.find((entry) => entry.entity_id === camera.id)
                      ?.platform !== 'haus' &&
                    !state.attributes?.haus_camera_proxy &&
                    state.attributes?.haus_native_camera !== 1,
                ),
            },
          }
        : {}),
    }));
  }
  async command(clientId, id, action, input) {
    const camera = this.registry().cameras.find((camera) => camera.id === id);
    if (!camera) throw Error('camera_not_found');
    if (action === 'snapshot') return this.snapshots.snapshot(camera);
    if (!uuid(input?.sessionId)) throw Error('invalid_camera_viewer');
    const key = `${clientId}:${input.sessionId}`;
    if (action === 'viewer') {
      if (this.viewers.has(key) || this.viewers.size >= 32) throw Error('camera_viewer_busy');
      const state = {
        clientId,
        cameraId: camera.id,
        owner: `ha-${clientId}-${input.sessionId}`,
        viewerId: input.sessionId,
        until: this.now() + 60000,
        key,
      };
      this.viewers.set(key, state);
      const started = this.now();
      try {
        return await this.sessions.viewer(camera, state.owner, state.viewerId, input.offer);
      } catch (error) {
        try {
          this.log({
            component: 'ha-camera',
            event: 'viewer-open-failed',
            cameraId: camera.id,
            reason: cameraFailureCode(error),
            elapsedMs: Math.max(0, this.now() - started),
            ...(Number.isInteger(error.status) && error.status >= 100 && error.status <= 599
              ? { status: error.status }
              : {}),
          });
        } catch {
          /* Diagnostics cannot interrupt viewer cleanup. */
        }
        await this.close(state);
        throw error;
      }
    }
    const state = this.viewers.get(key);
    if (!state || state.cameraId !== camera.id) throw Error('camera_session_not_found');
    state.until = this.now() + 60000;
    if (action === 'close') {
      await this.close(state);
      return { closed: true };
    }
    if (action === 'candidate')
      return this.sessions.viewerCandidate(camera.id, state.owner, state.viewerId, input.candidate);
    if (action === 'lease') {
      await this.sessions.ensure(camera, state.owner);
      return { renewed: true };
    }
    throw Error('invalid_camera_action');
  }
  async close(state) {
    this.viewers.delete(state.key);
    await this.sessions.closeViewer(state.cameraId, state.owner, state.viewerId).catch(() => {});
    await this.sessions.release(state.cameraId, state.owner).catch(() => {});
  }
  async tick() {
    for (const state of this.viewers.values())
      if (state.until < this.now()) await this.close(state);
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await Promise.allSettled([...this.viewers.values()].map((state) => this.close(state)));
    this.codes.clear();
  }
}
