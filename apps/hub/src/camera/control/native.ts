/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { LightState } from '@haus/bridge/protocol';
import type {
  NativeProviderCamera,
  NativeProviderInventory,
  NativeProviders,
} from '../../providers/native.js';
import type { NativeCameraSources } from './sources.js';
import type { CameraOperatingControls } from './operating.js';
import type { CameraSpotlightState } from './spotlight.js';

type ProviderPort = Pick<NativeProviders, 'inventory' | 'command' | 'refresh'>;
type SourcePort = Pick<NativeCameraSources, 'rows'>;

const spotlightFields = ['on', 'brightness', 'hue', 'saturation', 'colorTemperature'] as const;

function spotlightMatches(current: CameraSpotlightState, requested: unknown): boolean {
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) return false;
  const fields = spotlightFields.filter(
    (field) => Object.hasOwn(requested, field) && Reflect.get(requested, field) !== undefined,
  );
  return (
    fields.length > 0 && fields.every((field) => current[field] === Reflect.get(requested, field))
  );
}

interface SelectedCamera {
  bridgeId: string;
  physicalId: string;
  camera: NativeProviderCamera;
  inventory?: NativeProviderInventory & { reachable: boolean };
  current?: NativeProviderCamera;
  available: boolean;
}

/** Camera controls dispatched to the enrolled native provider, without a HA service call. */
export class NativeCameraControls {
  private readonly spotlightReadbackTimeoutMs: number;
  private readonly spotlightReadbackIntervalMs: number;

  constructor(
    private readonly providers: ProviderPort,
    private readonly sources: SourcePort,
    options: { spotlightReadbackTimeoutMs?: number; spotlightReadbackIntervalMs?: number } = {},
  ) {
    this.spotlightReadbackTimeoutMs = options.spotlightReadbackTimeoutMs ?? 6000;
    this.spotlightReadbackIntervalMs = options.spotlightReadbackIntervalMs ?? 150;
  }

  manages(cameraId: string): boolean {
    return this.sources.rows().some((item) => item.value.cameraId === cameraId);
  }

  private select(cameraId: string): SelectedCamera | undefined {
    const row = this.sources.rows().find((item) => item.value.cameraId === cameraId);
    if (!row) return undefined;
    let inventory: SelectedCamera['inventory'];
    try {
      inventory = this.providers.inventory(row.bridgeId);
    } catch {
      // Retain imported capabilities in the UI while the provider is unavailable.
    }
    const current = inventory?.cameras.find((item) => item.id === row.physicalId);
    const camera = current ?? row.value.physical;
    if (!camera) return undefined;
    return {
      bridgeId: row.bridgeId,
      physicalId: row.physicalId,
      camera,
      inventory,
      current,
      available: inventory?.reachable === true && current?.available === true,
    };
  }

  operating(cameraId: string): CameraOperatingControls {
    const selected = this.select(cameraId);
    const result: CameraOperatingControls = {};
    for (const role of ['indicator', 'nightVision'] as const) {
      const entities = (selected?.camera.entities ?? []).filter(
        (entity) => entity.role === role && entity.writable,
      );
      if (entities.length !== 1) continue;
      const entity = entities[0]!;
      const mapping =
        entity.homekit ??
        (entity.domain === 'switch' ? { enabledValue: true, disabledValue: false } : undefined);
      if (
        !mapping ||
        ![mapping.enabledValue, mapping.disabledValue].includes(entity.state as boolean | string)
      )
        continue;
      result[role] = {
        id: `native:${entity.id}`,
        available: Boolean(selected?.available && entity.available),
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
    const selected = this.select(cameraId);
    const current = this.operating(cameraId)[role];
    const entity = selected?.camera.entities.find((item) => `native:${item.id}` === entityId);
    if (!selected?.available || !current?.available || current.id !== entityId || !entity)
      throw Error('camera_control_unavailable');
    const mapping =
      entity.homekit ??
      (entity.domain === 'switch' ? { enabledValue: true, disabledValue: false } : undefined);
    if (!mapping || typeof value !== 'boolean') throw Error('camera_control_unavailable');
    await this.send(selected, entity, value ? mapping.enabledValue : mapping.disabledValue);
    return { accepted: true };
  }

  spotlight(cameraId: string): CameraSpotlightState | undefined {
    const selected = this.select(cameraId);
    const entities = (selected?.camera.entities ?? []).filter(
      (entity) => entity.role === 'spotlight' && entity.domain === 'light' && entity.writable,
    );
    if (entities.length !== 1) return undefined;
    const entity = entities[0]!;
    const state =
      entity.state && typeof entity.state === 'object'
        ? (entity.state as LightState)
        : { on: false };
    return {
      id: `native:${entity.id}`,
      available: Boolean(selected?.available && entity.available),
      ...state,
      capabilities: {
        brightness: entity.brightness === true,
        color: entity.color === true,
        colorTemperature: entity.colorTemperature,
      },
    };
  }

  async writeSpotlight(
    cameraId: string,
    entityId: string,
    value: unknown,
  ): Promise<{ accepted: true }> {
    const selected = this.select(cameraId);
    const current = this.spotlight(cameraId);
    const entity = selected?.camera.entities.find((item) => `native:${item.id}` === entityId);
    if (!selected?.available || !current?.available || current.id !== entityId || !entity)
      throw Error('spotlight_unavailable');
    await this.send(selected, entity, value);
    const deadline = performance.now() + this.spotlightReadbackTimeoutMs;
    do {
      const reported = this.spotlight(cameraId);
      if (!reported?.available || reported.id !== entityId) throw Error('spotlight_unavailable');
      if (spotlightMatches(reported, value)) return { accepted: true };
      if (performance.now() >= deadline) break;
      await delay(this.spotlightReadbackIntervalMs);
      await this.providers.refresh(selected.bridgeId);
    } while (performance.now() < deadline);
    throw Error('camera_control_unconfirmed');
  }

  private async send(
    selected: SelectedCamera,
    entity: NativeProviderCamera['entities'][number],
    value: unknown,
  ): Promise<void> {
    await this.providers.command(
      selected.bridgeId,
      selected.physicalId,
      entity.id,
      { action: 'set', value },
      randomUUID(),
    );
    await this.providers.refresh(selected.bridgeId);
  }
}
