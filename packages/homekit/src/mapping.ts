/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Capability, HausDevice } from '@haus/core';

export type HapServiceType =
  | 'Lightbulb'
  | 'Switch'
  | 'Outlet'
  | 'WindowCovering'
  | 'Thermostat'
  | 'MotionSensor'
  | 'ContactSensor'
  | 'TemperatureSensor'
  | 'HumiditySensor'
  | 'LockMechanism'
  | 'CameraRTPStreamManagement'
  | 'Unknown';

export interface HapCharacteristicMapping {
  readonly characteristicName: string;
  readonly characteristicUuid: string;
  readonly format: 'bool' | 'int' | 'float' | 'string';
  readonly capabilityId: string;
  readonly capabilityKind: string;
  readonly permissions: readonly ('read' | 'write' | 'notify')[];
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly minStep?: number;
  readonly unit?: string;
}

export interface UnsupportedCapabilityMapping {
  readonly capabilityId: string;
  readonly capabilityKind: string;
  readonly name?: string;
  readonly reason: string;
}

export interface DeviceHapMapping {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly serviceType: HapServiceType;
  readonly serviceUuid: string;
  readonly characteristics: readonly HapCharacteristicMapping[];
  readonly unsupportedCapabilities: readonly UnsupportedCapabilityMapping[];
  readonly isFullySupported: boolean;
}

// Canonical HAP UUIDs for standard Services & Characteristics
export const HAP_SERVICE_UUIDS: Readonly<Record<HapServiceType, string>> = {
  Lightbulb: '00000043-0000-1000-8000-0026BB765291',
  Switch: '00000049-0000-1000-8000-0026BB765291',
  Outlet: '00000047-0000-1000-8000-0026BB765291',
  WindowCovering: '0000008C-0000-1000-8000-0026BB765291',
  Thermostat: '0000004A-0000-1000-8000-0026BB765291',
  MotionSensor: '00000085-0000-1000-8000-0026BB765291',
  ContactSensor: '00000080-0000-1000-8000-0026BB765291',
  TemperatureSensor: '0000008A-0000-1000-8000-0026BB765291',
  HumiditySensor: '00000082-0000-1000-8000-0026BB765291',
  LockMechanism: '00000045-0000-1000-8000-0026BB765291',
  CameraRTPStreamManagement: '00000110-0000-1000-8000-0026BB765291',
  Unknown: '00000000-0000-1000-8000-0026BB765291',
};

export const HAP_CHARACTERISTIC_UUIDS = {
  On: '00000025-0000-1000-8000-0026BB765291',
  Brightness: '00000008-0000-1000-8000-0026BB765291',
  Hue: '00000013-0000-1000-8000-0026BB765291',
  Saturation: '0000002F-0000-1000-8000-0026BB765291',
  ColorTemperature: '000000CE-0000-1000-8000-0026BB765291',
  CurrentTemperature: '00000011-0000-1000-8000-0026BB765291',
  TargetTemperature: '00000035-0000-1000-8000-0026BB765291',
  CurrentHeatingCoolingState: '0000000F-0000-1000-8000-0026BB765291',
  TargetHeatingCoolingState: '00000033-0000-1000-8000-0026BB765291',
  CurrentPosition: '0000006D-0000-1000-8000-0026BB765291',
  TargetPosition: '0000007C-0000-1000-8000-0026BB765291',
  PositionState: '000000AA-0000-1000-8000-0026BB765291',
  MotionDetected: '00000022-0000-1000-8000-0026BB765291',
  ContactSensorState: '0000006A-0000-1000-8000-0026BB765291',
  CurrentRelativeHumidity: '00000010-0000-1000-8000-0026BB765291',
  LockCurrentState: '0000001D-0000-1000-8000-0026BB765291',
  LockTargetState: '0000001E-0000-1000-8000-0026BB765291',
  OutletInUse: '00000026-0000-1000-8000-0026BB765291',
  StatusActive: '00000075-0000-1000-8000-0026BB765291',
} as const;

/**
 * Standard capability identifiers known to map directly to Apple HomeKit characteristics.
 */
const KNOWN_CAPABILITY_KINDS = new Set([
  'on_off',
  'brightness',
  'color_temp',
  'color_hsv',
  'temperature',
  'target_temperature',
  'humidity',
  'motion',
  'contact',
  'lock',
  'cover',
  'position',
  'camera',
  'video',
  'power',
]);

/**
 * Maps a HausDevice to its canonical Apple HomeKit Service and Characteristics,
 * while strictly surfacing any unsupported extensions rather than fabricating non-standard characteristics.
 */
