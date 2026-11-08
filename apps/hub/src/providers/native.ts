/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { CameraBridgeClient, cameraBridgeEndpoint } from '@haus/bridge/client';
import { validateCommand } from '@haus/bridge/protocol';
import { protectedNativeTransport } from '@haus/kitsune/native';
import { cameraSource, privateIp } from '@haus/media/source';
import {
  NativeCameraIdentities,
  type NativeIdentityCatalogPort,
} from '../camera/identities.js';

export interface NativeProviderConnection {
  bridgeId: string;
  provider: string;
  clientId?: string;
  token?: string;
  endpoint: {
    url: string;
    address?: string;
    family?: number;
    allowHttp?: boolean;
  };
}

type BridgeEntityInput = Parameters<typeof validateCommand>[0];

export interface NativeProviderEntity extends Partial<BridgeEntityInput> {
  id: string;
  [key: string]: unknown;
}

export interface NativeProviderCamera {
  id: string;
  name?: string;
  manufacturer?: string;
  model?: string;
  available?: boolean;
  identifiers?: string[];
  stream: {
    url: string;
    transport: string;
  };
  talkback?: {
    url: string;
    transport?: string;
  };
  snapshotPath?: string;
  entities: NativeProviderEntity[];
  [key: string]: unknown;
}

export interface NativeProviderInventory {
  version?: number;
  bridgeId: string;
  provider: string;
  revision: string;
  cameras: NativeProviderCamera[];
  reachable?: boolean;
  [key: string]: unknown;
}

export interface NativeProviderCatalogPort extends NativeIdentityCatalogPort {
  controllerId: string;
  providers(): ReadonlyArray<{ id: string; connection: string }>;
  addProvider(input: { id: string; connection: string; createdAt: number }): Promise<unknown>;
  removeProvider(id: string): Promise<unknown>;
}

export interface NativeBridgeClientPort {
  connection: NativeProviderConnection;
  inventory(): Promise<unknown>;
  ready?(revision: string, readyKeys: readonly string[]): Promise<unknown>;
  releaseNative?(): Promise<unknown>;
  command?(
    physicalId: string,
    entityId: string,
    command: Parameters<typeof validateCommand>[1],
    requestId?: string,
  ): Promise<unknown>;
  revoke(): Promise<unknown>;
}

export interface NativeProvidersOptions {
  store?: unknown;
  catalog?: { native: NativeProviderCatalogPort };
  onChanged?: () => void;
  now?: () => number;
  endpoint?: (url: string, allowHttp: boolean) => Promise<unknown>;
  enroll?: (
    endpoint: unknown,
    code: string,
    controllerId: string,
  ) => Promise<NativeBridgeClientPort>;
  client?: (connection: NativeProviderConnection) => NativeBridgeClientPort;
  validateSource?: (source: { kind: string; url: string }) => Promise<{ url: string }>;
  resolve?: (hostname: string, options: { all: true }) => Promise<Array<{ address: string }>>;
}

export interface NativeProviderSummary {
  id: string;
  provider: string;
  url: string;
  available: boolean;
  cameras: number;
}

const defaultEndpoint: NonNullable<NativeProvidersOptions['endpoint']> = (url, allowHttp) =>
  cameraBridgeEndpoint(url, allowHttp);

const defaultEnroll: NonNullable<NativeProvidersOptions['enroll']> = (ep, code, controllerId) =>
  CameraBridgeClient.enroll(
    ep as Parameters<typeof CameraBridgeClient.enroll>[0],
    code,
    controllerId,
  );

const defaultClient: NonNullable<NativeProvidersOptions['client']> = (connection) =>
  new CameraBridgeClient(connection as ConstructorParameters<typeof CameraBridgeClient>[0]);

const defaultValidateSource: NonNullable<NativeProvidersOptions['validateSource']> = (source) =>
  cameraSource(source as Parameters<typeof cameraSource>[0]);

const defaultResolve: NonNullable<NativeProvidersOptions['resolve']> = (hostname, options) =>
  lookup(hostname, options);

