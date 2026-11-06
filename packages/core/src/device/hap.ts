/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/** Canonical base UUID for Apple HomeKit Accessory Protocol standard types. */
export const HAP_BASE_UUID = '00000000-0000-1000-8000-0026BB765291';

/** Haus-owned static namespace UUID for custom HomeKit characteristics (RFC 4122 v5 namespace). */
export const HAUS_HAP_NAMESPACE = '3b92f768-e4b7-4c12-822e-e47f7d1b33fa';

export function hapUuid(shortUuid: string): string {
  const padded = shortUuid.toUpperCase().padStart(8, '0');
  return `${padded}-0000-1000-8000-0026BB765291`;
}

/** Complete HAP Service Registry with exact UUIDs. */
export interface HapServiceDefinition {
  readonly name: string;
  readonly uuid: string;
  readonly deprecated?: boolean;
  readonly requiredCharacteristics?: readonly string[];
  readonly optionalCharacteristics?: readonly string[];
}

export const HAP_SERVICES: Record<string, HapServiceDefinition> = {
  AccessCode: { name: 'AccessCode', uuid: hapUuid('260') },
  AccessControl: { name: 'AccessControl', uuid: hapUuid('DA') },
  AccessoryInformation: { name: 'AccessoryInformation', uuid: hapUuid('3E') },
  AccessoryMetrics: { name: 'AccessoryMetrics', uuid: hapUuid('270') },
  AccessoryRuntimeInformation: { name: 'AccessoryRuntimeInformation', uuid: hapUuid('239') },
  AirPurifier: { name: 'AirPurifier', uuid: hapUuid('BB') },
  AirQualitySensor: { name: 'AirQualitySensor', uuid: hapUuid('8D') },
  AssetUpdate: { name: 'AssetUpdate', uuid: hapUuid('267') },
  Assistant: { name: 'Assistant', uuid: hapUuid('26A') },
  AudioStreamManagement: { name: 'AudioStreamManagement', uuid: hapUuid('127') },
  Battery: { name: 'Battery', uuid: hapUuid('96') },
  CameraOperatingMode: { name: 'CameraOperatingMode', uuid: hapUuid('21A') },
  CameraRecordingManagement: { name: 'CameraRecordingManagement', uuid: hapUuid('204') },
  CameraRTPStreamManagement: { name: 'CameraRTPStreamManagement', uuid: hapUuid('110') },
  CarbonDioxideSensor: { name: 'CarbonDioxideSensor', uuid: hapUuid('97') },
  CarbonMonoxideSensor: { name: 'CarbonMonoxideSensor', uuid: hapUuid('7F') },
  CloudRelay: { name: 'CloudRelay', uuid: hapUuid('5A'), deprecated: true },
  ContactSensor: { name: 'ContactSensor', uuid: hapUuid('80') },
  DataStreamTransportManagement: { name: 'DataStreamTransportManagement', uuid: hapUuid('129') },
  Diagnostics: { name: 'Diagnostics', uuid: hapUuid('237') },
  Door: { name: 'Door', uuid: hapUuid('81') },
  Doorbell: { name: 'Doorbell', uuid: hapUuid('121') },
  Fan: { name: 'Fan', uuid: hapUuid('40') },
  Fanv2: { name: 'Fanv2', uuid: hapUuid('B7') },
  Faucet: { name: 'Faucet', uuid: hapUuid('D7') },
  FilterMaintenance: { name: 'FilterMaintenance', uuid: hapUuid('BA') },
  FirmwareUpdate: { name: 'FirmwareUpdate', uuid: hapUuid('236') },
  GarageDoorOpener: { name: 'GarageDoorOpener', uuid: hapUuid('41') },
  HeaterCooler: { name: 'HeaterCooler', uuid: hapUuid('BC') },
  HumidifierDehumidifier: { name: 'HumidifierDehumidifier', uuid: hapUuid('BD') },
  HumiditySensor: { name: 'HumiditySensor', uuid: hapUuid('82') },
  InputSource: { name: 'InputSource', uuid: hapUuid('D9') },
  IrrigationSystem: { name: 'IrrigationSystem', uuid: hapUuid('CF') },
  LeakSensor: { name: 'LeakSensor', uuid: hapUuid('83') },
  Lightbulb: { name: 'Lightbulb', uuid: hapUuid('43') },
  LightSensor: { name: 'LightSensor', uuid: hapUuid('84') },
  LockManagement: { name: 'LockManagement', uuid: hapUuid('44') },
  LockMechanism: { name: 'LockMechanism', uuid: hapUuid('45') },
  Microphone: { name: 'Microphone', uuid: hapUuid('112') },
  MotionSensor: { name: 'MotionSensor', uuid: hapUuid('85') },
  NFCAccess: { name: 'NFCAccess', uuid: hapUuid('266') },
  OccupancySensor: { name: 'OccupancySensor', uuid: hapUuid('86') },
  Outlet: { name: 'Outlet', uuid: hapUuid('47') },
  Pairing: { name: 'Pairing', uuid: hapUuid('55') },
  PowerManagement: { name: 'PowerManagement', uuid: hapUuid('221') },
  ProtocolInformation: { name: 'ProtocolInformation', uuid: hapUuid('A2') },
  SecuritySystem: { name: 'SecuritySystem', uuid: hapUuid('7E') },
  ServiceLabel: { name: 'ServiceLabel', uuid: hapUuid('CC') },
  Siri: { name: 'Siri', uuid: hapUuid('133') },
  SiriEndpoint: { name: 'SiriEndpoint', uuid: hapUuid('253') },
  Slats: { name: 'Slats', uuid: hapUuid('B9') },
  SmartSpeaker: { name: 'SmartSpeaker', uuid: hapUuid('228') },
  SmokeSensor: { name: 'SmokeSensor', uuid: hapUuid('87') },
  Speaker: { name: 'Speaker', uuid: hapUuid('113') },
  StatefulProgrammableSwitch: { name: 'StatefulProgrammableSwitch', uuid: hapUuid('88') },
  StatelessProgrammableSwitch: { name: 'StatelessProgrammableSwitch', uuid: hapUuid('89') },
  Switch: { name: 'Switch', uuid: hapUuid('49') },
  TapManagement: { name: 'TapManagement', uuid: hapUuid('22E'), deprecated: true },
  TargetControl: { name: 'TargetControl', uuid: hapUuid('125') },
  TargetControlManagement: { name: 'TargetControlManagement', uuid: hapUuid('122') },
  Television: { name: 'Television', uuid: hapUuid('D8') },
  TelevisionSpeaker: { name: 'TelevisionSpeaker', uuid: hapUuid('113') },
  TemperatureSensor: { name: 'TemperatureSensor', uuid: hapUuid('8A') },
  Thermostat: { name: 'Thermostat', uuid: hapUuid('4A') },
  ThreadTransport: { name: 'ThreadTransport', uuid: hapUuid('701') },
  TransferTransportManagement: { name: 'TransferTransportManagement', uuid: hapUuid('203') },
  Tunnel: { name: 'Tunnel', uuid: hapUuid('56'), deprecated: true },
  Valve: { name: 'Valve', uuid: hapUuid('D0') },
  WiFiRouter: { name: 'WiFiRouter', uuid: hapUuid('20A') },
  WiFiSatellite: { name: 'WiFiSatellite', uuid: hapUuid('20F') },
  WiFiTransport: { name: 'WiFiTransport', uuid: hapUuid('22A') },
  Window: { name: 'Window', uuid: hapUuid('8B') },
  WindowCovering: { name: 'WindowCovering', uuid: hapUuid('8C') },
};

/** Complete HAP Characteristic Registry definitions. */
export interface HapCharacteristicDefinition {
  readonly name: string;
  readonly uuid: string;
  readonly format: string;
  readonly unit?: string;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly minStep?: number;
  readonly permissions: readonly string[];
  readonly validValues?: readonly number[];
  readonly adminOnlyAccess?: boolean;
}

export { HAP_CHARACTERISTICS } from './characteristics/index.js';
