/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';

// ── Canonical Apple HAP UUID Enums ──────────────────────────────────────

/** Apple HomeKit Accessory Protocol — Service type UUIDs. */
export enum ServiceUUID {
  AccessoryInformation = '0000003E-0000-1000-8000-0026BB765291',
  Lightbulb = '00000043-0000-1000-8000-0026BB765291',
  Switch = '00000049-0000-1000-8000-0026BB765291',
  Outlet = '00000047-0000-1000-8000-0026BB765291',
  Fan = '00000040-0000-1000-8000-0026BB765291',
  GarageDoorOpener = '00000041-0000-1000-8000-0026BB765291',
  LockMechanism = '00000045-0000-1000-8000-0026BB765291',
  Thermostat = '0000004A-0000-1000-8000-0026BB765291',
  SecuritySystem = '0000007E-0000-1000-8000-0026BB765291',
  CarbonMonoxideSensor = '0000007F-0000-1000-8000-0026BB765291',
  ContactSensor = '00000080-0000-1000-8000-0026BB765291',
  Door = '00000081-0000-1000-8000-0026BB765291',
  HumiditySensor = '00000082-0000-1000-8000-0026BB765291',
  LeakSensor = '00000083-0000-1000-8000-0026BB765291',
  LightSensor = '00000084-0000-1000-8000-0026BB765291',
  MotionSensor = '00000085-0000-1000-8000-0026BB765291',
  OccupancySensor = '00000086-0000-1000-8000-0026BB765291',
  SmokeSensor = '00000087-0000-1000-8000-0026BB765291',
  TemperatureSensor = '0000008A-0000-1000-8000-0026BB765291',
  Window = '0000008B-0000-1000-8000-0026BB765291',
  WindowCovering = '0000008C-0000-1000-8000-0026BB765291',
  BatteryService = '00000096-0000-1000-8000-0026BB765291',
  CameraRTPStream = '00000110-0000-1000-8000-0026BB765291',
  Doorbell = '00000121-0000-1000-8000-0026BB765291',
  StatelessSwitch = '00000089-0000-1000-8000-0026BB765291',
  Speaker = '00000113-0000-1000-8000-0026BB765291',
  Microphone = '00000112-0000-1000-8000-0026BB765291',
  InputSource = '000000D9-0000-1000-8000-0026BB765291',
  Television = '000000D8-0000-1000-8000-0026BB765291',
  Valve = '000000D0-0000-1000-8000-0026BB765291',
  IrrigationSystem = '000000CF-0000-1000-8000-0026BB765291',
  AirPurifier = '000000BB-0000-1000-8000-0026BB765291',
  FilterMaintenance = '000000BA-0000-1000-8000-0026BB765291',
  AirQualitySensor = '0000008D-0000-1000-8000-0026BB765291',
}

