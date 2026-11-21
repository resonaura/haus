/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/**
 * Standard high-level device categories defining UI presentation, primary telemetry,
 * and interaction semantics across the Haus platform.
 */
export enum DeviceCategoryEnum {
  Lighting = 'lighting',
  Power = 'power',
  Climate = 'climate',
  Security = 'security',
  SafetySensors = 'safety_sensors',
  EnvironmentalSensors = 'environmental_sensors',
  OccupancySensors = 'occupancy_sensors',
  Covers = 'covers',
  Cameras = 'cameras',
  Media = 'media',
  Appliances = 'appliances',
  Network = 'network',
  Compute = 'compute',
  Storage = 'storage',
  Energy = 'energy',
  Generic = 'generic',
}

export const DeviceCategory = DeviceCategoryEnum;
export type DeviceCategory = DeviceCategoryEnum | `${DeviceCategoryEnum}`;

/** Array of all valid DeviceCategory values. */
export const DEVICE_CATEGORIES = Object.values(DeviceCategoryEnum) as readonly DeviceCategory[];

const categorySet: ReadonlySet<string> = new Set<string>(DEVICE_CATEGORIES);

/** Returns true if the value is a valid DeviceCategory. */
export function isDeviceCategory(value: unknown): value is DeviceCategory {
  return typeof value === 'string' && categorySet.has(value);
}

/** Validates that a category is a supported DeviceCategory or throws. */
export function assertDeviceCategory(value: unknown): asserts value is DeviceCategory {
  if (!isDeviceCategory(value)) {
    throw new Error(`invalid_device_category: expected one of ${DEVICE_CATEGORIES.join(', ')}`);
  }
}

/**
 * Canonical hardware archetype refining a coarse `DeviceCategory` across all Haus protocols
 * (HAP, Matter, Zigbee, MQTT, Home Assistant, Tuya, Homebridge).
 */
export enum DeviceTypeEnum {
  Light = 'light',
  LightStrip = 'light_strip',
  Outlet = 'outlet',
  PowerStrip = 'power_strip',
  Switch = 'switch',
  ButtonController = 'button_controller',
  Thermostat = 'thermostat',
  Fan = 'fan',
  AirPurifier = 'air_purifier',
  Humidifier = 'humidifier',
  Cover = 'cover',
  Lock = 'lock',
  SecuritySystem = 'security_system',
  Camera = 'camera',
  Doorbell = 'doorbell',
  Speaker = 'speaker',
  Television = 'television',
  Remote = 'remote',
  Kettle = 'kettle',
  Vacuum = 'vacuum',
  Scale = 'scale',
  Clock = 'clock',
  Printer = 'printer',
  Appliance = 'appliance',
  Sensor = 'sensor',
  Bridge = 'bridge',
  Router = 'router',
  NetworkSwitch = 'network_switch',
  Repeater = 'repeater',
  AccessPoint = 'access_point',
  Modem = 'modem',
  Firewall = 'firewall',
  Nas = 'nas',
  Service = 'service',
  Generic = 'generic',
}

export const DeviceType = DeviceTypeEnum;
export type DeviceType = DeviceTypeEnum | `${DeviceTypeEnum}`;

/** Array of all valid canonical DeviceType values. */
export const DEVICE_TYPES = Object.values(DeviceTypeEnum) as readonly DeviceType[];

const deviceTypeSet: ReadonlySet<string> = new Set<string>(DEVICE_TYPES);

/** Returns true if the value is a valid canonical DeviceType. */
export function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === 'string' && deviceTypeSet.has(value);
}
