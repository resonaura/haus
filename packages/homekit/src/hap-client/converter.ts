/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Characteristics, Services } from '@homebridge/hap-client/hap-types';
import {
  brightnessCapability,
  contactCapability,
  createColorTempCapability,
  createTemperatureCapability,
  inferDeviceCategory,
  inferRoomIdFromLabels,
  lockCapability,
  motionCapability,
  onOffCapability,
  type Capability,
  type HausDevice,
  type HausEndpoint,
} from '@haus/core';
import type {
  RawHapAccessoriesResponse,
  RawHapAccessory,
  RawHapCharacteristic,
  RawHapService,
} from '../passthrough.js';

const leakCapability: Capability = {
  id: 'leak',
  kind: 'binary',
  readable: true,
  operations: [],
};

const occupancyCapability: Capability = {
  id: 'occupancy',
  kind: 'binary',
  readable: true,
  operations: [],
};

const humidityCapability: Capability = {
  id: 'humidity',
  kind: 'numeric',
  readable: true,
  operations: [],
  unit: '%',
};

const batteryCapability: Capability = {
  id: 'battery',
  kind: 'numeric',
  readable: true,
  operations: [],
  unit: '%',
  entityCategory: 'diagnostic',
};

export interface HapCharacteristicBinding {
  readonly accessoryId: string;
  readonly aid: number;
  readonly iid: number;
  readonly deviceId: string;
  readonly endpointId: string;
  readonly capabilityId: string;
  readonly charType: string;
  readonly writable: boolean;
  readonly eventable: boolean;
}

export interface ConvertedHapTopology {
  readonly devices: readonly HausDevice[];
  readonly initialStates: ReadonlyMap<string, Record<string, unknown>>;
  readonly bindings: readonly HapCharacteristicBinding[];
}

export { Characteristics, Services };

export function normalizeHapUuid(uuid: string): string {
  const upper = uuid.trim().toUpperCase();
  const match = upper.match(/^0*([0-9A-F]+)(?:-0000-1000-8000-0026BB765291)?$/);
  return match ? match[1] : upper;
}

function findChar(service: RawHapService, shortUuid: string): RawHapCharacteristic | undefined {
  return service.characteristics.find((c) => normalizeHapUuid(c.type) === shortUuid);
}

function readStringChar(service: RawHapService, shortUuid: string): string | undefined {
  const val = findChar(service, shortUuid)?.value;
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined;
}

export function applyHapCharacteristicValue(
  charType: string,
  capabilityId: string,
  rawValue: unknown,
): Record<string, unknown> {
  switch (charType) {
    case '25': {
      const on = rawValue === true || rawValue === 1 || rawValue === '1';
      return { state: on ? 'on' : 'off', on_off: on, power: on };
    }
    case '6A': {
      // ContactSensorState: 0 = CONTACT_DETECTED (closed), 1 = CONTACT_NOT_DETECTED (open)
      const open = Number(rawValue) === 1 || rawValue === true;
      return { state: open ? 'open' : 'closed', contact: !open };
    }
    case '70': {
      // LeakDetected: 0 = LEAK_NOT_DETECTED (dry), 1 = LEAK_DETECTED (wet)
      const wet = Number(rawValue) === 1 || rawValue === true;
      return { state: wet ? 'wet' : 'dry', leak: wet };
    }
    case '22': {
      const detected = rawValue === true || Number(rawValue) === 1;
      return { state: detected ? 'detected' : 'clear', motion: detected };
    }
    case '71': {
      const occupied = Number(rawValue) === 1 || rawValue === true;
      return { state: occupied ? 'detected' : 'clear', occupancy: occupied };
    }
    case '1E':
    case '1D': {
      const locked = Number(rawValue) === 1;
      return { state: locked ? 'locked' : 'unlocked', lock: locked ? 'locked' : 'unlocked' };
    }
    case '11': {
      const temp = Number(rawValue);
      return Number.isFinite(temp) ? { temperature: temp, state: String(temp) } : {};
    }
    case '10': {
      const hum = Number(rawValue);
      return Number.isFinite(hum) ? { humidity: hum, state: String(hum) } : {};
    }
    case '68': {
      const bat = Number(rawValue);
      return Number.isFinite(bat) ? { battery: bat } : {};
    }
    case '8': {
      const br = Number(rawValue);
      return Number.isFinite(br) ? { brightness: br } : {};
    }
    case 'CE': {
      const ct = Number(rawValue);
      return Number.isFinite(ct) ? { color_temp: ct } : {};
    }
    default:
      return { [capabilityId]: rawValue };
  }
}

