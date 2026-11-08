/* oxlint-disable no-control-regex -- Strip control characters from untrusted hardware metadata. */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import {
  entityKeys,
  type BridgeCamera,
  type BridgeInventory,
} from '@haus/bridge/protocol';
import { activityKey } from './activity.js';
import { kitsuneDeviceIdentity } from '@haus/kitsune';
import type {
  NativeActivityLike,
  NativeCatalogLike,
  NativeDeviceDescription,
  NativeEntityDescription,
  NativeProvidersLike,
  NativeRegistryCamera,
  NativeSourceRow,
  NativeSourcesLike,
} from './native-migration-documents.js';

export type {
  NativeActivityLike,
  NativeCatalogLike,
  NativeDeviceDescription,
  NativeEntityDescription,
  NativeProvidersLike,
  NativeRegistryCamera,
  NativeSourceRow,
  NativeSourcesLike,
};

/** Materialized HA entity descriptions contain no provider token, source URL or executable template. */
export class NativeEntities {
  sources: NativeSourcesLike;
  providers: NativeProvidersLike;
  registry: () => { cameras: NativeRegistryCamera[] };
  activity?: NativeActivityLike;
  catalog: NativeCatalogLike;
  now: () => number;
  serial = new Map<string, Promise<unknown>>();

  constructor({
    sources,
    providers,
    registry,
    activity,
    catalog,
    now = Date.now,
  }: {
    sources: NativeSourcesLike;
    providers: NativeProvidersLike;
    registry: () => { cameras: NativeRegistryCamera[] };
    activity?: NativeActivityLike;
    catalog: NativeCatalogLike;
    now?: () => number;
  }) {
    this.sources = sources;
    this.providers = providers;
    this.registry = registry;
    this.activity = activity;
    this.catalog = catalog;
    this.now = now;
  }

  transaction<T>(id: string, action: () => Promise<T> | T): Promise<T> {
    const pending = (this.serial.get(id) ?? Promise.resolve()).then(action);
    const settled = pending.catch(() => {});
    this.serial.set(id, settled);
    return pending.finally(() => {
      if (this.serial.get(id) === settled) this.serial.delete(id);
    });
  }

  /** Persist explicit revocation before deleting the HA grant; outages alone never release it. */
  async revokeClient(clientId: string): Promise<string[]> {
    const owned = new Set(this.catalog.ownedCameras(clientId));
    const bridges = [
      ...new Set(
        this.sources
          .rows()
          .filter((row) => owned.has(row.value.cameraId))
          .map((row) => row.bridgeId),
      ),
    ];
    for (const id of bridges) await this.catalog.requestRelease(id, this.now());
    return bridges;
  }

  async tick(): Promise<void> {
    const pending = this.catalog.pendingReleases();
    for (let offset = 0; offset < pending.length; offset += 4)
      await Promise.allSettled(
        pending.slice(offset, offset + 4).map((id) =>
          this.transaction(id, async () => {
            // A handover ahead of this retry may already have cancelled the release.
            if (!this.catalog.releasing(id)) return;
            await this.providers.releaseNative(id);
            await this.catalog.completeRelease(
              id,
              this.sources
                .rows()
                .filter((row) => row.bridgeId === id)
                .map((row) => row.value.cameraId),
            );
          }),
        ),
      );
    // Rejected releases keep their durable intent until the enrolled provider returns.
  }

