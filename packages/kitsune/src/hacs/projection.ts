/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Capability } from '@haus/core/types';
import {
  type DeviceCategory,
  CapabilityKind,
  onOffCapability,
  brightnessCapability,
  createColorTempCapability,
  colorHsvCapability,
  createTemperatureCapability,
  motionCapability,
  contactCapability,
  coverCapability,
  lockCapability,
  updateCapability,
} from '@haus/core/device';
import type { HacsEntityPayload } from './types.js';

export { makeReading, parseReadings } from './readings.js';

export const SUPPORTED_HACS_DOMAINS = new Set<string>([
  'light',
  'switch',
  'outlet',
  'climate',
  'cover',
  'lock',
  'binary_sensor',
  'sensor',
  'button',
  'scene',
  'event',
  'select',
  'update',
  'device_tracker',
  'image',
  'weather',
  'notify',
]);

export const SUPPORTED_HACS_CAPABILITIES = new Set<string>([
  'on_off',
  'brightness',
  'color_temp',
  'color_hsv',
  'lock',
  'cover',
  'temperature',
  'target_temperature',
  'current_temperature',
  'climate',
  'hvac_mode',
  'fan_mode',
  'swing_mode',
  'swing_horizontal_mode',
  'button',
  'press',
  'effect',
  'scene',
  'action',
  'event',
  'select',
  'select_option',
  'update',
  'install',
  'device_tracker',
  'presence',
  'weather',
  'notify',
  'send_message',
  'data_rate',
  'data_size',
  'duration',
  'wind_speed',
  'pressure',
]);

export function mapDomainToCategory(
  domain: string,
  attributes: Record<string, unknown> = {},
): DeviceCategory {
  switch (domain) {
    case 'light':
      return 'lighting';
    case 'switch':
    case 'outlet':
      return 'power';
    case 'climate':
      return 'climate';
    case 'cover':
      return 'covers';
    case 'lock':
      return 'security';
    case 'binary_sensor':
      if (attributes.device_class === 'problem') return 'safety_sensors';
      if (attributes.device_class === 'connectivity') return 'network';
      return 'occupancy_sensors';
    case 'sensor':
      if (
        attributes.device_class === 'data_rate' ||
        attributes.device_class === 'data_size' ||
        attributes.unit_of_measurement === 'MB/s' ||
        attributes.unit_of_measurement === 'Mbit/s' ||
        attributes.unit_of_measurement === 'GiB' ||
        attributes.mac_address ||
        attributes.subnet_mask
      ) {
        return 'network';
      }
      return 'environmental_sensors';
    case 'weather':
      return 'environmental_sensors';
    case 'notify':
      return 'generic';
    case 'device_tracker':
      return 'occupancy_sensors';
    case 'update':
      return 'network';
    case 'select':
    case 'image':
    case 'button':
    default:
      return 'generic';
  }
}

