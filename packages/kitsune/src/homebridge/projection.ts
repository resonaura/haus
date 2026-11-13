/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Capability, Json, Reading } from '@haus/core/types';
import { formatAddress, slugifySegment } from '@haus/core/identity';
import {
  type HausDevice,
  type HausEndpoint,
  type DeviceCategory,
  onOffCapability,
  brightnessCapability,
  createColorTempCapability,
  colorHsvCapability,
  coverCapability,
  motionCapability,
  contactCapability,
  createTemperatureCapability,
  lockCapability,
  miredsToKelvin,
  normalizeHsv,
  hsToRgb,
} from '@haus/core/device';
import { MockAccessory, MockService, HAPServices, HAPCharacteristics, ServiceUUID } from './hap.js';
import { cameraCapability } from '../scrypted/adapter.js';
import type { UnsupportedCapability } from '../engine.js';
import { SUPPORTED_HAP_SERVICE_NAMES, SUPPORTED_HAP_SERVICE_UUIDS } from './types.js';
import {
  deriveAccessoryPrimaryCategory,
  extractAccessoryMetadata,
  replaceProjectionChangeListener,
} from './hap-metadata.js';

export { executeAccessoryCommand, parseHs, mapRemoteKeyNameToCode } from './actuation.js';

export function makeReading(value: Json): Reading {
  return {
    value,
    freshness: 'live',
    observedAt: new Date().toISOString(),
  };
}

export function isSupportedService(service: MockService): boolean {
  return (
    SUPPORTED_HAP_SERVICE_NAMES.has(service.displayName) ||
    SUPPORTED_HAP_SERVICE_UUIDS.has(service.UUID)
  );
}

export function mapServiceToCategory(service: MockService): DeviceCategory {
  const uuid = service.UUID;
  const name = service.displayName;
  if (uuid === HAPServices.Lightbulb.UUID || name === 'Lightbulb') return 'lighting';
  if (uuid === HAPServices.Switch.UUID || name === 'Switch') return 'power';
  if (uuid === HAPServices.Outlet.UUID || name === 'Outlet') return 'power';
  if (uuid === HAPServices.Fan.UUID || name === 'Fan') return 'climate';
  if (
    uuid === HAPServices.WindowCovering.UUID ||
    name === 'WindowCovering' ||
    uuid === HAPServices.GarageDoorOpener.UUID ||
    name === 'GarageDoorOpener'
  ) {
    return 'covers';
  }
  if (
    uuid === HAPServices.MotionSensor.UUID ||
    name === 'MotionSensor' ||
    uuid === HAPServices.OccupancySensor.UUID ||
    name === 'OccupancySensor'
  ) {
    return 'occupancy_sensors';
  }
  if (uuid === HAPServices.ContactSensor.UUID || name === 'ContactSensor') {
    return 'safety_sensors';
  }
  if (
    uuid === HAPServices.Thermostat.UUID ||
    name === 'Thermostat' ||
    uuid === HAPServices.TemperatureSensor.UUID ||
    name === 'TemperatureSensor' ||
    uuid === HAPServices.HumiditySensor.UUID ||
    name === 'HumiditySensor'
  ) {
    return 'climate';
  }
  if (
    uuid === HAPServices.LockMechanism.UUID ||
    name === 'LockMechanism' ||
    uuid === ServiceUUID.SecuritySystem ||
    name === 'SecuritySystem' ||
    uuid === ServiceUUID.CameraRTPStream ||
    name === 'CameraRTPStreamManagement'
  ) {
    return 'security';
  }
  if (
    uuid === HAPServices.Television.UUID ||
    name === 'Television' ||
    uuid === ServiceUUID.Speaker ||
    name === 'TelevisionSpeaker' ||
    name === 'Speaker'
  ) {
    return 'media';
  }
  return 'generic';
}

const COVER_CAPS = [coverCapability];
const MOTION_CAPS = [motionCapability];
const CONTACT_CAPS = [contactCapability];
const TEMP_CAPS = [createTemperatureCapability('temperature', ['set_temperature'])];
const LOCK_CAPS = [lockCapability];
const CAMERA_CAPS = [cameraCapability];
const TV_CAPS: Capability[] = [
  onOffCapability,
  { id: 'remote_key', kind: 'action', readable: false, operations: ['send_command', 'press'] },
  {
    id: 'media_playback',
    kind: 'action',
    readable: true,
    operations: ['play', 'pause', 'play_pause', 'stop'],
  },
  { id: 'source', kind: 'enum', readable: true, operations: ['select_source', 'set'] },
  {
    id: 'volume',
    kind: 'numeric',
    readable: true,
    operations: ['set_volume', 'volume_up', 'volume_down'],
    unit: '%',
    minimum: 0,
    maximum: 100,
    step: 1,
  },
  { id: 'mute', kind: 'binary', readable: true, operations: ['mute', 'unmute', 'toggle_mute'] },
];
const SPEAKER_CAPS: Capability[] = [
  {
    id: 'volume',
    kind: 'numeric',
    readable: true,
    operations: ['set_volume', 'volume_up', 'volume_down'],
    unit: '%',
    minimum: 0,
    maximum: 100,
    step: 1,
  },
  { id: 'mute', kind: 'binary', readable: true, operations: ['mute', 'unmute', 'toggle_mute'] },
];