  async acknowledge(
    clientId: string,
    input: {
      cameras?: Array<{ cameraId?: string; entities?: string[]; [key: string]: unknown }>;
      features?: { disabledReadiness?: boolean; [key: string]: unknown };
      [key: string]: unknown;
    },
  ): Promise<{ ready: true }> {
    if (
      !input ||
      !Object.keys(input).every((key) => ['cameras', 'features'].includes(key)) ||
      (input.features !== undefined &&
        (!input.features ||
          Object.keys(input.features).join(',') !== 'disabledReadiness' ||
          input.features.disabledReadiness !== true)) ||
      !Array.isArray(input.cameras) ||
      input.cameras.length > 128
    )
      throw Error('invalid_native_readiness');
    const devices = this.devices();
    const values = input.cameras.map((item) => {
      const device = devices.find((entry) => entry.cameraId === item?.cameraId);
      if (
        !device ||
        !item ||
        Object.keys(item).sort().join(',') !== 'cameraId,entities' ||
        !Array.isArray(item.entities) ||
        item.entities.length !== device.entities.length ||
        new Set(item.entities).size !== item.entities.length ||
        item.entities.some((id) => !device.entities.some((entity) => entity.id === id))
      )
        throw Error('invalid_native_readiness');
      if (device.bridgeId.startsWith('kitsune-')) return null;
      return {
        cameraId: device.cameraId,
        revision: this.providers.inventory(device.bridgeId).revision,
      };
    });
    await this.catalog.acknowledge(
      clientId,
      values.filter((item): item is { cameraId: string; revision: string } => Boolean(item)),
      input.features?.disabledReadiness === true,
      this.now(),
    );
    return { ready: true };
  }

  ownsActivity(cameraId: string): boolean {
    if (this.registry().cameras.some((camera) => camera.id === cameraId && camera.kitsuneProvider))
      return this.catalog.hasNativeClient();
    return this.catalog.ownsActivity(cameraId);
  }

  readyClient(cameraId: string, revision: string | null): { clientId: string } | undefined {
    return this.catalog.readyClient(cameraId, revision, this.now() - 30000);
  }

  supportsDisabledReadiness(cameraId: string, revision: string | null): boolean {
    const client = this.readyClient(cameraId, revision);
    return !!client && this.catalog.supportsDisabledReadiness(client.clientId, this.now() - 30000);
  }

  handoverStatus(
    id: string,
    registry: {
      devices?: Array<{ id: string; identifiers?: [string, string][] }>;
      entities?: Array<{
        entity_id: string;
        platform?: string;
        unique_id?: string;
        device_id?: string | null;
      }>;
    },
    ignoredLegacy: Set<string> = new Set(),
  ) {
    const imported = this.sources.rows().filter((row) => row.bridgeId === id);
    let inventory: {
      reachable: boolean;
      revision: string | null;
      provider: string | undefined;
      cameras: BridgeCamera[];
    };
    try {
      inventory = this.providers.inventory(id);
    } catch {
      inventory = {
        reachable: false,
        revision: null,
        provider: this.providers.list().find((provider) => provider.id === id)?.provider,
        cameras: imported.map((row) => row.value.physical),
      };
    }
    const releasing = this.catalog.releasing(id);
    const cameras = inventory.cameras.map((physical) => {
      const row = imported.find((item) => item.physicalId === physical.id);
      const cameraId = row?.value.cameraId;
      const deviceIds = new Set(row?.value.deviceIds ?? []);
      if (row?.value.deviceId) deviceIds.add(row.value.deviceId);
      for (const device of registry.devices ?? [])
        if (
          device.identifiers?.some(
            ([platform, value]) =>
              ['mqtt', inventory.provider ?? ''].includes(platform) &&
              physical.identifiers.includes(value),
          )
        )
          deviceIds.add(device.id);
      const legacyEntities = (registry.entities ?? [])
        .filter(
          (entity) =>
            cameraId &&
            ((entity.entity_id === cameraId && entity.platform !== 'haus') ||
              (entity.platform === 'mqtt' &&
                (entity.unique_id === activityKey(cameraId) ||
                  (entity.device_id ? deviceIds.has(entity.device_id) : false)))),
        )
        .map((entity) => entity.entity_id)
        .filter((entityId) => !ignoredLegacy.has(entityId))
        .sort();
      return {
        cameraId: cameraId ?? null,
        name: row?.value.name ?? physical.name,
        imported: !!row,
        ready: !!cameraId && !!this.readyClient(cameraId, inventory.revision),
        connected: !!cameraId && this.ownsActivity(cameraId),
        legacyEntities,
      };
    });
    const state = releasing
      ? 'restoring'
      : cameras.length && cameras.every((camera) => camera.connected)
        ? 'connected'
        : !inventory.reachable
          ? 'unavailable'
          : !cameras.length || cameras.some((camera) => !camera.imported)
            ? 'import_required'
            : cameras.some((camera) => !camera.ready)
              ? 'integration_required'
              : cameras.some((camera) => camera.legacyEntities.length)
                ? 'migration_required'
                : 'ready';
    return { bridgeId: id, provider: inventory.provider, state, cameras };
  }