export function mapDeviceToHap(device: HausDevice): DeviceHapMapping {
  const serviceType = resolveServiceType(device);
  const serviceUuid = HAP_SERVICE_UUIDS[serviceType];
  const characteristics: HapCharacteristicMapping[] = [];
  const unsupportedCapabilities: UnsupportedCapabilityMapping[] = [];

  const allCapabilities: Capability[] = [];
  for (const ep of device.endpoints) {
    allCapabilities.push(...ep.capabilities);
  }

  for (const cap of allCapabilities) {
    const kind = cap.kind.toLowerCase();
    const id = cap.id.toLowerCase();

    // Check if cap is diagnostic or unsupported extension
    if (cap.entityCategory === 'diagnostic') {
      unsupportedCapabilities.push({
        capabilityId: cap.id,
        capabilityKind: cap.kind,
        name: cap.name,
        reason: 'internal_diagnostic_not_in_hap_spec',
      });
      continue;
    }

    if (!KNOWN_CAPABILITY_KINDS.has(kind) && !KNOWN_CAPABILITY_KINDS.has(id)) {
      unsupportedCapabilities.push({
        capabilityId: cap.id,
        capabilityKind: cap.kind,
        name: cap.name,
        reason: 'no_standard_hap_characteristic_equivalent',
      });
      continue;
    }

    // Map known capabilities to characteristics
    if (kind === 'on_off' || id === 'on_off' || id === 'power') {
      characteristics.push({
        characteristicName: 'On',
        characteristicUuid: HAP_CHARACTERISTIC_UUIDS.On,
        format: 'bool',
        capabilityId: cap.id,
        capabilityKind: cap.kind,
        permissions: ['read', 'write', 'notify'],
      });
      if (serviceType === 'Outlet') {
        characteristics.push({
          characteristicName: 'OutletInUse',
          characteristicUuid: HAP_CHARACTERISTIC_UUIDS.OutletInUse,
          format: 'bool',
          capabilityId: cap.id,
          capabilityKind: cap.kind,
          permissions: ['read', 'notify'],
        });
      }
    } else if (kind === 'brightness' || id === 'brightness') {
      characteristics.push({
        characteristicName: 'Brightness',
        characteristicUuid: HAP_CHARACTERISTIC_UUIDS.Brightness,
        format: 'int',
        capabilityId: cap.id,
        capabilityKind: cap.kind,
        permissions: ['read', 'write', 'notify'],
        minValue: 0,
        maxValue: 100,
        minStep: 1,
        unit: 'percentage',
      });
    } else if (kind === 'color_temp' || id === 'color_temp') {
      characteristics.push({
        characteristicName: 'ColorTemperature',
        characteristicUuid: HAP_CHARACTERISTIC_UUIDS.ColorTemperature,
        format: 'int',
        capabilityId: cap.id,
        capabilityKind: cap.kind,
        permissions: ['read', 'write', 'notify'],
        minValue: 140,
        maxValue: 500,
        minStep: 1,
        unit: 'mired',
      });
    } else if (kind === 'color_hsv' || id === 'color_hsv') {
      characteristics.push(
        {
          characteristicName: 'Hue',
          characteristicUuid: HAP_CHARACTERISTIC_UUIDS.Hue,
          format: 'float',
          capabilityId: cap.id,
          capabilityKind: cap.kind,
          permissions: ['read', 'write', 'notify'],
          minValue: 0,
          maxValue: 360,
          unit: 'arcdegrees',
        },
        {
          characteristicName: 'Saturation',
          characteristicUuid: HAP_CHARACTERISTIC_UUIDS.Saturation,
          format: 'float',
          capabilityId: cap.id,
          capabilityKind: cap.kind,
          permissions: ['read', 'write', 'notify'],
          minValue: 0,
          maxValue: 100,
          unit: 'percentage',
        },
      );
    } else if (kind === 'temperature' || id === 'temperature') {
      characteristics.push({
        characteristicName: 'CurrentTemperature',
        characteristicUuid: HAP_CHARACTERISTIC_UUIDS.CurrentTemperature,
        format: 'float',
        capabilityId: cap.id,
        capabilityKind: cap.kind,
        permissions: ['read', 'notify'],
        minValue: -40,
        maxValue: 100,
        minStep: 0.1,
        unit: 'celsius',
      });
    } else if (kind === 'target_temperature' || id === 'target_temperature') {
      characteristics.push({
        characteristicName: 'TargetTemperature',
        characteristicUuid: HAP_CHARACTERISTIC_UUIDS.TargetTemperature,
        format: 'float',
        capabilityId: cap.id,
        capabilityKind: cap.kind,
        permissions: ['read', 'write', 'notify'],
        minValue: 10,
        maxValue: 38,
        minStep: 0.5,
        unit: 'celsius',
      });
    } else if (kind === 'humidity' || id === 'humidity') {
      characteristics.push({
        characteristicName: 'CurrentRelativeHumidity',
        characteristicUuid: HAP_CHARACTERISTIC_UUIDS.CurrentRelativeHumidity,
        format: 'float',
        capabilityId: cap.id,
        capabilityKind: cap.kind,
        permissions: ['read', 'notify'],
        minValue: 0,
        maxValue: 100,
        unit: 'percentage',
      });
    } else if (kind === 'motion' || id === 'motion') {
      characteristics.push({
        characteristicName: 'MotionDetected',
        characteristicUuid: HAP_CHARACTERISTIC_UUIDS.MotionDetected,
        format: 'bool',
        capabilityId: cap.id,
        capabilityKind: cap.kind,
        permissions: ['read', 'notify'],
      });
    } else if (kind === 'contact' || id === 'contact') {
      characteristics.push({
        characteristicName: 'ContactSensorState',
        characteristicUuid: HAP_CHARACTERISTIC_UUIDS.ContactSensorState,
        format: 'int',
        capabilityId: cap.id,
        capabilityKind: cap.kind,
        permissions: ['read', 'notify'],
        minValue: 0,
        maxValue: 1,
      });
    } else if (kind === 'lock' || id === 'lock') {
      characteristics.push(
        {
          characteristicName: 'LockCurrentState',
          characteristicUuid: HAP_CHARACTERISTIC_UUIDS.LockCurrentState,
          format: 'int',
          capabilityId: cap.id,
          capabilityKind: cap.kind,
          permissions: ['read', 'notify'],
          minValue: 0,
          maxValue: 3,
        },
        {
          characteristicName: 'LockTargetState',
          characteristicUuid: HAP_CHARACTERISTIC_UUIDS.LockTargetState,
          format: 'int',
          capabilityId: cap.id,
          capabilityKind: cap.kind,
          permissions: ['read', 'write', 'notify'],
          minValue: 0,
          maxValue: 1,
        },
      );
    } else if (kind === 'cover' || kind === 'position' || id === 'position') {
      characteristics.push(
        {
          characteristicName: 'CurrentPosition',
          characteristicUuid: HAP_CHARACTERISTIC_UUIDS.CurrentPosition,
          format: 'int',
          capabilityId: cap.id,
          capabilityKind: cap.kind,
          permissions: ['read', 'notify'],
          minValue: 0,
          maxValue: 100,
          unit: 'percentage',
        },
        {
          characteristicName: 'TargetPosition',
          characteristicUuid: HAP_CHARACTERISTIC_UUIDS.TargetPosition,
          format: 'int',
          capabilityId: cap.id,
          capabilityKind: cap.kind,
          permissions: ['read', 'write', 'notify'],
          minValue: 0,
          maxValue: 100,
          unit: 'percentage',
        },
        {
          characteristicName: 'PositionState',
          characteristicUuid: HAP_CHARACTERISTIC_UUIDS.PositionState,
          format: 'int',
          capabilityId: cap.id,
          capabilityKind: cap.kind,
          permissions: ['read', 'notify'],
          minValue: 0,
          maxValue: 2,
        },
      );
    }
  }

  return {
    deviceId: device.id,
    deviceName: device.name,
    serviceType,
    serviceUuid,
    characteristics,
    unsupportedCapabilities,
    isFullySupported: unsupportedCapabilities.length === 0,
  };
}