/** Apple HomeKit Accessory Protocol — Characteristic type UUIDs. */
export enum CharacteristicUUID {
  On = '00000025-0000-1000-8000-0026BB765291',
  Brightness = '00000008-0000-1000-8000-0026BB765291',
  Hue = '00000013-0000-1000-8000-0026BB765291',
  Saturation = '0000002F-0000-1000-8000-0026BB765291',
  ColorTemperature = '000000CE-0000-1000-8000-0026BB765291',
  CurrentTemperature = '00000011-0000-1000-8000-0026BB765291',
  TargetTemperature = '00000035-0000-1000-8000-0026BB765291',
  CurrentHeatingCooling = '0000000F-0000-1000-8000-0026BB765291',
  TargetHeatingCooling = '00000033-0000-1000-8000-0026BB765291',
  CurrentPosition = '0000006D-0000-1000-8000-0026BB765291',
  TargetPosition = '0000007C-0000-1000-8000-0026BB765291',
  PositionState = '00000072-0000-1000-8000-0026BB765291',
  MotionDetected = '00000022-0000-1000-8000-0026BB765291',
  ContactSensorState = '0000006A-0000-1000-8000-0026BB765291',
  OccupancyDetected = '00000071-0000-1000-8000-0026BB765291',
  LockCurrentState = '0000001D-0000-1000-8000-0026BB765291',
  LockTargetState = '0000001E-0000-1000-8000-0026BB765291',
  BatteryLevel = '00000068-0000-1000-8000-0026BB765291',
  StatusLowBattery = '00000079-0000-1000-8000-0026BB765291',
  ChargingState = '0000008F-0000-1000-8000-0026BB765291',
  Active = '000000B0-0000-1000-8000-0026BB765291',
  ActiveIdentifier = '000000E7-0000-1000-8000-0026BB765291',
  RemoteKey = '000000E1-0000-1000-8000-0026BB765291',
  VolumeSelector = '000000EA-0000-1000-8000-0026BB765291',
  ConfiguredName = '000000E3-0000-1000-8000-0026BB765291',
  SleepDiscoveryMode = '000000E8-0000-1000-8000-0026BB765291',
  CurrentMediaState = '000000E0-0000-1000-8000-0026BB765291',
  TargetMediaState = '00000137-0000-1000-8000-0026BB765291',
  Identifier = '000000E6-0000-1000-8000-0026BB765291',
  IsConfigured = '000000D6-0000-1000-8000-0026BB765291',
  InputSourceType = '000000DB-0000-1000-8000-0026BB765291',
  CurrentVisibilityState = '00000135-0000-1000-8000-0026BB765291',
  InUse = '000000D2-0000-1000-8000-0026BB765291',
  RotationSpeed = '00000029-0000-1000-8000-0026BB765291',
  CurrentDoorState = '0000000E-0000-1000-8000-0026BB765291',
  TargetDoorState = '00000032-0000-1000-8000-0026BB765291',
  ObstructionDetected = '00000024-0000-1000-8000-0026BB765291',
  SmokeDetected = '00000076-0000-1000-8000-0026BB765291',
  CarbonMonoxideDetected = '00000069-0000-1000-8000-0026BB765291',
  LeakDetected = '00000070-0000-1000-8000-0026BB765291',
  CurrentAmbientLight = '0000006B-0000-1000-8000-0026BB765291',
  CurrentRelativeHumidity = '00000010-0000-1000-8000-0026BB765291',
  ProgrammableSwitchEvent = '00000073-0000-1000-8000-0026BB765291',
  ServiceLabelIndex = '000000CB-0000-1000-8000-0026BB765291',
  Volume = '00000119-0000-1000-8000-0026BB765291',
  Mute = '0000011A-0000-1000-8000-0026BB765291',
  Name = '00000023-0000-1000-8000-0026BB765291',
  SerialNumber = '00000030-0000-1000-8000-0026BB765291',
  Model = '00000021-0000-1000-8000-0026BB765291',
  Manufacturer = '00000020-0000-1000-8000-0026BB765291',
  FirmwareRevision = '00000052-0000-1000-8000-0026BB765291',
  Identify = '00000014-0000-1000-8000-0026BB765291',
}

/** Canonical HAP RemoteKey characteristic values. */
export enum RemoteKey {
  REWIND = 0,
  FAST_FORWARD = 1,
  NEXT_TRACK = 2,
  PREVIOUS_TRACK = 3,
  ARROW_UP = 4,
  ARROW_DOWN = 5,
  ARROW_LEFT = 6,
  ARROW_RIGHT = 7,
  SELECT = 8,
  BACK = 9,
  EXIT = 10,
  PLAY_PAUSE = 11,
  INFORMATION = 15,
}

/** Canonical HAP VolumeSelector characteristic values. */
export enum VolumeSelector {
  INCREMENT = 0,
  DECREMENT = 1,
}

/** Canonical HAP TargetMediaState characteristic values. */
export enum TargetMediaState {
  PLAY = 0,
  PAUSE = 1,
  STOP = 2,
}

/** Canonical HAP CurrentMediaState characteristic values. */
export enum CurrentMediaState {
  PLAY = 0,
  PAUSE = 1,
  STOP = 2,
  LOADING = 4,
  INTERRUPTED = 5,
}

/** Canonical HAP InputSourceType characteristic values. */
export enum InputSourceType {
  OTHER = 0,
  HOME_SCREEN = 1,
  TUNER = 2,
  HDMI = 3,
  COMPOSITE_VIDEO = 4,
  S_VIDEO = 5,
  COMPONENT_VIDEO = 6,
  DVI = 7,
  AIRPLAY = 8,
  USB = 9,
  APPLICATION = 10,
}

/** Canonical Apple HAP Base UUID namespace for Homebridge accessories. */
export const HAP_NAMESPACE = '00000000-0000-1000-8000-0026BB765291';

/**
 * Deterministically generates an RFC 4122 v5 UUID from a given string using the standard HAP namespace.
 * Standard implementation matching HAP-NodeJS / Homebridge `uuid.generate`.
 */
export function generateHapUuid(data: string): string {
  const hash = createHash('sha1');
  const nsBuffer = Buffer.from(HAP_NAMESPACE.replace(/-/g, ''), 'hex');
  hash.update(nsBuffer);
  hash.update(data, 'utf8');
  const buffer = hash.digest();

  // Set version to 5
  buffer[6] = (buffer[6] & 0x0f) | 0x50;
  // Set variant to RFC 4122
  buffer[8] = (buffer[8] & 0x3f) | 0x80;

  const hex = buffer.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`.toUpperCase();
}
