/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Capability, Json, Reading } from '@haus/core/types';
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
  const endpoints: HausEndpoint[] = [];
  const unsupportedCapabilities: Omit<UnsupportedCapability, 'reportedAt'>[] = [];

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
      address: `security::default:${deviceId}:camera`,
      name: `${record.name} Video`,
      capabilities: [cameraCapability],
      readings: {
        camera_status: makeReading(record.state.online === false ? 'offline' : 'streaming'),
      },
    });
  }

  if (record.interfaces.includes('MotionSensor')) {
    endpoints.push({
      id: 'motion',
      address: `occupancy_sensors::default:${deviceId}:motion`,
      name: `${record.name} Motion`,
      capabilities: [motionCapability],
      readings: {
        motion: makeReading(!!record.state.motionDetected),
      },
    });
  }

  if (record.interfaces.includes('BinarySensor') || record.interfaces.includes('ContactSensor')) {
    endpoints.push({
      id: 'contact',
      address: `security::default:${deviceId}:contact`,
      name: `${record.name} Contact`,
      capabilities: [contactCapability],
      readings: {
        contact: makeReading(Boolean(record.state.binaryState ?? record.state.contact)),
      },
    });
  }

  if (record.interfaces.includes('Intercom')) {
    endpoints.push({
      id: 'intercom',
      address: `security::default:${deviceId}:intercom`,
      name: `${record.name} Talkback`,
      capabilities: [talkbackCapability],
      readings: {
        intercom_active: makeReading(!!record.state.intercomActive),
      },
    });
  }

  if (
    record.interfaces.includes('OnOff') ||
    record.interfaces.includes('Light') ||
    record.interfaces.includes('Brightness')
  ) {
    const caps: Capability[] = [onOffCapability];
    const readings: Record<string, Reading> = {
      on_off: makeReading(!!record.state.on),
    };
    if (record.interfaces.includes('Brightness')) {
      caps.push(brightnessCapability);
      readings.brightness = makeReading(
        typeof record.state.brightness === 'number' ? record.state.brightness : 100,
      );
    }
    endpoints.push({
      id: 'power',
      address: `lighting::default:${deviceId}:power`,
      name: `${record.name} Power`,
      capabilities: caps,
      readings,
    });
  }

  if (record.interfaces.includes('Lock')) {
    const locked = record.state.lockState === 'Locked' || record.state.locked === true;
    endpoints.push({
      id: 'lock',
      address: `security::default:${deviceId}:lock`,
      name: `${record.name} Lock`,
      capabilities: [lockCapability],
      readings: {
        lock: makeReading(locked ? 'locked' : 'unlocked'),
      },
    });
  }

  if (record.interfaces.includes('Entry')) {
    const open = record.state.entryOpen === true;
    endpoints.push({
      id: 'cover',
      address: `covers::default:${deviceId}:cover`,
      name: `${record.name} Entry`,
      capabilities: [coverCapability],
      readings: {
        cover: makeReading(open ? 100 : 0),
      },
    });
  }

  if (record.interfaces.includes('Thermometer')) {
    const temp = typeof record.state.temperature === 'number' ? record.state.temperature : 20;
    endpoints.push({
      id: 'temperature',
      address: `climate::default:${deviceId}:temperature`,
      name: `${record.name} Temperature`,
      capabilities: [createTemperatureCapability('temperature', ['set_temperature'])],
      readings: {
        temperature: makeReading(temp),
      },
    });
  }

  const device: HausDevice = {
    id: deviceId,
    source: { instanceId: 'kitsune', externalId: deviceId },
    name: record.name,
    category: 'security',
    availability: record.state.online === false ? 'offline' : 'online',
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
