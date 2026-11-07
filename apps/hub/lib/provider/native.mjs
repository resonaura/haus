import { protectedNativeTransport } from '@haus/kitsune/native';
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { CameraBridgeClient, cameraBridgeEndpoint } from '@haus/bridge/client';
import { cameraSource } from '@haus/media/source';
import { validateCommand } from '@haus/bridge/protocol';
import { NativeCameraIdentities } from '../camera/identities.mjs';
import { privateIp } from '@haus/media/source';

/** Enroll first; exposing HA entities and confirming MQTT retirement are separate operations. */
export class NativeProviders {
  constructor({
    store,
    catalog,
    onChanged = () => {},
    now = Date.now,
    endpoint = cameraBridgeEndpoint,
    enroll = CameraBridgeClient.enroll,
    client = (connection) => new CameraBridgeClient(connection),
    validateSource = cameraSource,
    resolve = lookup,
  }) {
    Object.assign(this, {
      store,
      onChanged,
      now,
      endpoint,
      enroll,
      client,
      validateSource,
      resolve,
    });
    if (!catalog) throw Error('camera_catalog_required');
    this.catalog = catalog.native;
    this.identities = new NativeCameraIdentities(catalog, onChanged);
    this.live = new Map();
    this.pending = new Map();
    this.controllerId = this.catalog.controllerId;
  }
  connections() {
    return this.catalog.providers().map((row) => ({ id: row.id, connection: JSON.parse(row.connection) }));
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
      await this.catalog.addProvider({id, connection: JSON.stringify(client.connection), createdAt: this.now()});
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
      if (!protectedNativeTransport(inventory.provider, camera.stream.transport))
        throw Error('camera_protected_p2p_source_required');
      const source = await this.validateSource({
        kind: camera.stream.transport === 'p2p' ? 'p2p-restream' : 'rtsp',
        url: camera.stream.url,
      });
      const host = new URL(source.url).hostname.replace(/^\[|\]$/g, '');
      if (host === '::1' || host.startsWith('127.')) throw Error('invalid_camera_source');
      camera.stream.url = source.url;
      if (camera.talkback) {
        const target = new URL(camera.talkback.url),
          host = target.hostname.replace(/^\[|\]$/g, '');
        let timer;
        const addresses = isIP(host)
          ? [{ address: host }]
          : await Promise.race([
              this.resolve(host, { all: true }),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(Error('invalid_native_talkback')), 2500);
              }),
            ]).finally(() => clearTimeout(timer));
        if (
          !addresses.length ||
          addresses.some(
            ({ address }) => !privateIp(address) || address.startsWith('127.') || address === '::1',
          )
        )
          throw Error('invalid_native_talkback');
        target.hostname = addresses[0].address.includes(':')
          ? `[${addresses[0].address}]`
          : addresses[0].address;
        camera.talkback.url = target.href;
      }
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
  async releaseNative(id) {
    const stored = this.connections().find((row) => row.id === id);
    if (!stored) return;
    const result = await this.client(stored.connection).releaseNative();
    if (result?.released !== true) throw Error('native_release_not_confirmed');
  }
  async command(id, physicalId, entityId, command, requestId) {
    const inventory = this.inventory(id);
    if (!inventory.reachable) throw Error('native_provider_unavailable');
    const camera = inventory.cameras.find((item) => item.id === physicalId);
    if (!camera?.available) throw Error('native_camera_unavailable');
    const entity = camera?.entities.find((item) => item.id === entityId);
    if (!entity) throw Error('native_entity_not_found');
    const valid = validateCommand(entity, command);
    const connection = this.connections().find((row) => row.id === id)?.connection;
    if (!connection) throw Error('native_provider_not_found');
    return this.client(connection).command(physicalId, entityId, valid, requestId);
  }
  async remove(id) {
    const stored = this.connections().find((row) => row.id === id);
    if (!stored) throw Error('native_provider_not_found');
    await this.client(stored.connection).revoke();
    await this.catalog.removeProvider(id);
    this.live.delete(id);
    this.onChanged();
    // Keep the physical → recording camera ID mapping; a reconnect must not orphan clips.
  }
}
