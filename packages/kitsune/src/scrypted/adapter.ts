/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Availability, Capability, Json, Reading } from '@haus/core/types';
import { formatAddress, slugifySegment } from '@haus/core/identity';
import {
  type HausDevice,
  type HausEndpoint,
  onOffCapability,
  brightnessCapability,
  lockCapability,
  coverCapability,
  createTemperatureCapability,
  motionCapability,
  contactCapability,
} from '@haus/core/device';
import type { DeviceRecord } from '../contracts.js';
import type { UnsupportedCapability } from '../engine.js';

function makeReading(value: Json): Reading {
  return {
    value,
    freshness: 'live',
    observedAt: new Date().toISOString(),
  };
}

function numberReading(value: Json | undefined): Reading | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? makeReading(value) : undefined;
}

function percentageReading(value: Json | undefined): Reading | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? makeReading(value)
    : undefined;
}

function lockReading(state: DeviceRecord['state']): Reading | undefined {
  if (state.lockState === 'Locked') return makeReading('locked');
  if (state.lockState === 'Unlocked') return makeReading('unlocked');
  if (typeof state.locked === 'boolean') return makeReading(state.locked ? 'locked' : 'unlocked');
  return undefined;
}

export const cameraCapability: Capability = {
  id: 'camera',
  kind: 'camera',
  readable: true,
  operations: ['refresh', 'stream'],
};

export const talkbackCapability: Capability = {
  id: 'audio_talkback',
  kind: 'audio_talkback',
  readable: true,
  operations: ['start_intercom', 'stop_intercom'],
};

export const SUPPORTED_SCRYPTED_INTERFACES = new Set<string>([
  'VideoCamera',
  'Camera',
  'MotionSensor',
  'Intercom',
  'OnOff',
  'Light',
  'Brightness',
  'Lock',
  'Entry',
  'Thermometer',
  'BinarySensor',
  'ContactSensor',
  'Settings',
  'DeviceProvider',
  'ScryptedDevice',
]);

export interface ScryptedInspectionResult {
  device: HausDevice;
  unsupportedCapabilities: Omit<UnsupportedCapability, 'reportedAt'>[];
}

export function inspectScryptedDevice(
  record: DeviceRecord,
  pluginId: string,
): ScryptedInspectionResult {
  const deviceId = `kitsune:${pluginId}:${record.nativeId ?? record.id}`;
  const devSlug = slugifySegment(deviceId);
  const endpoints: HausEndpoint[] = [];
  const unsupportedCapabilities: Omit<UnsupportedCapability, 'reportedAt'>[] = [];
  const online = record.state.online;
  const availability: Availability =
    typeof online === 'boolean' ? (online ? 'online' : 'offline') : 'unknown';

  for (const iface of record.interfaces) {
    if (!SUPPORTED_SCRYPTED_INTERFACES.has(iface)) {
      unsupportedCapabilities.push({
        runtime: 'scrypted',
        pluginId,
        deviceId,
        capability: iface,
        reason: 'unsupported_scrypted_interface',
      });
    }
  }

  if (record.interfaces.includes('VideoCamera') || record.interfaces.includes('Camera')) {
    endpoints.push({
      id: 'camera',
      availability,
      address: formatAddress({
        type: 'security',
        area: 'default',
        device: devSlug,
        entity: 'camera',
      }),
      name: `${record.name} Video`,
      capabilities: [cameraCapability],
      readings:
        typeof online === 'boolean'
          ? { camera_status: makeReading(online ? 'online' : 'offline') }
          : {},
    });
  }

  if (record.interfaces.includes('MotionSensor')) {
    const motion = record.state.motionDetected;
    endpoints.push({
      id: 'motion',
      availability,
      address: formatAddress({
        type: 'occupancy-sensors',
        area: 'default',
        device: devSlug,
        entity: 'motion',
      }),
      name: `${record.name} Motion`,
      capabilities: [motionCapability],
      readings: typeof motion === 'boolean' ? { motion: makeReading(motion) } : {},
    });
  }

  if (record.interfaces.includes('BinarySensor') || record.interfaces.includes('ContactSensor')) {
    const contact =
      typeof record.state.binaryState === 'boolean'
        ? record.state.binaryState
        : record.state.contact;
    endpoints.push({
      id: 'contact',
      availability,
      address: formatAddress({
        type: 'security',
        area: 'default',
        device: devSlug,
        entity: 'contact',
      }),
      name: `${record.name} Contact`,
      capabilities: [contactCapability],
      readings: typeof contact === 'boolean' ? { contact: makeReading(contact) } : {},
    });
  }

  if (record.interfaces.includes('Intercom')) {
    const intercomActive = record.state.intercomActive;
    endpoints.push({
      id: 'intercom',
      availability,
      address: formatAddress({
        type: 'security',
        area: 'default',
        device: devSlug,
        entity: 'intercom',
      }),
      name: `${record.name} Talkback`,
      capabilities: [talkbackCapability],
      readings:
        typeof intercomActive === 'boolean' ? { intercom_active: makeReading(intercomActive) } : {},
    });
  }

  if (
    record.interfaces.includes('OnOff') ||
    record.interfaces.includes('Light') ||
    record.interfaces.includes('Brightness')
  ) {
    const caps: Capability[] = [onOffCapability];
    const readings: Record<string, Reading> = {};
    if (typeof record.state.on === 'boolean') readings.on_off = makeReading(record.state.on);
    if (record.interfaces.includes('Brightness')) {
      caps.push(brightnessCapability);
      const brightness = percentageReading(record.state.brightness);
      if (brightness) readings.brightness = brightness;
    }
    endpoints.push({
      id: 'power',
      availability,
      address: formatAddress({
        type: 'lighting',
        area: 'default',
        device: devSlug,
        entity: 'power',
      }),
      name: `${record.name} Power`,
      capabilities: caps,
      readings,
    });
  }

  if (record.interfaces.includes('Lock')) {
    const lock = lockReading(record.state);
    endpoints.push({
      id: 'lock',
      availability,
      address: formatAddress({
        type: 'security',
        area: 'default',
        device: devSlug,
        entity: 'lock',
      }),
      name: `${record.name} Lock`,
      capabilities: [lockCapability],
      readings: lock ? { lock } : {},
    });
  }

  if (record.interfaces.includes('Entry')) {
    const open = record.state.entryOpen;
    endpoints.push({
      id: 'cover',
      availability,
      address: formatAddress({
        type: 'covers',
        area: 'default',
        device: devSlug,
        entity: 'cover',
      }),
      name: `${record.name} Entry`,
      capabilities: [coverCapability],
      readings: typeof open === 'boolean' ? { cover: makeReading(open ? 100 : 0) } : {},
    });
  }

  if (record.interfaces.includes('Thermometer')) {
    const temperature = numberReading(record.state.temperature);
    endpoints.push({
      id: 'temperature',
      availability,
      address: formatAddress({
        type: 'climate',
        area: 'default',
        device: devSlug,
        entity: 'temperature',
      }),
      name: `${record.name} Temperature`,
      capabilities: [createTemperatureCapability('temperature', ['set_temperature'])],
      readings: temperature ? { temperature } : {},
    });
  }

  const device: HausDevice = {
    id: deviceId,
    source: { instanceId: 'kitsune', externalId: deviceId },
    name: record.name,
    category: 'security',
    availability,
    connectivity: {
      protocol: 'virtual',
    },
    endpoints,
    customEntities: {},
  };

  return { device, unsupportedCapabilities };
}

