/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';

export const CAMERA_BRIDGE_SERVICE = 'rsnra-camera';
export const CAMERA_BRIDGE_PROFILE = 2;
export type Provider = string;
export const providerId = (value: unknown): value is Provider =>
  typeof value === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(value);
export type Domain =
  'binary_sensor' | 'sensor' | 'switch' | 'light' | 'number' | 'select' | 'button';
export interface LightState {
  on: boolean;
  brightness?: number;
  colorTemperature?: number;
  hue?: number;
  saturation?: number;
}
export interface BridgeEntity {
  id: string;
  mqtt?: { uniqueId: string };
  name: string;
  domain: Domain;
  role?: 'spotlight' | 'motion' | 'indicator' | 'nightVision' | 'infrared';
  homekit?: { enabledValue: boolean | string; disabledValue: boolean | string };
  available: boolean;
  state: string | number | boolean | null | LightState;
  updatedAt: number;
  deviceClass?: string;
  unit?: string;
  writable?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  brightness?: boolean;
  colorTemperature?: { minKelvin: number; maxKelvin: number };
  color?: boolean;
}
export interface BridgeCamera {
  id: string;
  mqtt?: { uniqueId: string };
  name: string;
  manufacturer: string;
  model: string;
  available: boolean;
  identifiers: string[];
  stream: { url: string; transport: 'p2p' | 'native-rtsp' };
  snapshotPath: string;
  talkback?: { transport: 'rtmp'; codec: 'aac'; url: string };
  entities: BridgeEntity[];
}
export interface BridgeInventory {
  version: 2;
  bridgeId: string;
  provider: Provider;
  cameras: BridgeCamera[];
}
export const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
export const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const text = (value: unknown, max = 128): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const domains: Domain[] = [
  'binary_sensor',
  'sensor',
  'switch',
  'light',
  'number',
  'select',
  'button',
];
const fail = (): never => {
  throw Error('invalid_bridge_inventory');
};
const mqttAlias = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).join(',') === 'uniqueId' && text(Reflect.get(value, 'uniqueId'), 256);
};

function lightValue(entity: BridgeEntity, value: unknown, partial: boolean): value is LightState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const light = value as LightState,
    keys = Object.keys(light);
  if (
    !keys.length ||
    keys.some((key) => !['on', 'brightness', 'colorTemperature', 'hue', 'saturation'].includes(key))
  )
    return false;
  if ((!partial || light.on !== undefined) && typeof light.on !== 'boolean') return false;
  if (
    light.brightness !== undefined &&
    (!entity.brightness ||
      !finite(light.brightness) ||
      light.brightness < 0 ||
      light.brightness > 100)
  )
    return false;
  if (
    light.colorTemperature !== undefined &&
    (!entity.colorTemperature ||
      !finite(light.colorTemperature) ||
      light.colorTemperature < entity.colorTemperature.minKelvin ||
      light.colorTemperature > entity.colorTemperature.maxKelvin)
  )
    return false;
  if (
    light.hue !== undefined &&
    (!entity.color || !finite(light.hue) || light.hue < 0 || light.hue > 360)
  )
    return false;
  if (
    light.saturation !== undefined &&
    (!entity.color || !finite(light.saturation) || light.saturation < 0 || light.saturation > 100)
  )
    return false;
  return true;
}