export function convertHapAccessoriesToHaus(
  bridgeAccessoryId: string,
  bridgeNameFallback: string,
  address: string,
  port: number,
  response: RawHapAccessoriesResponse,
): ConvertedHapTopology {
  const devices: HausDevice[] = [];
  const initialStates = new Map<string, Record<string, unknown>>();
  const bindings: HapCharacteristicBinding[] = [];
  const slugBase = bridgeAccessoryId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const bridgeDeviceId = `hk_${slugBase}_aid_1`;

  for (const acc of response.accessories ?? []) {
    const converted = convertSingleHapAccessory(
      bridgeAccessoryId,
      slugBase,
      bridgeDeviceId,
      bridgeNameFallback,
      address,
      port,
      acc,
      (response.accessories?.length ?? 0) > 1,
    );
    if (!converted) continue;
    devices.push(converted.device);
    for (const [epId, state] of converted.states) {
      initialStates.set(epId, state);
    }
    bindings.push(...converted.bindings);
  }

  // Disambiguate duplicate names among bridged child accessories when custom names aren't set
  const nameCounts = new Map<string, number>();
  for (const dev of devices) {
    nameCounts.set(dev.name, (nameCounts.get(dev.name) ?? 0) + 1);
  }
  const nameIndices = new Map<string, number>();
  const finalDevices = devices.map((dev) => {
    if ((nameCounts.get(dev.name) ?? 0) <= 1) return dev;
    const idx = (nameIndices.get(dev.name) ?? 0) + 1;
    nameIndices.set(dev.name, idx);
    const numberedName = `${dev.name} ${idx}`;
    return {
      ...dev,
      name: numberedName,
      endpoints: dev.endpoints.map((ep) => ({
        ...ep,
        name: ep.name === dev.name ? numberedName : ep.name,
      })),
    };
  });

  return { devices: finalDevices, initialStates, bindings };
}

