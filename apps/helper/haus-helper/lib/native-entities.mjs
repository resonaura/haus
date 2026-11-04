/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import { entityKeys } from '@haus/bridge/protocol';
import { activityKey } from './camera-activity.mjs';
import { kitsuneDeviceIdentity } from '@haus/kitsune';

/** Materialized HA entity descriptions contain no provider token, source URL or executable template. */
export class NativeEntities {
  constructor({ sources, providers, registry, activity, store, now = Date.now }) {
    Object.assign(this, { sources, providers, registry, activity, store, now });
    this.serial = new Map();
    store?.db.exec(
      'CREATE TABLE IF NOT EXISTS native_ha_features(client_id TEXT PRIMARY KEY,disabled_readiness INTEGER NOT NULL,at INTEGER NOT NULL)',
    );
    store?.db.exec(
      'CREATE TABLE IF NOT EXISTS native_ha_ready(client_id TEXT NOT NULL,camera_id TEXT NOT NULL,revision TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(client_id,camera_id))',
    );
    store?.db.exec(
      'CREATE TABLE IF NOT EXISTS native_ha_owner(camera_id TEXT PRIMARY KEY,client_id TEXT NOT NULL)',
    );
    store?.db.exec(
      'CREATE TABLE IF NOT EXISTS native_ha_release(bridge_id TEXT PRIMARY KEY,requested_at INTEGER NOT NULL)',
    );
  }
  transaction(id, action) {
    const pending = (this.serial.get(id) ?? Promise.resolve()).then(action);
    const settled = pending.catch(() => {});
    this.serial.set(id, settled);
    return pending.finally(() => {
      if (this.serial.get(id) === settled) this.serial.delete(id);
    });
  }
  /** Persist explicit revocation before deleting the HA grant; outages alone never release it. */
  revokeClient(clientId) {
    const owned = new Set(
      this.store.db
        .prepare('SELECT camera_id FROM native_ha_owner WHERE client_id=?')
        .all(clientId)
        .map((row) => row.camera_id),
    );
    for (const row of this.sources.rows())
      if (owned.has(row.value.cameraId))
        this.store.db
          .prepare('INSERT OR IGNORE INTO native_ha_release VALUES(?,?)')
          .run(row.bridgeId, this.now());
  }
  async tick() {
    const pending = this.store.db.prepare('SELECT bridge_id FROM native_ha_release').all();
    for (let offset = 0; offset < pending.length; offset += 4)
      await Promise.allSettled(
        pending.slice(offset, offset + 4).map(({ bridge_id: id }) =>
          this.transaction(id, async () => {
            // A handover ahead of this retry may already have cancelled the release.
            if (!this.store.db.prepare('SELECT 1 FROM native_ha_release WHERE bridge_id=?').get(id))
              return;
            await this.providers.releaseNative(id);
            for (const row of this.sources.rows().filter((row) => row.bridgeId === id))
              this.store.db
                .prepare('DELETE FROM native_ha_owner WHERE camera_id=?')
                .run(row.value.cameraId);
            this.store.db.prepare('DELETE FROM native_ha_release WHERE bridge_id=?').run(id);
          }),
        ),
      );
    // Rejected releases keep their durable intent until the enrolled provider returns.
  }
  acknowledge(clientId, input) {
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
      const device = devices.find((device) => device.cameraId === item?.cameraId);
      if (
        !device ||
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
    if (input.features?.disabledReadiness)
      this.store.db
        .prepare(
          'INSERT INTO native_ha_features VALUES(?,1,?) ON CONFLICT(client_id)DO UPDATE SET disabled_readiness=1,at=excluded.at',
        )
        .run(clientId, this.now());
    for (const value of values.filter(Boolean))
      this.store.db
        .prepare(
          'INSERT INTO native_ha_ready VALUES(?,?,?,?) ON CONFLICT(client_id,camera_id)DO UPDATE SET revision=excluded.revision,at=excluded.at',
        )
        .run(clientId, value.cameraId, value.revision, this.now());
    return { ready: true };
  }
  ownsActivity(cameraId) {
    if (this.registry().cameras.some(camera => camera.id === cameraId && camera.kitsuneProvider))
      return !!this.store?.db.prepare('SELECT 1 FROM ha_camera_clients WHERE native_entities=1 LIMIT 1').get();
    return !!this.store?.db
      .prepare(
        'SELECT 1 FROM native_ha_owner r JOIN ha_camera_clients c ON c.id=r.client_id WHERE r.camera_id=? AND c.native_entities=1 LIMIT 1',
      )
      .get(cameraId);
  }
  readyClient(cameraId, revision) {
    return this.store.db
      .prepare(
        'SELECT r.client_id FROM native_ha_ready r JOIN ha_camera_clients c ON c.id=r.client_id WHERE r.camera_id=? AND r.revision=? AND r.at>=? AND c.native_entities=1 ORDER BY r.at DESC LIMIT 1',
      )
      .get(cameraId, revision, this.now() - 30000);
  }
  supportsDisabledReadiness(cameraId, revision) {
    const client = this.readyClient(cameraId, revision);
    return (
      !!client &&
      !!this.store.db
        .prepare(
          'SELECT 1 FROM native_ha_features WHERE client_id=? AND disabled_readiness=1 AND at>=?',
        )
        .get(client.client_id, this.now() - 30000)
    );
  }
  handoverStatus(id, registry, ignoredLegacy = new Set()) {
    const imported = this.sources.rows().filter((row) => row.bridgeId === id);
    let inventory;
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
    const releasing = !!this.store.db
      .prepare('SELECT 1 FROM native_ha_release WHERE bridge_id=?')
      .get(id);
    const cameras = inventory.cameras.map((physical) => {
      const row = imported.find((row) => row.physicalId === physical.id);
      const cameraId = row?.value.cameraId;
      const deviceIds = new Set(row?.value.deviceIds ?? []);
      if (row?.value.deviceId) deviceIds.add(row.value.deviceId);
      for (const device of registry.devices ?? [])
        if (
          device.identifiers?.some(
            ([platform, value]) =>
              ['mqtt', inventory.provider].includes(platform) &&
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
                (entity.unique_id === activityKey(cameraId) || deviceIds.has(entity.device_id)))),
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
  async handover(id) {
    return this.transaction(id, () => this.completeHandover(id));
  }
  async completeHandover(id) {
    const inventory = this.providers.inventory(id);
    if (!inventory.reachable || !inventory.cameras.length)
      throw Error('native_provider_unavailable');
    const imported = this.sources.rows().filter((row) => row.bridgeId === id);
    const owners = [];
    for (const physical of inventory.cameras) {
      const row = imported.find((row) => row.physicalId === physical.id);
      const ready = row && this.readyClient(row.value.cameraId, inventory.revision);
      if (!ready) throw Error('native_ha_not_ready');
      owners.push({ cameraId: row.value.cameraId, clientId: ready.client_id });
    }
    await this.providers.confirm(id, inventory.revision, entityKeys(inventory));
    if (
      owners.some(
        (owner) =>
          !this.store.db
            .prepare('SELECT 1 FROM ha_camera_clients WHERE id=? AND native_entities=1')
            .get(owner.clientId),
      )
    ) {
      this.store.db
        .prepare('INSERT OR IGNORE INTO native_ha_release VALUES(?,?)')
        .run(id, this.now());
      throw Error('native_ha_grant_revoked');
    }
    this.store.db.prepare('DELETE FROM native_ha_release WHERE bridge_id=?').run(id);
    for (const owner of owners)
      this.store.db
        .prepare(
          'INSERT INTO native_ha_owner VALUES(?,?) ON CONFLICT(camera_id)DO UPDATE SET client_id=excluded.client_id',
        )
        .run(owner.cameraId, owner.clientId);
    return { native: true };
  }
  devices() {
    const cameras = this.registry().cameras;
    const devices = this.sources.rows().flatMap((row) => {
      const camera = cameras.find(
        (item) => item.id === row.value.cameraId && item.nativeProvider?.bridgeId === row.bridgeId,
      );
      if (!camera) return [];
      let inventory;
      try {
        inventory = this.providers.inventory(row.bridgeId);
      } catch {}
      const current = inventory?.cameras.find((item) => item.id === row.physicalId);
      const physical = current ?? row.value.physical;
      const entities = physical.entities
        .filter(
          (entity) =>
            entity.role !== 'motion' &&
            // Transport telemetry is consumed by the media controller, never copied into HA state.
            !/^(?:p2p_rtsp_stream|native_rtsp_stream|rtsp_stream|snapshot_url|talkback_rtmp)$/.test(
              entity.id,
            ),
        )
        .map((entity) => {
          const value = structuredClone(entity);
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
    for (const camera of cameras.filter(camera => camera.kitsuneProvider)) {
      const activity = this.activity?.status(camera.id);
      const plugin = camera.kitsuneProvider;
      devices.push({
        cameraId: camera.id, name: camera.name, deviceId: camera.deviceId ?? null,
        ...kitsuneDeviceIdentity(plugin),
        manufacturer: 'Kitsune', model: plugin.pluginId, available: camera.available,
        entities: activity ? [{ id: 'haus_activity', name: 'Activity', domain: 'binary_sensor', role: 'motion', deviceClass: 'motion', state: activity.active, available: activity.available, updatedAt: activity.lastDetectedAt ?? 0, writable: false, nativeSources: (activity.replaces ?? []).slice(0, 32) }] : [],
      });
    }
    return devices;
  }
  async command(cameraId, entityId, input) {
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
  operating(cameraId) {
    const device = this.devices().find((item) => item.cameraId === cameraId);
    const result = {};
    for (const role of ['indicator', 'nightVision']) {
      const entities =
        device?.entities.filter((entity) => entity.role === role && entity.writable) ?? [];
      if (entities.length !== 1) continue;
      const entity = entities[0],
        mapping =
          entity.homekit ??
          (entity.domain === 'switch' ? { enabledValue: true, disabledValue: false } : undefined);
      if (!mapping || ![mapping.enabledValue, mapping.disabledValue].includes(entity.state))
        continue;
      result[role] = {
        id: `native:${entity.id}`,
        available: entity.available,
        value: entity.state === mapping.enabledValue,
      };
    }
    return result;
  }
  async writeOperating(cameraId, role, entityId, value) {
    const current = this.operating(cameraId)[role];
    if (!current?.available || current.id !== entityId || typeof value !== 'boolean')
      throw Error('camera_control_unavailable');
    const entity = this.devices()
      .find((item) => item.cameraId === cameraId)
      .entities.find((item) => `native:${item.id}` === entityId);
    const mapping = entity.homekit ?? { enabledValue: true, disabledValue: false };
    return this.command(cameraId, entity.id, {
      requestId: randomUUID(),
      command: { action: 'set', value: value ? mapping.enabledValue : mapping.disabledValue },
    });
  }
  spotlight(cameraId) {
    const entities =
      this.devices()
        .find((item) => item.cameraId === cameraId)
        ?.entities.filter(
          (entity) => entity.role === 'spotlight' && entity.domain === 'light' && entity.writable,
        ) ?? [];
    if (entities.length !== 1) return;
    const entity = entities[0],
      state = entity.state && typeof entity.state === 'object' ? entity.state : {};
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
  async writeSpotlight(cameraId, entityId, value) {
    const current = this.spotlight(cameraId);
    if (!current?.available || current.id !== entityId) throw Error('spotlight_unavailable');
    return this.command(cameraId, entityId.slice(7), {
      requestId: randomUUID(),
      command: { action: 'set', value },
    });
  }
}