/** An authenticated provider supplies facts, never executable templates or arbitrary HTTP commands. */
export function validateInventory(input: unknown): BridgeInventory {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail();
  const value = input as BridgeInventory;
  if (
    value.version !== 2 ||
    !uuid(value.bridgeId) ||
    !providerId(value.provider) ||
    !Array.isArray(value.cameras) ||
    value.cameras.length > 128
  )
    fail();
  const cameraIds = new Set<string>();
  for (const camera of value.cameras) {
    if (
      !camera ||
      !identifier(camera.id) ||
      !mqttAlias(camera.mqtt) ||
      cameraIds.has(camera.id) ||
      !text(camera.name) ||
      !text(camera.manufacturer) ||
      !text(camera.model) ||
      typeof camera.available !== 'boolean' ||
      !Array.isArray(camera.identifiers) ||
      !camera.identifiers.length ||
      camera.identifiers.length > 8 ||
      camera.identifiers.some((id) => !identifier(id)) ||
      !Array.isArray(camera.entities) ||
      camera.entities.length > 128
    )
      fail();
    cameraIds.add(camera.id);
    if (
      !camera.stream ||
      !['p2p', 'native-rtsp'].includes(camera.stream.transport) ||
      !text(camera.stream.url, 2048) ||
      !/^\/api\/cameras\/[a-zA-Z0-9_-]{1,128}\/snapshot\/last-live$/.test(camera.snapshotPath)
    )
      fail();
    try {
      const source = new URL(camera.stream.url);
      if (
        !['rtsp:', 'rtsps:'].includes(source.protocol) ||
        source.hash ||
        source.search ||
        !source.hostname
      )
        fail();
    } catch {
      fail();
    }
    if (camera.talkback !== undefined) {
      if (!camera.talkback || typeof camera.talkback !== 'object' || Array.isArray(camera.talkback))
        fail();
      if (
        camera.talkback.transport !== 'rtmp' ||
        camera.talkback.codec !== 'aac' ||
        !text(camera.talkback.url, 2048)
      )
        fail();
      try {
        const target = new URL(camera.talkback.url);
        if (
          target.protocol !== 'rtmp:' ||
          !target.hostname ||
          target.hash ||
          target.search ||
          !/^\/talk\/[a-zA-Z0-9_-]{1,128}$/.test(target.pathname)
        )
          fail();
      } catch {
        fail();
      }
    }
    const entityIds = new Set<string>();
    const mqttIds = new Set<string>();
    for (const entity of camera.entities) {
      if (
        !entity ||
        !identifier(entity.id) ||
        !mqttAlias(entity.mqtt) ||
        entityIds.has(entity.id) ||
        !text(entity.name) ||
        !domains.includes(entity.domain) ||
        typeof entity.available !== 'boolean' ||
        !finite(entity.updatedAt) ||
        entity.updatedAt < 0 ||
        entity.updatedAt > 8_640_000_000_000_000 ||
        !(
          entity.state === null ||
          typeof entity.state === 'boolean' ||
          finite(entity.state) ||
          text(entity.state, 512) ||
          (entity.domain === 'light' && lightValue(entity, entity.state, false))
        )
      )
        fail();
      entityIds.add(entity.id);
      if (entity.mqtt) {
        const key = JSON.stringify([entity.domain, entity.mqtt.uniqueId]);
        if (mqttIds.has(key)) fail();
        mqttIds.add(key);
      }
      if (
        entity.role !== undefined &&
        !(
          (entity.role === 'spotlight' && entity.domain === 'light') ||
          (entity.role === 'motion' && entity.domain === 'binary_sensor') ||
          (['indicator', 'nightVision', 'infrared'].includes(entity.role) &&
            ['switch', 'select'].includes(entity.domain))
        )
      )
        fail();
      if (entity.homekit !== undefined) {
        const values = entity.homekit;
        if (
          !entity.writable ||
          !['indicator', 'nightVision'].includes(entity.role ?? '') ||
          !values ||
          typeof values !== 'object' ||
          Object.keys(values).sort().join(',') !== 'disabledValue,enabledValue' ||
          values.enabledValue === values.disabledValue ||
          (entity.domain === 'switch' &&
            (typeof values.enabledValue !== 'boolean' ||
              typeof values.disabledValue !== 'boolean')) ||
          (entity.domain === 'select' &&
            (!entity.options?.includes(String(values.enabledValue)) ||
              !entity.options?.includes(String(values.disabledValue))))
        )
          fail();
      }
      if (entity.deviceClass !== undefined && !text(entity.deviceClass, 64)) fail();
      if (entity.unit !== undefined && !text(entity.unit, 32)) fail();
      if (entity.writable !== undefined && typeof entity.writable !== 'boolean') fail();
      if (['sensor', 'binary_sensor'].includes(entity.domain) && entity.writable) fail();
      if (
        entity.domain === 'number' &&
        (!finite(entity.min) ||
          !finite(entity.max) ||
          entity.min > entity.max ||
          !finite(entity.step) ||
          entity.step <= 0)
      )
        fail();
      if (
        entity.domain === 'select' &&
        (!Array.isArray(entity.options) ||
          !entity.options.length ||
          entity.options.length > 128 ||
          entity.options.some((option) => !text(option)) ||
          new Set(entity.options).size !== entity.options.length)
      )
        fail();
      if (
        entity.brightness !== undefined &&
        (entity.domain !== 'light' || typeof entity.brightness !== 'boolean')
      )
        fail();
      if (
        entity.color !== undefined &&
        (entity.domain !== 'light' || typeof entity.color !== 'boolean')
      )
        fail();
      if (
        entity.colorTemperature !== undefined &&
        (entity.domain !== 'light' ||
          !finite(entity.colorTemperature?.minKelvin) ||
          !finite(entity.colorTemperature?.maxKelvin) ||
          entity.colorTemperature.minKelvin < 1000 ||
          entity.colorTemperature.maxKelvin > 10000 ||
          entity.colorTemperature.minKelvin > entity.colorTemperature.maxKelvin)
      )
        fail();
    }
  }
  // Drop object prototypes and external references before retaining provider data.
  return JSON.parse(JSON.stringify(value));
}