export function mapServiceToCapabilities(service: MockService): Capability[] {
  const uuid = service.UUID;
  const name = service.displayName;
  if (uuid === HAPServices.Lightbulb.UUID || name === 'Lightbulb') {
    const caps: Capability[] = [onOffCapability];
    if (
      service.characteristics.has('Brightness') ||
      service.characteristics.has(HAPCharacteristics.Brightness.UUID)
    ) {
      caps.push(brightnessCapability);
    }
    if (
      service.characteristics.has('ColorTemperature') ||
      service.characteristics.has(HAPCharacteristics.ColorTemperature.UUID)
    ) {
      caps.push(createColorTempCapability(2000, 6500));
    }
    if (
      service.characteristics.has('Hue') ||
      service.characteristics.has(HAPCharacteristics.Hue.UUID) ||
      service.characteristics.has('Saturation') ||
      service.characteristics.has(HAPCharacteristics.Saturation.UUID)
    ) {
      caps.push(colorHsvCapability);
    }
    return caps;
  }
  if (uuid === HAPServices.Switch.UUID || name === 'Switch') return [onOffCapability];
  if (uuid === HAPServices.Outlet.UUID || name === 'Outlet') return [onOffCapability];
  if (uuid === HAPServices.Fan.UUID || name === 'Fan') return [onOffCapability];
  if (
    uuid === HAPServices.WindowCovering.UUID ||
    name === 'WindowCovering' ||
    uuid === HAPServices.GarageDoorOpener.UUID ||
    name === 'GarageDoorOpener'
  )
    return COVER_CAPS;
  if (
    uuid === HAPServices.MotionSensor.UUID ||
    name === 'MotionSensor' ||
    uuid === HAPServices.OccupancySensor.UUID ||
    name === 'OccupancySensor'
  )
    return MOTION_CAPS;
  if (uuid === HAPServices.ContactSensor.UUID || name === 'ContactSensor') return CONTACT_CAPS;
  if (
    uuid === HAPServices.Thermostat.UUID ||
    name === 'Thermostat' ||
    uuid === HAPServices.TemperatureSensor.UUID ||
    name === 'TemperatureSensor' ||
    uuid === HAPServices.HumiditySensor.UUID ||
    name === 'HumiditySensor'
  )
    return TEMP_CAPS;
  if (
    uuid === HAPServices.LockMechanism.UUID ||
    name === 'LockMechanism' ||
    uuid === ServiceUUID.SecuritySystem ||
    name === 'SecuritySystem'
  )
    return LOCK_CAPS;
  if (uuid === ServiceUUID.CameraRTPStream || name === 'CameraRTPStreamManagement')
    return CAMERA_CAPS;
  if (uuid === HAPServices.Television.UUID || name === 'Television') return TV_CAPS;
  if (uuid === HAPServices.Speaker.UUID || name === 'TelevisionSpeaker' || name === 'Speaker')
    return SPEAKER_CAPS;
  return [];
}

