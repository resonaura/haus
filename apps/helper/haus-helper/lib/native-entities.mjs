/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import { entityKeys } from '@haus/bridge/protocol';

/** Materialized HA entity descriptions contain no provider token, source URL or executable template. */
export class NativeEntities {
  constructor({ sources, providers, registry, activity, store, now = Date.now }) {
    Object.assign(this, { sources, providers, registry, activity, store, now });
    this.serial = Promise.resolve();
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
  transaction(action) {
    const pending = this.serial.then(action);
    this.serial = pending.catch(() => {});
    return pending;
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
  tick() {
    return this.transaction(async () => {
      for (const { bridge_id: id } of this.store.db
        .prepare('SELECT bridge_id FROM native_ha_release')
        .all()) {
        try {
          await this.providers.releaseNative(id);
          for (const row of this.sources.rows().filter((row) => row.bridgeId === id))
            this.store.db
              .prepare('DELETE FROM native_ha_owner WHERE camera_id=?')
              .run(row.value.cameraId);
          this.store.db.prepare('DELETE FROM native_ha_release WHERE bridge_id=?').run(id);
        } catch {
          /* Keep the durable intent until the enrolled provider returns. */
        }
      }
    });
  }
  acknowledge(clientId, input) {
    if (
      !input ||
      Object.keys(input).join(',') !== 'cameras' ||
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
      return {
        cameraId: device.cameraId,
        revision: this.providers.inventory(device.bridgeId).revision,
      };
    });
    for (const value of values)
      this.store.db
        .prepare(
          'INSERT INTO native_ha_ready VALUES(?,?,?,?) ON CONFLICT(client_id,camera_id)DO UPDATE SET revision=excluded.revision,at=excluded.at',
        )
        .run(clientId, value.cameraId, value.revision, this.now());
    return { ready: true };
  }
  ownsActivity(cameraId) {
    return !!this.store?.db
      .prepare(
        'SELECT 1 FROM native_ha_owner r JOIN ha_camera_clients c ON c.id=r.client_id WHERE r.camera_id=? AND c.native_entities=1 LIMIT 1',
      )
      .get(cameraId);
  }
  async handover(id) {
    return this.transaction(() => this.completeHandover(id));
  }
  async completeHandover(id) {
    const inventory = this.providers.inventory(id);
    if (!inventory.reachable || !inventory.cameras.length)
      throw Error('native_provider_unavailable');
    const imported = this.sources.rows().filter((row) => row.bridgeId === id);
    const owners = [];
    for (const physical of inventory.cameras) {
      const row = imported.find((row) => row.physicalId === physical.id);
      const ready =
        row &&
        this.store.db
          .prepare(
            'SELECT r.client_id FROM native_ha_ready r JOIN ha_camera_clients c ON c.id=r.client_id WHERE r.camera_id=? AND r.revision=? AND r.at>=? AND c.native_entities=1 ORDER BY r.at DESC LIMIT 1',
          )
          .get(row.value.cameraId, inventory.revision, this.now() - 30000);
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
    return this.sources.rows().flatMap((row) => {
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
