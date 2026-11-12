/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HausDevice, HausEndpoint, SourceServiceRef } from '@haus/core';
import {
  entityKeys,
  validateInventory,
  type BridgeCamera,
  type BridgeEntity,
} from '@haus/bridge/protocol';
import type { StandaloneHomeService } from '../../home/home.service.js';
import type { NativeProviders } from '../native.js';
import { NativeGraphIdentity, nativeSource } from './identity.js';
import { graphRegistry } from './registry.js';
import { entityEndpoint } from './mapper.js';
import { entityCommand } from './command.js';

type Home = Pick<
  StandaloneHomeService,
  'listDevices' | 'getDevice' | 'registerDevice' | 'getPersistence' | 'registerCommandHandler'
>;
type Providers = Pick<NativeProviders, 'connections' | 'confirm' | 'command'> & {
  inventory(id: string): { revision: string; reachable?: boolean };
  refresh(id: string): Promise<unknown>;
};
interface Sources {
  rows(): ReadonlyArray<{
    bridgeId: string;
    physicalId: string;
    value: { cameraId: string; physical: unknown };
  }>;
}

/** The standalone Home projection owns controls; media import alone never retires MQTT. */
export class NativeGraph {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly handlers = new Map<string, { owner: SourceServiceRef; stop: () => void }>();
  private closed = false;

  constructor(
    private readonly home: Home,
    private readonly providers: Providers,
    private readonly sources: Sources,
    private readonly identities: NativeGraphIdentity,
  ) {}

  registry() {
    return graphRegistry(this.home.listDevices());
  }

  async tick(): Promise<void> {
    const results = await Promise.allSettled(
      this.providers.connections().map((provider) => this.sync(provider.id)),
    );
    if (results.some((result) => result.status === 'rejected'))
      throw Error('native_graph_refresh_failed');
  }