export function kitsuneToHausDevice(record: DeviceRecord, pluginId: string): HausDevice {
  return inspectScryptedDevice(record, pluginId).device;
}

export interface ScryptedCommandTarget {
  call(method: string, args?: unknown[], deviceId?: string): Promise<unknown>;
}

const SUPPORTED_SCRYPTED_CAPABILITIES = new Set<string>([
  'on_off',
  'brightness',
  'lock',
  'cover',
  'temperature',
  'audio_talkback',
  'camera',
]);

export async function executeScryptedCommand(
  target: ScryptedCommandTarget,
  deviceId: string,
  capabilityKind: string,
  value: unknown,
): Promise<unknown> {
  if (capabilityKind === 'on_off') {
    const method = value ? 'turnOn' : 'turnOff';
    return target.call(method, [], deviceId);
  }
  if (capabilityKind === 'brightness') {
    return target.call('setBrightness', [Number(value)], deviceId);
  }
  if (capabilityKind === 'lock') {
    const method = value === 'locked' || value === true ? 'lock' : 'unlock';
    return target.call(method, [], deviceId);
  }
  if (capabilityKind === 'cover') {
    const isOpen = value === 'open' || value === true || (typeof value === 'number' && value > 0);
    return target.call(isOpen ? 'openEntry' : 'closeEntry', [], deviceId);
  }
  if (capabilityKind === 'temperature') {
    return target.call('setTemperature', [Number(value)], deviceId);
  }
  if (capabilityKind === 'audio_talkback') {
    const method = value ? 'startIntercom' : 'stopIntercom';
    return target.call(method, [], deviceId);
  }
  if (capabilityKind === 'camera') {
    return target.call('refresh', [], deviceId);
  }
  if (capabilityKind.startsWith('setting:')) {
    const settingKey = capabilityKind.slice('setting:'.length);
    return target.call('putSetting', [settingKey, value as Json], deviceId);
  }
  if (!SUPPORTED_SCRYPTED_CAPABILITIES.has(capabilityKind)) {
    throw new Error(`kitsune_unsupported_capability:${capabilityKind}`);
  }
  return target.call('putSetting', [capabilityKind, value as Json], deviceId);
}