/** Enroll first; exposing HA entities and confirming MQTT retirement are separate operations. */
export class NativeProviders {
  readonly store?: unknown;
  readonly catalog: NativeProviderCatalogPort;
  readonly identities: NativeCameraIdentities;
  readonly onChanged: () => void;
  readonly now: () => number;
  readonly endpoint: (url: string, allowHttp: boolean) => Promise<unknown>;
  readonly enroll: (
    endpoint: unknown,
    code: string,
    controllerId: string,
  ) => Promise<NativeBridgeClientPort>;
  readonly client: (connection: NativeProviderConnection) => NativeBridgeClientPort;
  readonly validateSource: (source: { kind: string; url: string }) => Promise<{ url: string }>;
  readonly resolve: (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string }>>;
  readonly live = new Map<string, { at: number; inventory: NativeProviderInventory }>();
  readonly pending = new Map<string, Promise<NativeProviderInventory>>();
  readonly controllerId: string;

  constructor({
    store,
    catalog,
    onChanged = () => {},
    now = Date.now,
    endpoint = defaultEndpoint,
    enroll = defaultEnroll,
    client = defaultClient,
    validateSource = defaultValidateSource,
    resolve = defaultResolve,
  }: NativeProvidersOptions) {
    this.store = store;
    this.onChanged = onChanged;
    this.now = now;
    this.endpoint = endpoint;
    this.enroll = enroll;
    this.client = client;
    this.validateSource = validateSource;
    this.resolve = resolve;
    if (!catalog) throw new Error('camera_catalog_required');
    this.catalog = catalog.native;
    this.identities = new NativeCameraIdentities(catalog, onChanged);
    this.controllerId = this.catalog.controllerId;
  }

  connections(): Array<{ id: string; connection: NativeProviderConnection }> {
    return this.catalog
      .providers()
      .map((row) => ({ id: row.id, connection: JSON.parse(row.connection) as NativeProviderConnection }));
  }

  list(): NativeProviderSummary[] {
    return this.connections().map(({ id, connection }) => {
      const liveEntry = this.live.get(id);
      return {
        id,
        provider: connection.provider,
        url: connection.endpoint.url,
        available: Boolean(liveEntry && this.now() - liveEntry.at < 30000),
        cameras: liveEntry?.inventory.cameras.length ?? 0,
      };
    });
  }