  async handover(id: string): Promise<{ native: true }> {
    return this.transaction(id, () => this.completeHandover(id));
  }

  async completeHandover(id: string): Promise<{ native: true }> {
    const inventory = this.providers.inventory(id);
    if (!inventory.reachable || !inventory.cameras.length)
      throw Error('native_provider_unavailable');
    const imported = this.sources.rows().filter((row) => row.bridgeId === id);
    const owners: Array<{ cameraId: string; clientId: string }> = [];
    for (const physical of inventory.cameras) {
      const row = imported.find((item) => item.physicalId === physical.id);
      const ready = row && this.readyClient(row.value.cameraId, inventory.revision);
      if (!ready || !row) throw Error('native_ha_not_ready');
      owners.push({ cameraId: row.value.cameraId, clientId: ready.clientId });
    }
    await this.providers.confirm(id, inventory.revision, entityKeys(inventory));
    await this.catalog.handover(id, owners, this.now());
    return { native: true };
  }

  devices(): NativeDeviceDescription[] {
    const cameras = this.registry().cameras;
    const devices: NativeDeviceDescription[] = this.sources.rows().flatMap((row) => {
      const camera = cameras.find(
        (item) => item.id === row.value.cameraId && item.nativeProvider?.bridgeId === row.bridgeId,
      );
      if (!camera) return [];
      let inventory: (BridgeInventory & { reachable: boolean; revision: string }) | undefined;
      try {
        inventory = this.providers.inventory(row.bridgeId);
      } catch {}
      const current = inventory?.cameras.find((item) => item.id === row.physicalId);
      const physical = current ?? row.value.physical;
      const entities: NativeEntityDescription[] = physical.entities
        .filter(
          (entity) =>
            entity.role !== 'motion' &&
            // Transport telemetry is consumed by the media controller, never copied into HA state.
            !/^(?:p2p_rtsp_stream|native_rtsp_stream|rtsp_stream|snapshot_url|talkback_rtmp)$/.test(
              entity.id,
            ),
        )
        .map((entity) => {
          const value = structuredClone(entity) as NativeEntityDescription;
          value.available = !!inventory?.reachable && !!current?.available && entity.available;
          if (
            typeof value.state === 'string' &&
            /(?:[a-z]+:\/\/|[\x00-\x1f\x7f])/i.test(value.state)
          ) {
            value.state = null;
            value.available = false;
          }
          return value;
        });
      const activity = this.activity?.status(camera.id);
      if (activity)
        entities.push({
          id: 'haus_activity',
          name: 'Activity',
          domain: 'binary_sensor',
          role: 'motion',
          deviceClass: 'motion',
          state: activity.active,
          available: activity.available,
          updatedAt: activity.lastDetectedAt ?? 0,
          writable: false,
          nativeSources: (activity.replaces ?? []).slice(0, 32),
        });
      return [
        {
          cameraId: camera.id,
          name: camera.name,
          deviceId: camera.deviceId ?? null,
          bridgeId: row.bridgeId,
          physicalId: row.physicalId,
          manufacturer: physical.manufacturer,
          model: physical.model,
          available: !!inventory?.reachable && !!current && physical.available,
          entities,
        },
      ];
    });
    for (const camera of cameras.filter((item) => item.kitsuneProvider)) {
      const activity = this.activity?.status(camera.id);
      const plugin = camera.kitsuneProvider!;
      devices.push({
        cameraId: camera.id,
        name: camera.name,
        deviceId: camera.deviceId ?? null,
        ...kitsuneDeviceIdentity(plugin),
        manufacturer: 'Kitsune',
        model: plugin.pluginId,
        available: camera.available,
        entities: activity
          ? [
              {
                id: 'haus_activity',
                name: 'Activity',
                domain: 'binary_sensor',
                role: 'motion',
                deviceClass: 'motion',
                state: activity.active,
                available: activity.available,
                updatedAt: activity.lastDetectedAt ?? 0,
                writable: false,
                nativeSources: (activity.replaces ?? []).slice(0, 32),
              },
            ]
          : [],
      });
    }
    return devices;
  }