  sync(bridgeId: string): Promise<void> {
    if (this.closed) return Promise.reject(Error('native_graph_closed'));
    const previous = this.pending.get(bridgeId);
    if (previous) return previous;
    const task = this.project(bridgeId).finally(() => this.pending.delete(bridgeId));
    this.pending.set(bridgeId, task);
    return task;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.pending.values());
    for (const handler of this.handlers.values()) handler.stop();
    this.handlers.clear();
  }

  /** Called only after the provider confirms explicit revocation, never on a timeout. */
  async release(bridgeId: string): Promise<void> {
    for (const device of this.home.listDevices()) {
      if (
        !device.sourceRefs?.some(
          (source) => source.protocol === 'vendor' && source.metadata?.bridgeId === bridgeId,
        )
      )
        continue;
      const endpoints = device.endpoints.map((endpoint) => {
        const owned = this.handlers.get(endpoint.id);
        const source = endpoint.sourceOwner;
        if (
          !source ||
          source.protocol !== 'vendor' ||
          !source.externalId.startsWith(`["${bridgeId}",`)
        )
          return endpoint;
        owned?.stop();
        this.handlers.delete(endpoint.id);
        return {
          ...endpoint,
          sourceOwner: undefined,
          sourceRefs: endpoint.sourceRefs?.filter(
            (ref) => ref.protocol !== 'vendor' || !ref.externalId.startsWith(`["${bridgeId}",`),
          ),
          availability: 'unknown' as const,
        };
      });
      this.home.registerDevice({
        ...device,
        sourceRefs: device.sourceRefs.filter(
          (source) => source.protocol !== 'vendor' || source.metadata?.bridgeId !== bridgeId,
        ),
        endpoints,
        services: [],
        availability: 'unknown',
      });
    }
    await this.home.getPersistence().load();
  }

  private async project(bridgeId: string): Promise<void> {
    const rows = this.sources.rows().filter((row) => row.bridgeId === bridgeId);
    if (!rows.length) return;
    let live: ReturnType<Providers['inventory']> | undefined;
    try {
      live = this.providers.inventory(bridgeId);
    } catch {
      /* Persisted imports remain visible offline before the first provider response. */
    }
    const inventory = validateInventory(
      live ?? {
        version: 2,
        bridgeId,
        provider: this.providers.connections().find((provider) => provider.id === bridgeId)
          ?.connection.provider,
        cameras: rows.map((row) => row.value.physical),
      },
    );
    if (inventory.bridgeId !== bridgeId) throw Error('native_graph_identity_mismatch');
    const physicalIds = inventory.cameras.flatMap((camera) => camera.identifiers);
    if (new Set(physicalIds).size !== physicalIds.length)
      throw Error('native_graph_identity_ambiguous');
    const imported = new Map(rows.map((row) => [row.physicalId, row]));
    for (const row of rows) {
      const camera =
        inventory.cameras.find((item) => item.id === row.physicalId) ??
        validateInventory({
          version: 2,
          bridgeId,
          provider: inventory.provider,
          cameras: [row.value.physical],
        }).cameras[0];
      if (!camera) throw Error('native_camera_not_found');
      const reachable = Boolean(
        live?.reachable && inventory.cameras.some((item) => item.id === camera.id),
      );
      await this.camera(bridgeId, camera, row.value.cameraId, reachable);
    }
    // Barrier behind device/reading writes: an acknowledged handover must survive a process restart.
    const persisted = await this.home.getPersistence().load();
    if (this.closed) return;
    if (!live?.reachable || inventory.cameras.some((camera) => !imported.has(camera.id))) return;
    const materialized = this.home
      .listDevices()
      .filter((device) =>
        device.sourceRefs?.some(
          (source) => source.protocol === 'vendor' && source.metadata?.bridgeId === bridgeId,
        ),
      );
    if (
      !materialized.every((device) =>
        persisted.devices.some(
          (stored) => stored.id === device.id && JSON.stringify(stored) === JSON.stringify(device),
        ),
      )
    )
      throw Error('native_graph_not_durable');
    const result = await this.providers.confirm(bridgeId, live.revision, entityKeys(inventory));
    if (
      !result ||
      typeof result !== 'object' ||
      !Number.isFinite(Reflect.get(result, 'expiresAt')) ||
      typeof Reflect.get(result, 'publishMqtt') !== 'boolean'
    )
      throw Error('native_handover_unconfirmed');
  }

  private async camera(
    bridgeId: string,
    camera: BridgeCamera,
    mediaId: string,
    reachable: boolean,
  ): Promise<void> {
    const deviceId = await this.identities.device(bridgeId, camera);
    if (this.closed) throw Error('native_graph_closed');
    const previous = this.home.getDevice(deviceId);
    const endpoints = new Map(
      (previous?.endpoints ?? []).map((endpoint) => [endpoint.id, endpoint]),
    );
    const active = new Set<string>();
    const videoId = await this.identities.endpoint(
      bridgeId,
      camera,
      { id: '@camera', domain: 'camera', mqtt: camera.mqtt },
      deviceId,
    );
    const videoOwner = { ...nativeSource(bridgeId, camera.id, '@camera'), domain: 'camera' };
    const video: HausEndpoint = {
      id: videoId,
      name: camera.name,
      mediaId,
      category: 'cameras',
      availability: reachable && camera.available ? 'online' : 'offline',
      sourceOwner: videoOwner,
      sourceRefs: [videoOwner],
      capabilities: [{ id: 'video', kind: 'complex', readable: true, operations: [] }],
      readings: {},
    };
    endpoints.set(
      videoId,
      this.merge(endpoints.get(videoId), video, camera.mqtt?.uniqueId, 'camera'),
    );
    active.add(videoId);
    for (const entity of camera.entities) {
      const endpointId = await this.identities.endpoint(bridgeId, camera, entity, deviceId);
      if (active.has(endpointId)) throw Error('native_graph_identity_ambiguous');
      const owner = { ...nativeSource(bridgeId, camera.id, entity.id), domain: entity.domain };
      const endpoint = this.merge(
        endpoints.get(endpointId),
        entityEndpoint(entity, endpointId, owner, reachable && entity.available),
        entity.mqtt?.uniqueId,
        entity.domain,
      );
      endpoints.set(endpointId, endpoint);
      active.add(endpointId);
      this.register(endpointId, owner, bridgeId, camera.id, entity.id);
    }
    for (const [id, endpoint] of endpoints) {
      if (
        !active.has(id) &&
        !endpoint.sourceOwner &&
        (previous?.source.instanceId === 'haus-mqtt' ||
          endpoint.sourceRefs?.some((source) => source.protocol === 'mqtt'))
      )
        throw Error('native_graph_mqtt_alias_required');
      const owned = endpoint.sourceOwner?.externalId;
      if (!active.has(id) && owned && this.handlers.get(id)?.owner.externalId === owned)
        endpoints.set(id, { ...endpoint, availability: 'offline' });
    }
    const reference = nativeSource(bridgeId, camera.id, 'device');
    const refs = (previous?.sourceRefs ?? []).filter(
      (source) => !(source.protocol === 'vendor' && source.externalId === reference.externalId),
    );
    const device: HausDevice = {
      ...previous,
      id: deviceId,
      source: previous?.source ?? { instanceId: 'haus-native', externalId: reference.externalId },
      name: previous?.name ?? camera.name,
      category: 'cameras',
      roomId: previous?.roomId ?? 'unassigned',
      availability: [...endpoints.values()].some((endpoint) => endpoint.availability === 'online')
        ? 'online'
        : 'offline',
      manufacturer: camera.manufacturer,
      model: camera.model,
      connectivity: previous?.connectivity ?? { protocol: 'local_ip' },
      sourceRefs: [
        ...refs,
        { ...reference, metadata: { bridgeId, physicalId: camera.id } },
        ...camera.identifiers
          .filter(
            (identifier) =>
              !refs.some(
                (source) => source.protocol === 'mqtt' && source.externalId === identifier,
              ),
          )
          .map((externalId) => ({ protocol: 'mqtt' as const, externalId })),
      ],
      endpoints: [...endpoints.values()],
      services: [],
    };
    if (this.closed) throw Error('native_graph_closed');
    this.home.registerDevice(device);
  }

  private merge(
    previous: HausEndpoint | undefined,
    endpoint: HausEndpoint,
    mqttId: string | undefined,
    domain: string,
  ): HausEndpoint {
    const refs = [
      ...(previous?.sourceRefs ?? []),
      ...(endpoint.sourceRefs ?? []),
      ...(mqttId ? [{ protocol: 'mqtt' as const, externalId: mqttId, domain }] : []),
    ];
    const unique = new Map(
      refs.map((source) => [
        JSON.stringify([source.protocol, source.externalId, source.domain]),
        source,
      ]),
    );
    return {
      ...previous,
      ...endpoint,
      address: previous?.address,
      roomId: previous?.roomId,
      sourceRefs: [...unique.values()],
    };
  }

  private register(
    endpointId: string,
    owner: SourceServiceRef,
    bridgeId: string,
    physicalId: string,
    entityId: string,
  ): void {
    const old = this.handlers.get(endpointId);
    if (old?.owner.externalId === owner.externalId && old.owner.domain === owner.domain) return;
    old?.stop();
    const select = (): BridgeEntity => {
      const inventory = this.providers.inventory(bridgeId);
      if (!inventory.reachable) throw Error('native_provider_unavailable');
      const camera = validateInventory(inventory).cameras.find((item) => item.id === physicalId);
      if (!camera) throw Error('native_camera_unavailable');
      const entity = camera.entities.find((item) => item.id === entityId);
      if (!entity) throw Error('native_entity_not_found');
      return entity;
    };
    const stop = this.home.registerCommandHandler(
      owner,
      async (_id, capability, command, parameters) => {
        await this.providers.command(
          bridgeId,
          physicalId,
          entityId,
          entityCommand(select(), capability, command, parameters),
        );
        await this.providers.refresh(bridgeId);
        await this.pending.get(bridgeId);
        await this.sync(bridgeId);
      },
      {
        optimistic: false,
        validate: (_id, capability, command, parameters) => {
          entityCommand(select(), capability, command, parameters);
        },
      },
    );
    this.handlers.set(endpointId, { owner, stop });
  }
}