  async add(input: unknown): Promise<NativeProviderSummary | undefined> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('invalid_native_provider');
    }
    const candidate = input as Record<string, unknown>;
    if (
      typeof candidate.url !== 'string' ||
      typeof candidate.code !== 'string' ||
      typeof candidate.allowHttp !== 'boolean' ||
      Object.keys(candidate).sort().join(',') !== 'allowHttp,code,url'
    ) {
      throw new Error('invalid_native_provider');
    }
    const endpoint = await this.endpoint(candidate.url, candidate.allowHttp);
    const client = await this.enroll(endpoint, candidate.code, this.controllerId);
    const id = client.connection.bridgeId;
    if (this.connections().some((row) => row.id === id)) {
      await client.revoke().catch(() => {});
      throw new Error('native_provider_exists');
    }
    try {
      const inventory = await this.validate((await client.inventory()) as NativeProviderInventory);
      await this.catalog.addProvider({
        id,
        connection: JSON.stringify(client.connection),
        createdAt: this.now(),
      });
      this.live.set(id, { at: this.now(), inventory });
      this.onChanged();
      return this.list().find((provider) => provider.id === id);
    } catch (error) {
      await client.revoke().catch(() => {});
      throw error;
    }
  }

  async validate<T extends { provider: string; cameras: NativeProviderCamera[] }>(
    inventory: T,
  ): Promise<T> {
    for (const camera of inventory.cameras) {
      if (!protectedNativeTransport(inventory.provider, camera.stream.transport)) {
        throw new Error('camera_protected_p2p_source_required');
      }
      const source = await this.validateSource({
        kind: camera.stream.transport === 'p2p' ? 'p2p-restream' : 'rtsp',
        url: camera.stream.url,
      });
      const host = new URL(source.url).hostname.replace(/^\[|\]$/g, '');
      if (host === '::1' || host.startsWith('127.')) {
        throw new Error('invalid_camera_source');
      }
      camera.stream.url = source.url;
      if (camera.talkback) {
        const target = new URL(camera.talkback.url);
        const talkbackHost = target.hostname.replace(/^\[|\]$/g, '');
        let timer: ReturnType<typeof setTimeout> | undefined;
        const addresses = isIP(talkbackHost)
          ? [{ address: talkbackHost }]
          : await Promise.race([
              this.resolve(talkbackHost, { all: true }),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('invalid_native_talkback')), 2500);
              }),
            ]).finally(() => clearTimeout(timer));
        if (
          !addresses.length ||
          addresses.some(
            ({ address }) =>
              !privateIp(address) || address.startsWith('127.') || address === '::1',
          )
        ) {
          throw new Error('invalid_native_talkback');
        }
        const resolvedAddress = addresses[0]!.address;
        target.hostname = resolvedAddress.includes(':')
          ? `[${resolvedAddress}]`
          : resolvedAddress;
        camera.talkback.url = target.href;
      }
    }
    return inventory;
  }

  async refresh(id: string): Promise<NativeProviderInventory> {
    const existing = this.pending.get(id);
    if (existing) return existing;
    const stored = this.connections().find((row) => row.id === id);
    if (!stored) throw new Error('native_provider_not_found');
    const pending = (async () => {
      const inventory = await this.validate(
        (await this.client(stored.connection).inventory()) as NativeProviderInventory,
      );
      // A delayed response cannot restore a removed provider.
      if (
        !this.connections().some(
          (row) =>
            row.id === id && JSON.stringify(row.connection) === JSON.stringify(stored.connection),
        )
      ) {
        throw new Error('native_provider_not_found');
      }
      this.live.set(id, { inventory, at: this.now() });
      return inventory;
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, pending);
    return pending;
  }

  async tick(): Promise<void> {
    const rows = this.connections();
    for (let offset = 0; offset < rows.length; offset += 2) {
      await Promise.allSettled(rows.slice(offset, offset + 2).map((row) => this.refresh(row.id)));
    }
  }

  inventory(id: string): NativeProviderInventory & { reachable: boolean } {
    const state = this.live.get(id);
    if (!state) throw new Error('native_provider_unavailable');
    return { ...structuredClone(state.inventory), reachable: this.now() - state.at < 30000 };
  }

  bind(id: string, physicalId: string, legacyCameraId?: string): Promise<string> {
    const camera = this.inventory(id).cameras.find((item) => item.id === physicalId);
    if (!camera) throw new Error('native_camera_not_found');
    return this.identities.resolve(id, camera.id, legacyCameraId);
  }

  async confirm(id: string, revision: string, readyKeys: readonly string[]): Promise<unknown> {
    const stored = this.connections().find((row) => row.id === id);
    if (!stored) throw new Error('native_provider_not_found');
    // Only call after the HA adapter confirms every entity and any migration completes.
    return this.client(stored.connection).ready?.(revision, readyKeys);
  }

  async releaseNative(id: string): Promise<void> {
    const stored = this.connections().find((row) => row.id === id);
    if (!stored) return;
    const result = (await this.client(stored.connection).releaseNative?.()) as
      | { released?: boolean }
      | undefined;
    if (result?.released !== true) throw new Error('native_release_not_confirmed');
  }

  async command(
    id: string,
    physicalId: string,
    entityId: string,
    command: unknown,
    requestId?: string,
  ): Promise<unknown> {
    const inventory = this.inventory(id);
    if (!inventory.reachable) throw new Error('native_provider_unavailable');
    const camera = inventory.cameras.find((item) => item.id === physicalId);
    if (!camera?.available) throw new Error('native_camera_unavailable');
    const entity = camera.entities.find((item) => item.id === entityId);
    if (!entity) throw new Error('native_entity_not_found');
    const valid = validateCommand(
      entity as Parameters<typeof validateCommand>[0],
      command as Parameters<typeof validateCommand>[1],
    );
    const connection = this.connections().find((row) => row.id === id)?.connection;
    if (!connection) throw new Error('native_provider_not_found');
    return this.client(connection).command?.(physicalId, entityId, valid, requestId);
  }

  async remove(id: string): Promise<void> {
    const stored = this.connections().find((row) => row.id === id);
    if (!stored) throw new Error('native_provider_not_found');
    await this.client(stored.connection).revoke();
    await this.catalog.removeProvider(id);
    this.live.delete(id);
    this.onChanged();
    // Keep the physical → recording camera ID mapping; a reconnect must not orphan clips.
  }
}
