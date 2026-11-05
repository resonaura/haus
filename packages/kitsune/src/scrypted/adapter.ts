/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Capability, Json, Reading } from '@haus/core/types';
import {
  type HausDevice,
  type HausEndpoint,
  onOffCapability,
  motionCapability,
} from '@haus/core/device';
import type { DeviceRecord } from '../contracts.js';

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

export function kitsuneToHausDevice(record: DeviceRecord, pluginId: string): HausDevice {
  const deviceId = `kitsune:${pluginId}:${record.nativeId ?? record.id}`;
  const endpoints: HausEndpoint[] = [];

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

  if (record.interfaces.includes('OnOff') || record.interfaces.includes('Light')) {
    endpoints.push({
      id: 'power',
      address: `lighting::default:${deviceId}:power`,
      name: `${record.name} Power`,
      capabilities: [onOffCapability],
      readings: {
        on_off: makeReading(!!record.state.on),
      },
    });
  }

  return {
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
}

export interface ScryptedCommandTarget {
  call(method: string, args?: unknown[], deviceId?: string): Promise<unknown>;
}

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
  if (capabilityKind === 'audio_talkback') {
    const method = value ? 'startIntercom' : 'stopIntercom';
    return target.call(method, [], deviceId);
  }
  if (capabilityKind === 'camera') {
    return target.call('refresh', [], deviceId);
  }
  return target.call('putSetting', [capabilityKind, value as Json], deviceId);
}
