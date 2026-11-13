/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  Capability,
  DeviceCategory,
  HausDevice,
  HausEndpoint,
  Reading,
  SourceServiceRef,
} from '@haus/core';
import type { TuyaCloudDevice, TuyaCommandItem } from './types.js';

const CAMERA_CATEGORIES = new Set(['sp', 'mj', 'sxj']);
const CAMERA_DP_CODES = new Set([
  'basic_indicator',
  'basic_flip',
  'basic_osd',
  'basic_nightvision',
  'record_switch',
  'motion_switch',
  'ptz_control',
  'wireless_awake',
  'siren_switch',
  'sd_status',
  'ipc_work_mode',
]);

const LIGHT_CATEGORIES = new Set(['dj', 'dd', 'fwd', 'dc', 'xdd', 'fsd', 'tyndj']);
const POWER_CATEGORIES = new Set(['cz', 'pc']);
const SWITCH_CATEGORIES = new Set(['kg', 'tdq', 'dlq']);
const COVER_CATEGORIES = new Set(['cl', 'clkg', 'ckmkzq']);
const LOCK_CATEGORIES = new Set(['jtmspro', 'ms', 'mk']);
const CLIMATE_CATEGORIES = new Set(['wk', 'kt', 'fs']);

export interface MappedTuyaDevice {
  readonly device: HausDevice;
  readonly initialStates: ReadonlyArray<readonly [string, Record<string, unknown>]>;
}

export function flattenTuyaStatus(status: TuyaCloudDevice['status']): Record<string, unknown> {
  if (!status) return {};
  if (Array.isArray(status)) {
    const out: Record<string, unknown> = {};
    for (const item of status) {
      if (item && typeof item.code === 'string') {
        out[item.code] = item.value;
      }
    }
    return out;
  }
  return { ...status };
}

export function isTuyaCameraCloudDevice(
  device: TuyaCloudDevice,
  statusMap: Readonly<Record<string, unknown>>,
): boolean {
  const cat = (device.category ?? '').toLowerCase();
  if (CAMERA_CATEGORIES.has(cat)) return true;
  return Object.keys(statusMap).some((code) => CAMERA_DP_CODES.has(code));
}

function liveReading(value: unknown): Reading {
  return {
    value: (value === undefined ? null : value) as Reading['value'],
    observedAt: new Date().toISOString(),
    freshness: 'live',
  };
}

function ownerRef(entryId: string): SourceServiceRef {
  return {
    protocol: 'vendor',
    externalId: entryId,
    domain: 'tuya',
  };
}

function inferCategory(
  device: TuyaCloudDevice,
  statusMap: Readonly<Record<string, unknown>>,
): DeviceCategory {
  if (isTuyaCameraCloudDevice(device, statusMap)) return 'cameras';
  const cat = (device.category ?? '').toLowerCase();
  if (LIGHT_CATEGORIES.has(cat)) return 'lighting';
  if (POWER_CATEGORIES.has(cat)) return 'power';
  if (SWITCH_CATEGORIES.has(cat)) return 'appliances';
  if (COVER_CATEGORIES.has(cat)) return 'covers';
  if (LOCK_CATEGORIES.has(cat)) return 'security';
  if (CLIMATE_CATEGORIES.has(cat)) return 'climate';
  if (cat === 'pir' || cat === 'hps') return 'occupancy_sensors';
  if (cat === 'wsdcg' || cat === 'co2bj' || cat === 'pm25' || cat === 'ldcg') {
    return 'environmental_sensors';
  }
  if (cat === 'mcs' || cat === 'rqbj' || cat === 'sj' || cat === 'yg') {
    return 'safety_sensors';
  }
  return 'generic';
}