function convertSingleHapAccessory(
  bridgeAccessoryId: string,
  slugBase: string,
  bridgeDeviceId: string,
  bridgeNameFallback: string,
  address: string,
  port: number,
  acc: RawHapAccessory,
  isMultiAccessoryBridge: boolean,
): {
  device: HausDevice;
  states: Map<string, Record<string, unknown>>;
  bindings: HapCharacteristicBinding[];
} | null {
  const infoService = acc.services.find((s) => normalizeHapUuid(s.type) === '3E');
  const manufacturer = (infoService && readStringChar(infoService, '20')) ?? 'HomeKit';
  const model = (infoService && readStringChar(infoService, '21')) ?? 'Accessory';
  const serial =
    (infoService && readStringChar(infoService, '30')) ?? `${bridgeAccessoryId}:${acc.aid}`;
  const firmware = infoService ? readStringChar(infoService, '52') : undefined;
  const infoName = infoService ? readStringChar(infoService, '23') : undefined;

  const deviceId = `hk_${slugBase}_aid_${acc.aid}`;
  const endpointId = `ep_${deviceId}`;
  const capabilities: Capability[] = [];
  const seenCaps = new Set<string>();
  const state: Record<string, unknown> = {};
  const bindings: HapCharacteristicBinding[] = [];

  let configuredServiceName: string | undefined;

  const addCap = (cap: Capability) => {
    if (!seenCaps.has(cap.id)) {
      seenCaps.add(cap.id);
      capabilities.push(cap);
    }
  };

  for (const svc of acc.services) {
    const svcType = normalizeHapUuid(svc.type);
    if (svcType === '3E' || svcType === 'A2' || svcType === '55') continue;

    // Prefer ConfiguredName (0xE3) over Name (0x23) on functional services
    const svcConfigured = readStringChar(svc, 'E3') ?? readStringChar(svc, '23');
    if (svcConfigured && (!configuredServiceName || svc.primary)) {
      configuredServiceName = svcConfigured;
    }

    for (const ch of svc.characteristics) {
      const chType = normalizeHapUuid(ch.type);
      const writable = ch.perms.includes('pw');
      const eventable = ch.perms.includes('ev');

      let capability: Capability | undefined;
      if (chType === '25') {
        capability = onOffCapability;
      } else if (chType === '8') {
        capability = brightnessCapability;
      } else if (chType === 'CE') {
        capability = createColorTempCapability();
      } else if (chType === '6A') {
        capability = contactCapability;
      } else if (chType === '70') {
        capability = leakCapability;
      } else if (chType === '22') {
        capability = motionCapability;
      } else if (chType === '71') {
        capability = occupancyCapability;
      } else if (chType === '1E' || chType === '1D') {
        capability = lockCapability;
      } else if (chType === '11') {
        capability = createTemperatureCapability();
      } else if (chType === '10') {
        capability = humidityCapability;
      } else if (chType === '68') {
        capability = batteryCapability;
      }

      if (!capability) continue;
      addCap(capability);

      if (ch.value !== undefined && ch.value !== null) {
        Object.assign(state, applyHapCharacteristicValue(chType, capability.id, ch.value));
      }

      bindings.push({
        accessoryId: bridgeAccessoryId,
        aid: acc.aid,
        iid: ch.iid,
        deviceId,
        endpointId,
        capabilityId: capability.id,
        charType: chType,
        writable,
        eventable,
      });
    }
  }

  const displayName =
    acc.aid === 1 && isMultiAccessoryBridge
      ? bridgeNameFallback || infoName || configuredServiceName || 'HomeKit Bridge'
      : (configuredServiceName ??
        infoName ??
        (acc.aid === 1 ? bridgeNameFallback : `${model} ${acc.aid}`));

  const candidateLabels = [displayName, infoName].filter((s): s is string => Boolean(s));
  const roomId = inferRoomIdFromLabels({ candidateLabels });

  if (acc.aid === 1 && capabilities.length === 0 && isMultiAccessoryBridge) {
    const bridgeDevice: HausDevice = {
      id: deviceId,
      source: { instanceId: 'haus-homekit', externalId: serial },
      name: displayName,
      category: 'network',
      roomId,
      availability: 'online',
      connectivity: { protocol: 'homekit', address: `${address}:${port}` },
      manufacturer,
      model,
      firmwareVersion: firmware,
      sourceRefs: [{ protocol: 'hap-ip', externalId: serial, aid: acc.aid }],
      endpoints: [],
    };
    return { device: bridgeDevice, states: new Map(), bindings: [] };
  }

  if (capabilities.length === 0) {
    return null;
  }

  const endpoint: HausEndpoint = {
    id: endpointId,
    name: displayName,
    capabilities,
    readings: {},
  };

  const category = inferDeviceCategory({
    id: deviceId,
    name: displayName,
    model,
    endpoints: [endpoint],
  });

  const device: HausDevice = {
    id: deviceId,
    source: { instanceId: 'haus-homekit', externalId: serial },
    name: displayName,
    category,
    roomId,
    availability: 'online',
    connectivity: { protocol: 'homekit', address: `${address}:${port}` },
    manufacturer,
    model,
    firmwareVersion: firmware,
    sourceRefs: [{ protocol: 'hap-ip', externalId: serial, aid: acc.aid }],
    endpoints: [endpoint],
    ...(acc.aid > 1
      ? { relationships: [{ type: 'bridged', targetDeviceId: bridgeDeviceId }] }
      : {}),
  };

  const states = new Map<string, Record<string, unknown>>();
  states.set(endpointId, state);

  return { device, states, bindings };
}