export function getReadingsFromService(service: MockService): Record<string, Reading> {
  const readings: Record<string, Reading> = {};
  const onChar =
    service.characteristics.get('On') ?? service.characteristics.get(HAPCharacteristics.On.UUID);
  if (onChar) readings.on_off = makeReading(!!onChar.getValue());

  const activeChar =
    service.characteristics.get('Active') ??
    service.characteristics.get(HAPCharacteristics.Active.UUID);
  if (activeChar) readings.on_off = makeReading(Number(activeChar.getValue()) === 1);

  const activeIdChar =
    service.characteristics.get('ActiveIdentifier') ??
    service.characteristics.get(HAPCharacteristics.ActiveIdentifier.UUID);
  if (activeIdChar) readings.active_identifier = makeReading(Number(activeIdChar.getValue()));

  const remoteChar =
    service.characteristics.get('RemoteKey') ??
    service.characteristics.get(HAPCharacteristics.RemoteKey.UUID);
  if (remoteChar) readings.remote = makeReading('on');

  const volChar =
    service.characteristics.get('Volume') ??
    service.characteristics.get(HAPCharacteristics.Volume.UUID);
  if (volChar) readings.volume = makeReading(Number(volChar.getValue()));

  const muteChar =
    service.characteristics.get('Mute') ??
    service.characteristics.get(HAPCharacteristics.Mute.UUID);
  if (muteChar) readings.mute = makeReading(Boolean(muteChar.getValue()));

  const briChar =
    service.characteristics.get('Brightness') ??
    service.characteristics.get(HAPCharacteristics.Brightness.UUID);
  if (briChar) readings.brightness = makeReading(Number(briChar.getValue()));

  const ctChar =
    service.characteristics.get('ColorTemperature') ??
    service.characteristics.get(HAPCharacteristics.ColorTemperature.UUID);
  if (ctChar) {
    const mireds = Number(ctChar.getValue());
    readings.color_temp = makeReading(miredsToKelvin(mireds));
    readings.color_temp_mireds = makeReading(mireds);
  }

  const hueChar =
    service.characteristics.get('Hue') ?? service.characteristics.get(HAPCharacteristics.Hue.UUID);
  const satChar =
    service.characteristics.get('Saturation') ??
    service.characteristics.get(HAPCharacteristics.Saturation.UUID);
  if (hueChar || satChar) {
    const hue = Number(hueChar?.getValue() ?? 0);
    const sat = Number(satChar?.getValue() ?? 0);
    const bri = Number(briChar?.getValue() ?? 100);
    readings.color_hsv = makeReading(normalizeHsv(hue, sat, bri));
    readings.color_rgb = makeReading(hsToRgb(hue, sat));
  }

  const motionChar =
    service.characteristics.get('MotionDetected') ??
    service.characteristics.get(HAPCharacteristics.MotionDetected.UUID) ??
    service.characteristics.get('OccupancyDetected') ??
    service.characteristics.get(HAPCharacteristics.OccupancyDetected.UUID);
  if (motionChar) readings.motion = makeReading(Boolean(motionChar.getValue()));

  const contactChar =
    service.characteristics.get('ContactSensorState') ??
    service.characteristics.get(HAPCharacteristics.ContactSensorState.UUID);
  if (contactChar) readings.contact = makeReading(contactChar.getValue() === 0);

  const tempChar =
    service.characteristics.get('CurrentTemperature') ??
    service.characteristics.get(HAPCharacteristics.CurrentTemperature.UUID) ??
    service.characteristics.get('CurrentRelativeHumidity') ??
    service.characteristics.get(HAPCharacteristics.CurrentRelativeHumidity.UUID);
  if (tempChar) readings.temperature = makeReading(Number(tempChar.getValue()));

  const lockChar =
    service.characteristics.get('LockCurrentState') ??
    service.characteristics.get(HAPCharacteristics.LockCurrentState.UUID);
  if (lockChar) readings.lock = makeReading(lockChar.getValue() === 1 ? 'locked' : 'unlocked');

  const posChar =
    service.characteristics.get('CurrentPosition') ??
    service.characteristics.get(HAPCharacteristics.CurrentPosition.UUID);
  if (posChar) readings.cover = makeReading(Number(posChar.getValue()));

  return readings;
}