function mapBooleanBinaryEndpoints(
  device: TuyaCloudDevice,
  entryId: string,
  statusMap: Readonly<Record<string, unknown>>,
  owner: SourceServiceRef,
): Array<{ endpoint: HausEndpoint; state: Record<string, unknown> }> {
  const out: Array<{ endpoint: HausEndpoint; state: Record<string, unknown> }> = [];
  const switchKeys = Object.keys(statusMap).filter(
    (k) =>
      (k === 'switch' || k === 'switch_led' || /^switch_\d+$/.test(k) || k === 'switch_all') &&
      typeof statusMap[k] === 'boolean',
  );

  for (const key of switchKeys) {
    const val = Boolean(statusMap[key]);
    const suffix = switchKeys.length === 1 ? '' : ` (${key})`;
    const cap: Capability = {
      id: 'on_off',
      kind: 'binary',
      readable: true,
      operations: ['set', 'turn_on', 'turn_off'],
      name: `${device.name}${suffix}`,
    };
    const epId = `ep_tuya_${device.id}_${key}`;
    out.push({
      endpoint: {
        id: epId,
        name: `${device.name}${suffix}`,
        sourceOwner: owner,
        sourceRefs: [{ protocol: 'vendor', externalId: `${device.id}:${key}`, domain: 'tuya' }],
        capabilities: [cap],
        readings: { on_off: liveReading(val) },
      },
      state: { on_off: val, state: val ? 'on' : 'off' },
    });
  }
  return out;
}

function mapSensorCapabilities(statusMap: Readonly<Record<string, unknown>>): {
  capabilities: Capability[];
  state: Record<string, unknown>;
  readings: Record<string, Reading>;
} {
  const capabilities: Capability[] = [];
  const state: Record<string, unknown> = {};
  const readings: Record<string, Reading> = {};

  const tempRaw =
    typeof statusMap.va_temperature === 'number'
      ? statusMap.va_temperature / 10
      : typeof statusMap.temp_current === 'number'
        ? statusMap.temp_current / 10
        : undefined;
  if (tempRaw !== undefined) {
    capabilities.push({
      id: 'temperature',
      kind: 'numeric',
      readable: true,
      operations: [],
      unit: '°C',
    });
    state.temperature = tempRaw;
    readings.temperature = liveReading(tempRaw);
  }

  const humRaw =
    typeof statusMap.va_humidity === 'number'
      ? statusMap.va_humidity
      : typeof statusMap.humidity_value === 'number'
        ? statusMap.humidity_value
        : undefined;
  if (humRaw !== undefined) {
    capabilities.push({
      id: 'humidity',
      kind: 'numeric',
      readable: true,
      operations: [],
      unit: '%',
    });
    state.humidity = humRaw;
    readings.humidity = liveReading(humRaw);
  }

  const battery =
    typeof statusMap.battery_percentage === 'number' ? statusMap.battery_percentage : undefined;
  if (battery !== undefined) {
    capabilities.push({
      id: 'battery',
      kind: 'numeric',
      readable: true,
      operations: [],
      unit: '%',
      deviceClass: 'battery',
    });
    state.battery = battery;
    readings.battery = liveReading(battery);
  }

  if (typeof statusMap.pir === 'string' || typeof statusMap.pir === 'boolean') {
    const detected = statusMap.pir === true || statusMap.pir === 'pir';
    capabilities.push({ id: 'motion', kind: 'binary', readable: true, operations: [] });
    state.motion = detected;
    readings.motion = liveReading(detected);
  }

  if (typeof statusMap.doorcontact_state === 'boolean') {
    capabilities.push({ id: 'contact', kind: 'binary', readable: true, operations: [] });
    state.contact = statusMap.doorcontact_state;
    readings.contact = liveReading(statusMap.doorcontact_state);
  }

  if (typeof statusMap.cur_power === 'number') {
    const watts = statusMap.cur_power / 10;
    capabilities.push({
      id: 'power',
      kind: 'numeric',
      readable: true,
      operations: [],
      unit: 'W',
      deviceClass: 'power',
    });
    state.power = watts;
    readings.power = liveReading(watts);
  }

  return { capabilities, state, readings };
}

