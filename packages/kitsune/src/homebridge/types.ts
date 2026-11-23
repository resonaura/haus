/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Reading } from '@haus/core/types';
import type { HausDevice } from '@haus/core/device';
import { ServiceUUID } from './hap.js';

export interface HomebridgePairingCard {
  pluginName: string;
  pin: string;
  setupUri?: string;
  qrPayload?: string;
  timestamp: string;
}

export interface HomebridgePluginConfig {
  name: string;
  platform?: string;
  accessory?: string;
  [key: string]: unknown;
}

export interface HomebridgeApiEvents {
  deviceDiscovered: (device: HausDevice) => void;
  deviceStateChanged: (deviceId: string, readings: Record<string, Reading>) => void;
  pairingCardFound: (card: HomebridgePairingCard) => void;
}

export const SUPPORTED_HAP_SERVICE_NAMES = new Set<string>([
  'AccessoryInformation',
  'Lightbulb',
  'Switch',
  'Outlet',
  'Thermostat',
  'HeaterCooler',
  'HumidifierDehumidifier',
  'AirPurifier',
  'LockMechanism',
  'SecuritySystem',
  'MotionSensor',
  'ContactSensor',
  'OccupancySensor',
  'LeakSensor',
  'SmokeSensor',
  'CarbonMonoxideSensor',
  'CarbonDioxideSensor',
  'LightSensor',
  'TemperatureSensor',
  'HumiditySensor',
  'WindowCovering',
  'GarageDoorOpener',
  'Door',
  'Window',
  'Fan',
  'Fanv2',
  'Valve',
  'Faucet',
  'IrrigationSystem',
  'BatteryService',
  'Battery',
  'CameraRTPStreamManagement',
  'StatelessProgrammableSwitch',
  'Doorbell',
  'Television',
  'InputSource',
  'TelevisionSpeaker',
  'Speaker',
]);

export const SUPPORTED_HAP_SERVICE_UUIDS = new Set<string>([
  ServiceUUID.AccessoryInformation,
  ServiceUUID.Lightbulb,
  ServiceUUID.Switch,
  ServiceUUID.Outlet,
  ServiceUUID.Thermostat,
  '000000BC-0000-1000-8000-0026BB765291',
  '000000BD-0000-1000-8000-0026BB765291',
  ServiceUUID.AirPurifier,
  ServiceUUID.LockMechanism,
  ServiceUUID.SecuritySystem,
  ServiceUUID.MotionSensor,
  ServiceUUID.ContactSensor,
  ServiceUUID.OccupancySensor,
  ServiceUUID.LeakSensor,
  '00000087-0000-1000-8000-0026BB765291',
  '0000007F-0000-1000-8000-0026BB765291',
  '00000097-0000-1000-8000-0026BB765291',
  '00000084-0000-1000-8000-0026BB765291',
  ServiceUUID.TemperatureSensor,
  ServiceUUID.HumiditySensor,
  ServiceUUID.WindowCovering,
  ServiceUUID.GarageDoorOpener,
  '00000081-0000-1000-8000-0026BB765291',
  '0000008B-0000-1000-8000-0026BB765291',
  ServiceUUID.Fan,
  '000000B7-0000-1000-8000-0026BB765291',
  ServiceUUID.Valve,
  '000000D7-0000-1000-8000-0026BB765291',
  '000000CF-0000-1000-8000-0026BB765291',
  ServiceUUID.BatteryService,
  ServiceUUID.CameraRTPStream,
  ServiceUUID.StatelessSwitch,
  ServiceUUID.Doorbell,
  ServiceUUID.Television,
  ServiceUUID.InputSource,
  ServiceUUID.Speaker,
]);

export const HAP_POWER_SERVICES = new Set<string>([
  ServiceUUID.Switch,
  'Switch',
  ServiceUUID.Valve,
  'Valve',
  '000000D7-0000-1000-8000-0026BB765291',
  'Faucet',
  '000000CF-0000-1000-8000-0026BB765291',
  'IrrigationSystem',
]);
export const HAP_CLIMATE_ONOFF_SERVICES = new Set<string>([
  ServiceUUID.Fan,
  'Fan',
  '000000B7-0000-1000-8000-0026BB765291',
  'Fanv2',
  ServiceUUID.AirPurifier,
  'AirPurifier',
  '000000BC-0000-1000-8000-0026BB765291',
  'HeaterCooler',
  '000000BD-0000-1000-8000-0026BB765291',
  'HumidifierDehumidifier',
]);
export const HAP_COVER_SERVICES = new Set<string>([
  ServiceUUID.WindowCovering,
  'WindowCovering',
  ServiceUUID.GarageDoorOpener,
  'GarageDoorOpener',
  '00000081-0000-1000-8000-0026BB765291',
  'Door',
  '0000008B-0000-1000-8000-0026BB765291',
  'Window',
]);
export const HAP_SAFETY_SERVICES = new Set<string>([
  ServiceUUID.ContactSensor,
  'ContactSensor',
  ServiceUUID.LeakSensor,
  'LeakSensor',
  '00000087-0000-1000-8000-0026BB765291',
  'SmokeSensor',
  '0000007F-0000-1000-8000-0026BB765291',
  'CarbonMonoxideSensor',
  '00000097-0000-1000-8000-0026BB765291',
  'CarbonDioxideSensor',
]);
export const HAP_TEMP_SERVICES = new Set<string>([
  ServiceUUID.Thermostat,
  'Thermostat',
  ServiceUUID.TemperatureSensor,
  'TemperatureSensor',
  ServiceUUID.HumiditySensor,
  'HumiditySensor',
]);

export const SUPPORTED_HOMEBRIDGE_CAPABILITIES = new Set<string>([
  'on_off',
  'power',
  'brightness',
  'color_temp',
  'color_hsv',
  'color',
  'lock',
  'cover',
  'temperature',
  'motion',
  'contact',
  'camera',
  'remote_key',
  'remote',
  'media_playback',
  'source',
  'volume',
  'mute',
]);