export function projectAccessoryToHausDevice(
  pluginName: string,
  acc: MockAccessory,
  onCharacteristicChange?: (
    deviceId: string,
    endpointId: string,
    readings: Record<string, Reading>,
  ) => void,
): { device: HausDevice; unsupported: Omit<UnsupportedCapability, 'reportedAt'>[] } {
  const deviceId = `homebridge:${pluginName}:${acc.UUID}`;
  const endpoints: HausEndpoint[] = [];
  const unsupported: Omit<UnsupportedCapability, 'reportedAt'>[] = [];
  const projectedCategories: DeviceCategory[] = [];

  const hasTelevision = acc.services.some(
    (s) => s.displayName === 'Television' || s.UUID === HAPServices.Television.UUID,
  );

  const inputSources: { id: number; name: string }[] = [];
  let speakerReadings: Record<string, Reading> = {};

  if (hasTelevision) {
    for (let i = 0; i < acc.services.length; i++) {
      const s = acc.services[i];
      if (s.displayName === 'InputSource' || s.UUID === ServiceUUID.InputSource) {
        const nameChar =
          s.characteristics.get('ConfiguredName') ??
          s.characteristics.get(HAPCharacteristics.ConfiguredName.UUID) ??
          s.characteristics.get('Name');
        const idChar =
          s.characteristics.get('Identifier') ??
          s.characteristics.get(HAPCharacteristics.Identifier.UUID);
        const name = String(nameChar?.getValue() ?? `Input ${i}`);
        const id = idChar ? Number(idChar.getValue()) : i;
        inputSources.push({ id, name });
      } else if (
        s.displayName === 'TelevisionSpeaker' ||
        s.displayName === 'Speaker' ||
        s.UUID === ServiceUUID.Speaker
      ) {
        speakerReadings = { ...speakerReadings, ...getReadingsFromService(s) };
      }
    }
  }

  for (let i = 0; i < acc.services.length; i++) {
    const service = acc.services[i];
    if (
      service.displayName === 'AccessoryInformation' ||
      service.UUID === ServiceUUID.AccessoryInformation ||
      service.displayName === 'BatteryService' ||
      service.UUID === HAPServices.BatteryService.UUID
    ) {
      continue;
    }

    // InputSource and TelevisionSpeaker fold into the main Television endpoint
    if (
      hasTelevision &&
      (service.displayName === 'InputSource' ||
        service.UUID === ServiceUUID.InputSource ||
        service.displayName === 'TelevisionSpeaker' ||
        service.UUID === ServiceUUID.Speaker)
    ) {
      continue;
    }

    if (!isSupportedService(service)) {
      unsupported.push({
        runtime: 'homebridge',
        pluginId: pluginName,
        deviceId,
        capability: service.displayName || service.UUID,
        reason: 'unsupported_hap_service',
      });
      continue;
    }

    const category = mapServiceToCategory(service);
    const capabilities = mapServiceToCapabilities(service);
    if (capabilities.length === 0) continue;
    projectedCategories.push(category);

    const readings = getReadingsFromService(service);

    if (service.displayName === 'Television' || service.UUID === HAPServices.Television.UUID) {
      if (inputSources.length > 0) {
        readings.source_list = makeReading(inputSources.map((item) => item.name));
        const activeId = Number(readings.active_identifier?.value ?? 1);
        const currentSource = inputSources.find((item) => item.id === activeId);
        readings.source = makeReading(currentSource ? currentSource.name : String(activeId));
      }
      Object.assign(readings, speakerReadings);
    }

    const endpointId = `${service.displayName.toLowerCase()}_${i}`;

    endpoints.push({
      id: endpointId,
      address: formatAddress({
        type: slugifySegment(category),
        area: 'default',
        device: slugifySegment(deviceId),
        entity: slugifySegment(endpointId),
      }),
      name: service.displayName,
      capabilities,
      readings,
    });

    if (onCharacteristicChange) {
      const emitUpdate = () => {
        const updated = getReadingsFromService(service);
        if (service.displayName === 'Television' || service.UUID === HAPServices.Television.UUID) {
          if (inputSources.length > 0) {
            updated.source_list = makeReading(inputSources.map((item) => item.name));
            const activeId = Number(updated.active_identifier?.value ?? 1);
            const currentSource = inputSources.find((item) => item.id === activeId);
            updated.source = makeReading(currentSource ? currentSource.name : String(activeId));
          }
          let currentSpeakerReadings: Record<string, Reading> = {};
          for (const s of acc.services) {
            if (
              s.displayName === 'TelevisionSpeaker' ||
              s.displayName === 'Speaker' ||
              s.UUID === ServiceUUID.Speaker
            ) {
              currentSpeakerReadings = { ...currentSpeakerReadings, ...getReadingsFromService(s) };
            }
          }
          Object.assign(updated, currentSpeakerReadings);
        }
        onCharacteristicChange(deviceId, endpointId, updated);
      };

      for (const char of service.characteristics.values()) {
        replaceProjectionChangeListener(char, emitUpdate);
      }

      if (service.displayName === 'Television' || service.UUID === HAPServices.Television.UUID) {
        for (const s of acc.services) {
          if (
            s.displayName === 'TelevisionSpeaker' ||
            s.displayName === 'Speaker' ||
            s.displayName === 'InputSource' ||
            s.UUID === ServiceUUID.Speaker ||
            s.UUID === ServiceUUID.InputSource
          ) {
            for (const char of s.characteristics.values()) {
              replaceProjectionChangeListener(char, emitUpdate);
            }
          }
        }
      }
    }
  }

  const meta = extractAccessoryMetadata(acc);
  const primaryCategory = deriveAccessoryPrimaryCategory(acc, projectedCategories);

  const device: HausDevice = {
    id: deviceId,
    source: { instanceId: `homebridge:${pluginName}`, externalId: acc.UUID },
    name: acc.displayName,
    category: primaryCategory,
    ...(meta.manufacturer ? { manufacturer: meta.manufacturer } : {}),
    ...(meta.model ? { model: meta.model } : {}),
    ...(meta.serialNumber ? { serialNumber: meta.serialNumber } : {}),
    ...(meta.firmwareVersion ? { firmwareVersion: meta.firmwareVersion } : {}),
    roomId: 'default',
    availability: 'online',
    connectivity: { protocol: 'virtual' },
    sourceRefs: [{ protocol: 'virtual', externalId: acc.UUID }],
    endpoints,
  };

  return { device, unsupported };
}
