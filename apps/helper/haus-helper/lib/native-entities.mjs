/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';

/** Materialized HA entity descriptions contain no provider token, source URL or executable template. */
export class NativeEntities {
  constructor({ sources, providers, registry, activity }) {
    Object.assign(this, { sources, providers, registry, activity });
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
          value.available = !!inventory?.reachable && !!current && entity.available;
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