/** Maps a Tuya Cloud Sharing device into a canonical `HausDevice` without leaking `local_key`. */
export function mapTuyaDeviceToHaus(
  cloudDevice: TuyaCloudDevice,
  entryId: string,
  forceOffline = false,
): MappedTuyaDevice {
  const statusMap = flattenTuyaStatus(cloudDevice.status);
  const category = inferCategory(cloudDevice, statusMap);
  const owner = ownerRef(entryId);
  const deviceId = `tuya:${cloudDevice.id}`;
  const availability = forceOffline
    ? 'offline'
    : cloudDevice.online === false
      ? 'offline'
      : 'online';
  const endpoints: HausEndpoint[] = [];
  const initialStates: Array<readonly [string, Record<string, unknown>]> = [];

  if (category === 'cameras') {
    const epId = `ep_tuya_${cloudDevice.id}_camera`;
    endpoints.push({
      id: epId,
      name: cloudDevice.name,
      category: 'cameras',
      availability,
      sourceOwner: owner,
      sourceRefs: [{ protocol: 'vendor', externalId: `${cloudDevice.id}:camera`, domain: 'tuya' }],
      capabilities: [
        {
          id: 'video',
          kind: 'camera',
          readable: false,
          operations: ['stream'],
          name: cloudDevice.name,
        },
      ],
      readings: {},
    });
    initialStates.push([epId, { online: availability === 'online' }]);
  } else if (category === 'covers') {
    const epId = `ep_tuya_${cloudDevice.id}_cover`;
    const pct = typeof statusMap.percent_control === 'number' ? statusMap.percent_control : 0;
    endpoints.push({
      id: epId,
      name: cloudDevice.name,
      category: 'covers',
      availability,
      sourceOwner: owner,
      sourceRefs: [{ protocol: 'vendor', externalId: `${cloudDevice.id}:cover`, domain: 'tuya' }],
      capabilities: [
        {
          id: 'cover',
          kind: 'numeric',
          readable: true,
          operations: ['open', 'close', 'stop', 'set'],
          minimum: 0,
          maximum: 100,
        },
      ],
      readings: { cover: liveReading(pct) },
    });
    initialStates.push([epId, { position: pct, cover: pct }]);
  } else if (LOCK_CATEGORIES.has((cloudDevice.category ?? '').toLowerCase())) {
    const epId = `ep_tuya_${cloudDevice.id}_lock`;
    const locked = statusMap.lock_motor_state === false;
    endpoints.push({
      id: epId,
      name: cloudDevice.name,
      category: 'security',
      availability,
      sourceOwner: owner,
      sourceRefs: [{ protocol: 'vendor', externalId: `${cloudDevice.id}:lock`, domain: 'tuya' }],
      capabilities: [
        {
          id: 'lock',
          kind: 'binary',
          readable: true,
          operations: ['lock', 'unlock', 'set'],
        },
      ],
      readings: { lock: liveReading(locked) },
    });
    initialStates.push([epId, { lock: locked }]);
  } else {
    for (const mapped of mapBooleanBinaryEndpoints(cloudDevice, entryId, statusMap, owner)) {
      endpoints.push({ ...mapped.endpoint, category, availability });
      initialStates.push([mapped.endpoint.id, mapped.state]);
    }
    if (category === 'lighting' && endpoints.length === 1) {
      const bright =
        typeof statusMap.bright_value_v2 === 'number'
          ? Math.round(statusMap.bright_value_v2 / 10)
          : typeof statusMap.bright_value === 'number'
            ? Math.round((statusMap.bright_value / 255) * 100)
            : undefined;
      if (bright !== undefined) {
        const primary = endpoints[0];
        endpoints[0] = {
          ...primary,
          capabilities: [
            ...primary.capabilities,
            {
              id: 'brightness',
              kind: 'numeric',
              readable: true,
              operations: ['set'],
              minimum: 0,
              maximum: 100,
            },
          ],
          readings: { ...primary.readings, brightness: liveReading(bright) },
        };
        initialStates[0] = [primary.id, { ...initialStates[0][1], brightness: bright }];
      }
    }
  }

  const telemetry = mapSensorCapabilities(statusMap);
  if (telemetry.capabilities.length > 0) {
    const epId = `ep_tuya_${cloudDevice.id}_sensors`;
    endpoints.push({
      id: epId,
      name: `${cloudDevice.name} Telemetry`,
      category,
      availability,
      sourceRefs: [{ protocol: 'vendor', externalId: `${cloudDevice.id}:sensors`, domain: 'tuya' }],
      capabilities: telemetry.capabilities,
      readings: telemetry.readings,
    });
    initialStates.push([epId, telemetry.state]);
  }

  if (endpoints.length === 0) {
    const epId = `ep_tuya_${cloudDevice.id}_status`;
    const isOnline = availability === 'online';
    endpoints.push({
      id: epId,
      name: cloudDevice.name,
      category,
      availability,
      sourceRefs: [{ protocol: 'vendor', externalId: `${cloudDevice.id}:status`, domain: 'tuya' }],
      capabilities: [{ id: 'connectivity', kind: 'binary', readable: true, operations: [] }],
      readings: { connectivity: liveReading(isOnline) },
    });
    initialStates.push([epId, { connectivity: isOnline }]);
  }

  return {
    device: {
      id: deviceId,
      source: { instanceId: entryId, externalId: cloudDevice.id },
      name: cloudDevice.name,
      category,
      manufacturer: 'Tuya',
      model: cloudDevice.product_name ?? cloudDevice.category,
      connectivity: {
        protocol: 'local_ip',
        ...(cloudDevice.ip ? { address: cloudDevice.ip } : {}),
      },
      availability,
      endpoints,
      opaqueMetadata: {
        tuyaCategory: cloudDevice.category,
        tuyaProductId: cloudDevice.product_id,
      },
    },
    initialStates,
  };
}

