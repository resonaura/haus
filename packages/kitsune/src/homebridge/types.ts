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
  'LockMechanism',
  'SecuritySystem',
  'MotionSensor',
  'ContactSensor',
  'OccupancySensor',
  'TemperatureSensor',
  'HumiditySensor',
  'WindowCovering',
  'GarageDoorOpener',
  'Fan',
  'BatteryService',
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
  ServiceUUID.LockMechanism,
  ServiceUUID.SecuritySystem,
  ServiceUUID.MotionSensor,
  ServiceUUID.ContactSensor,
  ServiceUUID.OccupancySensor,
  ServiceUUID.TemperatureSensor,
  ServiceUUID.HumiditySensor,
  ServiceUUID.WindowCovering,
  ServiceUUID.GarageDoorOpener,
  ServiceUUID.Fan,
  ServiceUUID.BatteryService,
  ServiceUUID.CameraRTPStream,
  ServiceUUID.StatelessSwitch,
  ServiceUUID.Doorbell,
  ServiceUUID.Television,
  ServiceUUID.InputSource,
  ServiceUUID.Speaker,
]);

export const SUPPORTED_HOMEBRIDGE_CAPABILITIES = new Set<string>([
  'on_off',
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