function resolveServiceType(device: HausDevice): HapServiceType {
  const cat = device.category?.toLowerCase();
  const name = device.name.toLowerCase();

  if (cat === 'lighting') return 'Lightbulb';
  if (cat === 'power') {
    if (name.includes('outlet') || name.includes('plug') || name.includes('socket')) {
      return 'Outlet';
    }
    return 'Switch';
  }
  if (cat === 'covers') return 'WindowCovering';
  if (cat === 'climate') return 'Thermostat';
  if (cat === 'occupancy_sensors') return 'MotionSensor';
  if (cat === 'safety_sensors') return 'ContactSensor';
  if (cat === 'environmental_sensors') {
    const hasHum = device.endpoints.some((ep) =>
      ep.capabilities.some((c) => c.kind === 'humidity' || c.id === 'humidity'),
    );
    const hasTemp = device.endpoints.some((ep) =>
      ep.capabilities.some((c) => c.kind === 'temperature' || c.id === 'temperature'),
    );
    if (hasHum && !hasTemp) return 'HumiditySensor';
    return 'TemperatureSensor';
  }
  if (cat === 'security') {
    const isCamera = device.endpoints.some((ep) =>
      ep.capabilities.some((c) => c.kind === 'camera' || c.kind === 'video'),
    );
    if (isCamera) return 'CameraRTPStreamManagement';
    return 'LockMechanism';
  }

  // Capability inspection fallback
  const allCaps = device.endpoints.flatMap((ep) => ep.capabilities);
  if (allCaps.some((c) => c.kind === 'brightness' || c.kind === 'color_temp')) {
    return 'Lightbulb';
  }
  if (allCaps.some((c) => c.kind === 'on_off')) {
    return 'Switch';
  }
  if (allCaps.some((c) => c.kind === 'motion')) {
    return 'MotionSensor';
  }
  if (allCaps.some((c) => c.kind === 'contact')) {
    return 'ContactSensor';
  }

  return 'Unknown';
}