export function mapDomainToCapabilities(
  domain: string,
  payload?: Partial<HacsEntityPayload>,
): Capability[] {
  const attrs = payload?.attributes ?? {};
  switch (domain) {
    case 'light': {
      const minKelvin =
        typeof attrs.min_color_temp_kelvin === 'number' ? attrs.min_color_temp_kelvin : 2000;
      const maxKelvin =
        typeof attrs.max_color_temp_kelvin === 'number' ? attrs.max_color_temp_kelvin : 6535;
      const effectList = Array.isArray(attrs.effect_list)
        ? (attrs.effect_list as string[])
        : undefined;
      const caps: Capability[] = [
        onOffCapability,
        brightnessCapability,
        createColorTempCapability(minKelvin, maxKelvin),
        colorHsvCapability,
      ];
      if (effectList?.length) {
        caps.push({
          id: 'effect',
          kind: 'mode' as CapabilityKind,
          readable: true,
          operations: ['set_effect', 'set'],
          choices: effectList,
        });
      }
      return caps;
    }
    case 'switch':
    case 'outlet':
      return [onOffCapability];
    case 'climate': {
      const minTemp = typeof attrs.min_temp === 'number' ? attrs.min_temp : 10;
      const maxTemp = typeof attrs.max_temp === 'number' ? attrs.max_temp : 30;
      const step = typeof attrs.target_temp_step === 'number' ? attrs.target_temp_step : 1;
      const hvacModes = Array.isArray(attrs.hvac_modes)
        ? (attrs.hvac_modes as string[])
        : ['cool', 'heat', 'fan_only', 'dry', 'heat_cool', 'off'];
      const fanModes = Array.isArray(attrs.fan_modes) ? (attrs.fan_modes as string[]) : undefined;
      const swingModes = Array.isArray(attrs.swing_modes)
        ? (attrs.swing_modes as string[])
        : undefined;
      const swingHorizModes = Array.isArray(attrs.swing_horizontal_modes)
        ? (attrs.swing_horizontal_modes as string[])
        : undefined;

      const caps: Capability[] = [
        {
          id: 'climate',
          kind: 'climate' as CapabilityKind,
          readable: true,
          operations: [
            'set_temperature',
            'set_hvac_mode',
            'set_fan_mode',
            'set_swing_mode',
            'set_swing_horizontal_mode',
            'turn_on',
            'turn_off',
          ],
          choices: hvacModes,
          minimum: minTemp,
          maximum: maxTemp,
          step,
        },
        {
          id: 'target_temperature',
          kind: CapabilityKind.Temperature,
          readable: true,
          operations: ['set_temperature', 'set'],
          unit: '°C',
          minimum: minTemp,
          maximum: maxTemp,
          step,
        },
        createTemperatureCapability('current_temperature', []),
        onOffCapability,
      ];

      if (fanModes?.length) {
        caps.push({
          id: 'fan_mode',
          kind: 'mode' as CapabilityKind,
          readable: true,
          operations: ['set_fan_mode', 'set'],
          choices: fanModes,
        });
      }
      if (swingModes?.length) {
        caps.push({
          id: 'swing_mode',
          kind: 'mode' as CapabilityKind,
          readable: true,
          operations: ['set_swing_mode', 'set'],
          choices: swingModes,
        });
      }
      if (swingHorizModes?.length) {
        caps.push({
          id: 'swing_horizontal_mode',
          kind: 'mode' as CapabilityKind,
          readable: true,
          operations: ['set_swing_horizontal_mode', 'set'],
          choices: swingHorizModes,
        });
      }
      return caps;
    }
    case 'cover':
      return [coverCapability];
    case 'lock':
      return [lockCapability];
    case 'binary_sensor':
      if (attrs.device_class === 'problem') {
        return [{ id: 'problem', kind: CapabilityKind.Contact, readable: true, operations: [] }];
      }
      if (['door', 'window', 'opening'].includes(String(attrs.device_class ?? ''))) {
        return [contactCapability];
      }
      return [motionCapability];
    case 'sensor':
      if (attrs.device_class === 'carbon_dioxide' || attrs.unit_of_measurement === 'ppm') {
        return [
          {
            id: 'co2',
            kind: CapabilityKind.Temperature,
            readable: true,
            operations: [],
            unit: 'ppm',
          },
        ];
      }
      if (
        attrs.unit_of_measurement === 'ppb' ||
        String(attrs.friendly_name ?? '')
          .toLowerCase()
          .includes('tvoc')
      ) {
        return [
          {
            id: 'tvoc',
            kind: CapabilityKind.Temperature,
            readable: true,
            operations: [],
            unit: 'ppb',
          },
        ];
      }
      if (attrs.device_class === 'timestamp') {
        return [
          {
            id: 'timestamp',
            kind: CapabilityKind.Event,
            readable: true,
            operations: [],
          },
        ];
      }
      if (
        attrs.device_class === 'data_rate' ||
        attrs.unit_of_measurement === 'Mbit/s' ||
        attrs.unit_of_measurement === 'MB/s'
      ) {
        return [
          {
            id: 'data_rate',
            kind: 'numeric' as CapabilityKind,
            readable: true,
            operations: [],
            unit: String(attrs.unit_of_measurement ?? 'Mbit/s'),
          },
        ];
      }
      if (attrs.device_class === 'data_size' || attrs.unit_of_measurement === 'GiB') {
        return [
          {
            id: 'data_size',
            kind: 'numeric' as CapabilityKind,
            readable: true,
            operations: [],
            unit: String(attrs.unit_of_measurement ?? 'GiB'),
          },
        ];
      }
      if (attrs.device_class === 'duration' || attrs.unit_of_measurement === 'ms') {
        return [
          {
            id: 'duration',
            kind: 'numeric' as CapabilityKind,
            readable: true,
            operations: [],
            unit: String(attrs.unit_of_measurement ?? 'ms'),
          },
        ];
      }
      if (attrs.device_class === 'humidity' || attrs.unit_of_measurement === '%') {
        return [
          {
            id: 'humidity',
            kind: CapabilityKind.Humidity,
            readable: true,
            operations: [],
            unit: '%',
          },
        ];
      }
      if (attrs.device_class === 'pressure' || attrs.unit_of_measurement === 'hPa') {
        return [
          {
            id: 'pressure',
            kind: 'numeric' as CapabilityKind,
            readable: true,
            operations: [],
            unit: 'hPa',
          },
        ];
      }
      if (attrs.device_class === 'wind_speed' || attrs.unit_of_measurement === 'km/h') {
        return [
          {
            id: 'wind_speed',
            kind: 'numeric' as CapabilityKind,
            readable: true,
            operations: [],
            unit: 'km/h',
          },
        ];
      }
      if (attrs.device_class === 'temperature' || attrs.unit_of_measurement === '°C') {
        return [createTemperatureCapability()];
      }
      if (typeof payload?.state === 'string' && Number.isNaN(Number(payload.state))) {
        return [
          {
            id: 'value',
            kind: 'string' as CapabilityKind,
            readable: true,
            operations: [],
          },
        ];
      }
      return [
        {
          id: 'value',
          kind: 'numeric' as CapabilityKind,
          readable: true,
          operations: [],
          unit:
            typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : undefined,
        },
      ];
    case 'weather':
      return [
        {
          id: 'weather',
          kind: 'weather' as CapabilityKind,
          readable: true,
          operations: [],
        },
      ];
    case 'notify':
      return [
        {
          id: 'notify',
          kind: 'service' as CapabilityKind,
          readable: false,
          operations: ['send_message', 'notify'],
        },
      ];
    case 'button':
      return [
        {
          id: 'button',
          kind: CapabilityKind.Event,
          readable: false,
          operations: ['press'],
        },
      ];
    case 'scene':
      return [
        {
          id: 'scene',
          kind: 'action' as CapabilityKind,
          readable: false,
          operations: ['turn_on', 'activate'],
        },
      ];
    case 'event': {
      const eventTypes = Array.isArray(attrs.event_types)
        ? (attrs.event_types as string[])
        : ['initial_press', 'repeat', 'short_release', 'long_press', 'long_release'];
      return [
        {
          id: 'event',
          kind: CapabilityKind.Event,
          readable: true,
          operations: [],
          choices: eventTypes,
        },
      ];
    }
    case 'select': {
      const options = Array.isArray(attrs.options) ? (attrs.options as string[]) : [];
      return [
        {
          id: 'select',
          kind: 'mode' as CapabilityKind,
          readable: true,
          operations: ['select_option', 'set'],
          choices: options,
        },
      ];
    }
    case 'update':
      return [updateCapability, onOffCapability];
    case 'device_tracker':
      return [
        {
          id: 'device_tracker',
          kind: CapabilityKind.Event,
          readable: true,
          operations: [],
          choices: ['home', 'not_home'],
        },
        contactCapability,
      ];
    case 'image':
      return [
        {
          id: 'image',
          kind: CapabilityKind.Event,
          readable: true,
          operations: [],
        },
      ];
    default:
      return [];
  }
}