  async command(
    cameraId: string,
    entityId: string,
    input: { command?: unknown; requestId?: unknown; [key: string]: unknown },
  ): Promise<{ accepted: true }> {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'command,requestId' ||
      typeof input.requestId !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.requestId)
    )
      throw Error('invalid_native_command');
    const row = this.sources.rows().find((item) => item.value.cameraId === cameraId);
    const visible = this.devices()
      .find((item) => item.cameraId === cameraId)
      ?.entities.find((item) => item.id === entityId);
    if (!row || !visible?.available || !visible.writable || entityId === 'haus_activity')
      throw Error('native_entity_unavailable');
    await this.providers.command(
      row.bridgeId,
      row.physicalId,
      entityId,
      input.command,
      input.requestId,
    );
    await this.providers.refresh(row.bridgeId).catch(() => {});
    return { accepted: true };
  }

  operating(cameraId: string) {
    const device = this.devices().find((item) => item.cameraId === cameraId);
    const result: Partial<
      Record<'indicator' | 'nightVision', { id: string; available: boolean; value: boolean }>
    > = {};
    for (const role of ['indicator', 'nightVision'] as const) {
      const entities =
        device?.entities.filter((entity) => entity.role === role && entity.writable) ?? [];
      if (entities.length !== 1) continue;
      const entity = entities[0]!,
        mapping =
          entity.homekit ??
          (entity.domain === 'switch' ? { enabledValue: true, disabledValue: false } : undefined);
      if (!mapping || ![mapping.enabledValue, mapping.disabledValue].includes(entity.state as boolean | string))
        continue;
      result[role] = {
        id: `native:${entity.id}`,
        available: entity.available,
        value: entity.state === mapping.enabledValue,
      };
    }
    return result;
  }

  async writeOperating(
    cameraId: string,
    role: 'indicator' | 'nightVision',
    entityId: string,
    value: boolean,
  ): Promise<{ accepted: true }> {
    const current = this.operating(cameraId)[role];
    if (!current?.available || current.id !== entityId || typeof value !== 'boolean')
      throw Error('camera_control_unavailable');
    const entity = this.devices()
      .find((item) => item.cameraId === cameraId)
      ?.entities.find((item) => `native:${item.id}` === entityId);
    if (!entity) throw Error('camera_control_unavailable');
    const mapping = entity.homekit ?? { enabledValue: true, disabledValue: false };
    return this.command(cameraId, entity.id, {
      requestId: randomUUID(),
      command: { action: 'set', value: value ? mapping.enabledValue : mapping.disabledValue },
    });
  }

  spotlight(cameraId: string) {
    const entities =
      this.devices()
        .find((item) => item.cameraId === cameraId)
        ?.entities.filter(
          (entity) => entity.role === 'spotlight' && entity.domain === 'light' && entity.writable,
        ) ?? [];
    if (entities.length !== 1) return;
    const entity = entities[0]!,
      state = entity.state && typeof entity.state === 'object' ? { ...entity.state } : {};
    return {
      id: `native:${entity.id}`,
      available: entity.available,
      ...state,
      capabilities: {
        brightness: !!entity.brightness,
        color: !!entity.color,
        colorTemperature: entity.colorTemperature,
      },
    };
  }

  async writeSpotlight(cameraId: string, entityId: string, value: unknown): Promise<{ accepted: true }> {
    const current = this.spotlight(cameraId);
    if (!current?.available || current.id !== entityId) throw Error('spotlight_unavailable');
    return this.command(cameraId, entityId.slice(7), {
      requestId: randomUUID(),
      command: { action: 'set', value },
    });
  }
}
