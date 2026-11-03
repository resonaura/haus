/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import { CameraBridgeClient, cameraBridgeEndpoint } from '@haus/bridge/client';
import { cameraSource } from '@haus/media/source';
import { NativeCameraIdentities } from './native-camera-identities.mjs';

/** Enroll first; exposing HA entities and confirming MQTT retirement are separate operations. */
export class NativeProviders {
  constructor({
    store,
    onChanged = () => {},
    now = Date.now,
    endpoint = cameraBridgeEndpoint,
    enroll = CameraBridgeClient.enroll,
    client = (connection) => new CameraBridgeClient(connection),
    validateSource = cameraSource,
  }) {
    Object.assign(this, { store, onChanged, now, endpoint, enroll, client, validateSource });
    this.identities = new NativeCameraIdentities(store.db, onChanged);
    this.live = new Map();
    this.pending = new Map();
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS native_providers(id TEXT PRIMARY KEY,connection TEXT NOT NULL,created_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS native_provider_controller(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)',
    );
    store.db
      .prepare('INSERT OR IGNORE INTO native_provider_controller(id,value)VALUES(1,?)')
      .run(randomUUID());
    this.controllerId = store.db
      .prepare('SELECT value FROM native_provider_controller WHERE id=1')
      .get().value;
  }
  connections() {
    return this.store.db
      .prepare('SELECT id,connection FROM native_providers ORDER BY id')
      .all()
      .map((row) => ({ id: row.id, connection: JSON.parse(row.connection) }));
  }
  list() {
    return this.connections().map(({ id, connection }) => ({
      id,
      provider: connection.provider,
      url: connection.endpoint.url,
      available: !!this.live.get(id) && this.now() - this.live.get(id).at < 30000,
      cameras: this.live.get(id)?.inventory.cameras.length ?? 0,
    }));
  }
  async add(input) {
    if (
      !input ||
      typeof input.url !== 'string' ||
      typeof input.code !== 'string' ||
      typeof input.allowHttp !== 'boolean' ||
      Object.keys(input).sort().join(',') !== 'allowHttp,code,url'
    )
      throw Error('invalid_native_provider');
    const endpoint = await this.endpoint(input.url, input.allowHttp),
      client = await this.enroll(endpoint, input.code, this.controllerId);
    const id = client.connection.bridgeId;
    if (this.connections().some((row) => row.id === id)) {
      await client.revoke().catch(() => {});
      throw Error('native_provider_exists');
    }
    try {
      const inventory = await this.validate(await client.inventory());
      this.store.db
        .prepare('INSERT INTO native_providers(id,connection,created_at)VALUES(?,?,?)')
        .run(id, JSON.stringify(client.connection), this.now());
      this.live.set(id, { at: this.now(), inventory });
      this.onChanged();
      return this.list().find((provider) => provider.id === id);
    } catch (error) {
      await client.revoke().catch(() => {});
      throw error;
    }
  }
  async validate(inventory) {
    for (const camera of inventory.cameras) {
      if (inventory.provider === 'aqara' && camera.stream.transport !== 'p2p')
        throw Error('camera_protected_p2p_source_required');
      const source = await this.validateSource({
        kind: camera.stream.transport === 'p2p' ? 'p2p-restream' : 'rtsp',
        url: camera.stream.url,
      });
      const host = new URL(source.url).hostname.replace(/^\[|\]$/g, '');
      if (host === '::1' || host.startsWith('127.')) throw Error('invalid_camera_source');
      camera.stream.url = source.url;
    }
    return inventory;
  }
  async refresh(id) {
    if (this.pending.has(id)) return this.pending.get(id);
    const stored = this.connections().find((row) => row.id === id);
    if (!stored) throw Error('native_provider_not_found');
    const pending = (async () => {
      const inventory = await this.validate(await this.client(stored.connection).inventory());
      // A delayed response cannot restore a removed provider.
      if (
        !this.connections().some(
          (row) =>
            row.id === id && JSON.stringify(row.connection) === JSON.stringify(stored.connection),
        )
      )
        throw Error('native_provider_not_found');
      this.live.set(id, { inventory, at: this.now() });
      return inventory;
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, pending);
    return pending;
  }
  async tick() {
    const rows = this.connections();
    for (let offset = 0; offset < rows.length; offset += 2)
      await Promise.allSettled(rows.slice(offset, offset + 2).map((row) => this.refresh(row.id)));
  }
  inventory(id) {
    const state = this.live.get(id);
    if (!state) throw Error('native_provider_unavailable');
    return { ...structuredClone(state.inventory), reachable: this.now() - state.at < 30000 };
  }
  bind(id, physicalId, legacyCameraId) {
    const camera = this.inventory(id).cameras.find((camera) => camera.id === physicalId);
    if (!camera) throw Error('native_camera_not_found');
    return this.identities.resolve(id, camera.id, legacyCameraId);
  }
  async confirm(id, revision, readyKeys) {
    const stored = this.connections().find((row) => row.id === id);
    if (!stored) throw Error('native_provider_not_found');
    // Only call after the HA adapter confirms every entity and any migration completes.
    return this.client(stored.connection).ready(revision, readyKeys);
  }
  async remove(id) {
    const stored = this.connections().find((row) => row.id === id);
    if (!stored) throw Error('native_provider_not_found');
    await this.client(stored.connection).revoke();
    this.store.db.prepare('DELETE FROM native_providers WHERE id=?').run(id);
    this.live.delete(id);
    this.onChanged();
    // Keep the physical → recording camera ID mapping; a reconnect must not orphan clips.
  }
}