/** Converts a Haus device command targeting a Tuya endpoint into Tuya DP commands. */
export function buildTuyaDpCommands(
  sourceRefs: readonly SourceServiceRef[] | undefined,
  capability: string,
  command: string,
  parameters?: Readonly<Record<string, unknown>>,
): { readonly tuyaDeviceId: string; readonly commands: readonly TuyaCommandItem[] } | undefined {
  const ref = sourceRefs?.find((item) => item.domain === 'tuya');
  if (!ref?.externalId) return undefined;
  const colonIdx = ref.externalId.indexOf(':');
  if (colonIdx <= 0) return undefined;
  const tuyaDeviceId = ref.externalId.slice(0, colonIdx);
  const dpCode = ref.externalId.slice(colonIdx + 1);
  if (!tuyaDeviceId || !dpCode) return undefined;

  if (capability === 'on_off' && dpCode !== 'camera') {
    const boolVal =
      command === 'turn_on'
        ? true
        : command === 'turn_off'
          ? false
          : typeof parameters?.value === 'boolean'
            ? parameters.value
            : typeof parameters?.state === 'boolean'
              ? parameters.state
              : command === 'on';
    const commands: TuyaCommandItem[] = [{ code: dpCode, value: boolVal }];
    if (typeof parameters?.brightness === 'number') {
      commands.push({
        code: 'bright_value_v2',
        value: Math.max(10, Math.min(1000, Math.round(parameters.brightness * 10))),
      });
    }
    return { tuyaDeviceId, commands };
  }

  if (capability === 'brightness' && typeof parameters?.value === 'number') {
    return {
      tuyaDeviceId,
      commands: [
        {
          code: 'bright_value_v2',
          value: Math.max(10, Math.min(1000, Math.round(parameters.value * 10))),
        },
      ],
    };
  }

  if (capability === 'cover') {
    if (command === 'open' || command === 'close' || command === 'stop') {
      return { tuyaDeviceId, commands: [{ code: 'control', value: command }] };
    }
    if (typeof parameters?.position === 'number' || typeof parameters?.value === 'number') {
      const pos = Number(parameters?.position ?? parameters?.value);
      return {
        tuyaDeviceId,
        commands: [{ code: 'percent_control', value: Math.max(0, Math.min(100, Math.round(pos))) }],
      };
    }
  }

  return undefined;
}