/** State/availability changes do not invalidate a completed entity handover. Capability changes do. */
export function inventoryRevision(value: BridgeInventory): string {
  const shape = value.cameras
    .map((camera) => ({
      id: camera.id,
      entities: camera.entities
        .map(({ state: _state, updatedAt: _at, available: _available, ...entity }) => entity)
        .sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256')
    .update(JSON.stringify({ bridgeId: value.bridgeId, provider: value.provider, shape }))
    .digest('hex');
}

export function entityKeys(value: {
  cameras: ReadonlyArray<{ id: string; entities: ReadonlyArray<{ id: string }> }>;
}): string[] {
  return value.cameras
    .flatMap((camera) => [
      `camera/${encodeURIComponent(camera.id)}`,
      ...camera.entities.map(
        (entity) => `entity/${encodeURIComponent(camera.id)}/${encodeURIComponent(entity.id)}`,
      ),
    ])
    .sort();
}

export type BridgeCommand =
  { action: 'set'; value: boolean | number | string | Partial<LightState> } | { action: 'press' };
/** Commands reference an advertised entity, not MQTT topics, URLs or provider method names. */
export function validateCommand(entity: BridgeEntity, input: unknown): BridgeCommand {
  const denied = (): never => {
    throw Error('invalid_bridge_command');
  };
  if (!entity.available) throw Error('bridge_entity_unavailable');
  if (!entity.writable) throw Error('bridge_entity_read_only');
  if (!input || typeof input !== 'object' || Array.isArray(input)) return denied();
  const command = input as BridgeCommand;
  if (entity.domain === 'button') {
    if (command.action !== 'press' || Object.keys(command).length !== 1) return denied();
    return { action: 'press' };
  }
  if (
    command.action !== 'set' ||
    Object.keys(command).length !== 2 ||
    !Object.hasOwn(command, 'value')
  )
    return denied();
  const value = command.value;
  switch (entity.domain) {
    case 'switch':
      if (typeof value !== 'boolean') return denied();
      break;
    case 'number': {
      if (
        !finite(value) ||
        value < entity.min! ||
        value > entity.max! ||
        Math.abs(
          (value - entity.min!) / entity.step! - Math.round((value - entity.min!) / entity.step!),
        ) > 1e-6
      )
        return denied();
      break;
    }
    case 'select':
      if (typeof value !== 'string' || !entity.options?.includes(value)) return denied();
      break;
    case 'light':
      if (!lightValue(entity, value, true)) return denied();
      break;
    default:
      return denied();
  }
  return structuredClone(command);
}
