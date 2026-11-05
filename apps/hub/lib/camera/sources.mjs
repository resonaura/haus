/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';
import { nvrCameraSource } from './sessions.mjs';

/** Import is explicit; exact physical identity or an identical protected source preserves an old ID. */
export class NativeCameraSources {
  constructor({ providers, store, resolveSource = nvrCameraSource, now = Date.now }) {
    Object.assign(this, { providers, store, resolveSource, now });
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS native_camera_sources(bridge_id TEXT NOT NULL,physical_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(bridge_id,physical_id))',
    );
  }
  rows() {
    return this.store.db
      .prepare(
        'SELECT bridge_id AS bridgeId,physical_id AS physicalId,value FROM native_camera_sources ORDER BY bridge_id,physical_id',
      )
      .all()
      .map((row) => ({ ...row, value: JSON.parse(row.value) }));
  }
  match(bridge, physical, registry) {
    const matches = registry.cameras.filter((camera) => {
      if (camera.nativeProvider) return false;
      const ids = new Set([camera.deviceId, ...(camera.deviceIds ?? [])].filter(Boolean));
      const identity = (registry.devices ?? []).some(
        (device) =>
          ids.has(device.id) &&
          device.identifiers?.some(
            ([platform, id]) =>
              ['mqtt', bridge.provider].includes(platform) && physical.identifiers.includes(id),
          ),
      );
      if (identity) return true;
      try {
        const source = this.resolveSource(camera, registry);
        return (
          source.kind === (physical.stream.transport === 'p2p' ? 'p2p-restream' : 'rtsp') &&
          new URL(source.url).href === new URL(physical.stream.url).href
        );
      } catch {
        return false;
      }
    });
    if (matches.length > 1) throw Error('native_camera_identity_ambiguous');
    return matches[0];
  }
  preview(id, registry) {
    const inventory = this.providers.inventory(id);
    if (!inventory.reachable) throw Error('native_provider_unavailable');
    return inventory.cameras.map((physical) => {
      const old = this.match(inventory, physical, registry);
      const mapping = this.providers.identities
        .list(id)
        .find((row) => row.physicalId === physical.id);
      return {
        physicalId: physical.id,
        name: physical.name,
        available: physical.available,
        existingCameraId: mapping?.cameraId ?? old?.id,
        imported: this.rows().some((row) => row.bridgeId === id && row.physicalId === physical.id),
      };
    });
  }
  migrationIdentity(id, physicalId, registry) {
    const inventory = this.providers.inventory(id);
    const physical = inventory.cameras.find((camera) => camera.id === physicalId);
    if (!physical) return undefined;
    // Presentation aliases and same-name RTSP sensors are not proof of a Generic config's source.
    // Only its own registered physical device can authorize automatic metadata replacement.
    const devices = new Set(
      registry.devices
        .filter((device) =>
          device.identifiers?.some(
            ([platform, value]) =>
              ['mqtt', inventory.provider].includes(platform) &&
              physical.identifiers.includes(value),
          ),
        )
        .map((device) => device.id),
    );
    const matches = registry.entities.filter(
      (entity) =>
        entity.platform !== 'haus' &&
        entity.entity_id.startsWith('camera.') &&
        devices.has(entity.device_id),
    );
    if (matches.length > 1) throw Error('native_camera_identity_ambiguous');
    return matches[0];
  }
  import(id, physicalIds, registry) {
    if (
      !Array.isArray(physicalIds) ||
      !physicalIds.length ||
      physicalIds.length > 128 ||
      new Set(physicalIds).size !== physicalIds.length ||
      physicalIds.some((value) => typeof value !== 'string')
    )
      throw Error('invalid_native_cameras');
    const inventory = this.providers.inventory(id);
    if (!inventory.reachable) throw Error('native_provider_unavailable');
    const plan = physicalIds.map((physicalId) => {
      const physical = inventory.cameras.find((camera) => camera.id === physicalId);
      if (!physical) throw Error('native_camera_not_found');
      return { physical, old: this.match(inventory, physical, registry) };
    });
    const existing = plan.flatMap(({ old }) => (old ? [old.id] : []));
    if (new Set(existing).size !== existing.length) throw Error('native_camera_identity_ambiguous');
    const db = this.store.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const { physical, old } of plan) {
        const previous = this.rows().find(
          (row) => row.bridgeId === id && row.physicalId === physical.id,
        )?.value;
        const cameraId = this.providers.identities.resolve(id, physical.id, old?.id);
        const value = {
          ...previous,
          cameraId,
          name: old?.name ?? previous?.name ?? physical.name,
          deviceId: old?.deviceId ?? previous?.deviceId,
          deviceIds: old?.deviceIds ?? previous?.deviceIds,
          areaId: old?.areaId ?? previous?.areaId,
          aliases: old?.aliases ?? previous?.aliases ?? [],
          physical,
        };
        db.prepare(
          'INSERT INTO native_camera_sources VALUES(?,?,?) ON CONFLICT(bridge_id,physical_id)DO UPDATE SET value=excluded.value',
        ).run(id, physical.id, JSON.stringify(value));
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    // Importing media does not assert that HA has materialized every control.
    return this.preview(id, registry);
  }
  merge(registry, overrides = {}) {
    const active = new Set(this.providers.connections().map((row) => row.id));
    const result = [...registry.cameras];
    for (const row of this.rows()) {
      if (!active.has(row.bridgeId)) continue;
      let inventory;
      try {
        inventory = this.providers.inventory(row.bridgeId);
      } catch {
        /* Keep imported identity offline across restarts. */
      }
      const current = inventory?.cameras.find((camera) => camera.id === row.physicalId);
      const physical = current ?? row.value.physical;
      const devices = (registry.devices ?? []).filter((device) =>
        device.identifiers?.some(
          ([platform, value]) =>
            ['mqtt', inventory?.provider].includes(platform) &&
            physical.identifiers.includes(value),
        ),
      );
      const ownDevices = (registry.devices ?? []).filter((device) =>
        device.identifiers?.some(
          ([platform, value]) =>
            platform === 'haus' && value === `${row.bridgeId}:${row.physicalId}`,
        ),
      );
      const recordedDevices = devices.filter((device) => row.value.deviceIds?.includes(device.id));
      // Generic views are presentation devices. Keep controls on the exact physical device.
      const deviceId =
        recordedDevices.length === 1
          ? recordedDevices[0].id
          : devices.length === 1
            ? devices[0].id
            : !devices.length && ownDevices.length === 1
              ? ownDevices[0].id
              : undefined;
      const id = row.value.cameraId,
        old = result.find((camera) => camera.id === id);
      const physicalDeviceIds = new Set([...devices, ...ownDevices].map((device) => device.id));
      const legacyAliases = result
        .filter((camera) => {
          if (camera.id === id || camera.nativeProvider) return false;
          if (physicalDeviceIds.has(camera.deviceId)) return true;
          try {
            const source = this.resolveSource(camera, registry);
            return (
              source.kind === (physical.stream.transport === 'p2p' ? 'p2p-restream' : 'rtsp') &&
              new URL(source.url).href === new URL(physical.stream.url).href
            );
          } catch {
            return false;
          }
        })
        .map((camera) => camera.id);
      const settings = overrides[id] ?? {};
      const nativeSensors = physical.entities
        .filter((entity) => entity.role === 'motion' && entity.domain === 'binary_sensor')
        .map((entity) => ({
          id: `binary_sensor.haus_${createHash('sha256')
            .update(JSON.stringify([row.bridgeId, row.physicalId, entity.id]))
            .digest('hex')
            .slice(0, 32)}`,
          kind: 'motion',
          name: entity.name,
          native: true,
          source: 'device',
          cameraNative: true,
          available: !!inventory?.reachable && !!current && entity.available,
          active: !!inventory?.reachable && !!current && entity.available && entity.state === true,
        }));
      const aliases = [
        ...new Set([
          ...(old?.aliases ?? row.value.aliases),
          ...legacyAliases,
          ...(registry.states ?? [])
            .filter(
              (state) =>
                state.attributes?.haus_source_camera === id &&
                state.attributes?.haus_native_camera === 1,
            )
            .map((state) => state.entity_id),
        ]),
      ].filter((alias) => alias !== id);
      const value = {
        ...old,
        id,
        name: old?.name ?? row.value.name,
        deviceId: deviceId ?? old?.deviceId ?? row.value.deviceId,
        deviceIds: old?.deviceIds ?? row.value.deviceIds ?? [],
        areaId: old?.areaId ?? row.value.areaId,
        aliases,
        available: !!inventory?.reachable && !!current && physical.available,
        enabled: settings.enabled === true,
        talkback: settings.talkback,
        motionDetection: settings.motionDetection ?? { enabled: false, mode: 'objects' },
        sensorMode: Array.isArray(settings.sensorIds) ? 'manual' : 'automatic',
        sensors: [
          ...(old?.sensors ?? []).filter((sensor) => !sensor.native),
          ...nativeSensors.filter(
            (sensor) =>
              !Array.isArray(settings.sensorIds) || settings.sensorIds.includes(sensor.id),
          ),
        ],
        suggested: old?.suggested ?? [],
        nativeProvider: {
          bridgeId: row.bridgeId,
          physicalId: row.physicalId,
          provider:
            inventory?.provider ??
            this.providers.connections().find((item) => item.id === row.bridgeId)?.connection
              .provider,
          manufacturer: physical.manufacturer,
          model: physical.model,
        },
        nativeSource: {
          kind: physical.stream.transport === 'p2p' ? 'p2p-restream' : 'rtsp',
          url: physical.stream.url,
        },
        nativeTalkback: physical.talkback?.url,
      };
      const index = result.findIndex((camera) => camera.id === id);
      if (index >= 0) result[index] = value;
      else result.push(value);
      for (let index = result.length - 1; index >= 0; index--)
        if (legacyAliases.includes(result[index].id)) result.splice(index, 1);
    }
    return result;
  }
  snapshot(camera) {
    if (!camera.nativeProvider) return undefined;
    const connection = this.providers
      .connections()
      .find((item) => item.id === camera.nativeProvider.bridgeId)?.connection;
    const row = this.rows().find((row) => row.value.cameraId === camera.id);
    if (!connection || !row) throw Error('native_provider_unavailable');
    let physical = row.value.physical;
    try {
      physical =
        this.providers
          .inventory(row.bridgeId)
          .cameras.find((camera) => camera.id === row.physicalId) ?? physical;
    } catch {
      /* Real cached frames remain usable. */
    }
    return {
      version: 1,
      provider: connection.provider,
      url: new URL(physical.snapshotPath, connection.endpoint.url).href,
    };
  }
}
