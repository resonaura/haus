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
  contactCapability,
  coverCapability,
  lockCapability,
  updateCapability,
} from '@haus/core/device';
import type { HacsEntityPayload } from './types.js';
import { sensorCapabilities } from './sensor.js';
import { mapMediaPlayerCapabilities, remoteKeyCapability } from './media.js';
import { binarySensorCapability, binarySensorId } from './classification.js';

export { makeReading, parseReadings } from './readings.js';

export const SUPPORTED_HACS_DOMAINS = new Set<string>([
  'light',
  'switch',
  'outlet',
  'climate',
  'fan',
  'humidifier',
  'cover',
  'valve',
  'lock',
  'alarm_control_panel',
  'binary_sensor',
  'sensor',
  'number',
  'text',
  'button',
  'scene',
  'event',
  'select',
  'update',
  'device_tracker',
  'image',
  'camera',
  'weather',
  'notify',
  'media_player',
  'remote',
  'input_boolean',
  'input_number',
  'input_select',
  'input_button',
  'input_text',
]);

export const SUPPORTED_HACS_CAPABILITIES = new Set<string>([
  'on_off',
  'power',
  'brightness',
  'color_temp',
  'color_temp_kelvin',
  'color_hsv',
  'color',
  'hs_color',
  'lock',
  'cover',
  'temperature',
  'target_temperature',
  'current_temperature',
  'climate',
  'hvac_mode',
  'fan_mode',
  'fan_speed',
  'percentage',
  'preset_mode',
  'oscillating',
  'target_humidity',
  'humidity',
  'mode',
  'alarm_state',
  'number',
  'text',
  'camera',
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
  'skip',
  'clear_skipped',
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
  'media_playback',
  'volume',
  'mute',
  'source',
  'remote_key',
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
    case 'input_boolean':
      return 'power';
    case 'climate':
    case 'fan':
    case 'humidifier':
      return 'climate';
    case 'media_player':
    case 'remote':
      return 'media';
    case 'cover':
    case 'valve':
      return 'covers';
    case 'lock':
    case 'alarm_control_panel':
      return 'security';
    case 'camera':
      return 'cameras';
    case 'binary_sensor':
      if (
        ['problem', 'smoke', 'gas', 'carbon_monoxide', 'moisture', 'safety'].includes(
          String(attributes.device_class),
        )
      )
        return 'safety_sensors';
      if (attributes.device_class === 'connectivity') return 'network';
      if (['motion', 'occupancy', 'presence'].includes(String(attributes.device_class)))
        return 'occupancy_sensors';
      if (binarySensorId(attributes.device_class) === 'contact') return 'security';
      return 'generic';
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

const modeCap = (id: string, op: string, choices?: string[]): Capability => ({
  id,
  kind: 'mode' as CapabilityKind,
  readable: true,
  operations: [op, 'set'],
  ...(choices ? { choices } : {}),
});

export function mapDomainToCapabilities(
  domain: string,
  payload?: Partial<HacsEntityPayload>,
): Capability[] {
  const attrs = payload?.attributes ?? {};
  switch (domain) {
    case 'media_player':
      return mapMediaPlayerCapabilities(payload);
    case 'remote':
      return [remoteKeyCapability];
    case 'light': {
      const minKelvin =
        typeof attrs.min_color_temp_kelvin === 'number' ? attrs.min_color_temp_kelvin : 2000;
      const maxKelvin =
        typeof attrs.max_color_temp_kelvin === 'number' ? attrs.max_color_temp_kelvin : 6535;
      const effectList = Array.isArray(attrs.effect_list)
        ? (attrs.effect_list as string[])
        : undefined;
      const modes = Array.isArray(attrs.supported_color_modes)
        ? attrs.supported_color_modes.filter((mode): mode is string => typeof mode === 'string')
        : undefined;
      const caps: Capability[] = [onOffCapability];
      if (!modes || modes.some((mode) => mode !== 'onoff')) caps.push(brightnessCapability);
      if (!modes || modes.includes('color_temp'))
        caps.push(createColorTempCapability(minKelvin, maxKelvin));
      if (!modes || modes.some((mode) => ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(mode)))
        caps.push(colorHsvCapability);
      if (effectList?.length) caps.push(modeCap('effect', 'set_effect', effectList));
      return caps;
    }
    case 'switch':
    case 'outlet':
    case 'input_boolean':
      return [
        {
          ...onOffCapability,
          deviceClass:
            attrs.device_class === 'outlet' || domain === 'outlet' ? 'outlet' : undefined,
        },
      ];
    case 'fan': {
      const step = typeof attrs.percentage_step === 'number' ? attrs.percentage_step : 1;
      const presetModes = Array.isArray(attrs.preset_modes)
        ? (attrs.preset_modes as string[])
        : undefined;
      const caps: Capability[] = [
        onOffCapability,
        {
          id: 'fan_speed',
          kind: 'numeric' as CapabilityKind,
          readable: true,
          operations: ['set_percentage', 'set'],
          minimum: 0,
          maximum: 100,
          step,
          unit: '%',
        },
      ];
      if (presetModes?.length) caps.push(modeCap('preset_mode', 'set_preset_mode', presetModes));
      if (typeof attrs.oscillating === 'boolean') {
        caps.push({
          id: 'oscillating',
          kind: 'binary' as CapabilityKind,
          readable: true,
          operations: ['oscillate', 'set'],
        });
      }
      return caps;
    }
    case 'humidifier': {
      const minHum = typeof attrs.min_humidity === 'number' ? attrs.min_humidity : 0;
      const maxHum = typeof attrs.max_humidity === 'number' ? attrs.max_humidity : 100;
      const modes = Array.isArray(attrs.available_modes)
        ? (attrs.available_modes as string[])
        : undefined;
      const caps: Capability[] = [
        onOffCapability,
        {
          id: 'target_humidity',
          kind: CapabilityKind.Humidity,
          readable: true,
          operations: ['set_humidity', 'set'],
          minimum: minHum,
          maximum: maxHum,
          step: 1,
          unit: '%',
        },
      ];
      if (modes?.length) caps.push(modeCap('mode', 'set_mode', modes));
      return caps;
    }
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

      if (fanModes?.length) caps.push(modeCap('fan_mode', 'set_fan_mode', fanModes));
      if (swingModes?.length) caps.push(modeCap('swing_mode', 'set_swing_mode', swingModes));
      if (swingHorizModes?.length)
        caps.push(modeCap('swing_horizontal_mode', 'set_swing_horizontal_mode', swingHorizModes));
      return caps;
    }
    case 'cover':
      return [coverCapability];
    case 'valve':
      return [coverCapability, onOffCapability];
    case 'lock':
      return [lockCapability];
    case 'alarm_control_panel':
      return [
        {
          id: 'alarm_state',
          kind: 'mode' as CapabilityKind,
          readable: true,
          operations: [
            'alarm_disarm',
            'alarm_arm_home',
            'alarm_arm_away',
            'alarm_arm_night',
            'alarm_arm_vacation',
            'set',
          ],
          choices: ['disarmed', 'armed_home', 'armed_away', 'armed_night', 'armed_vacation'],
        },
      ];
    case 'number':
    case 'input_number':
      return [
        {
          id: 'number',
          kind: 'numeric' as CapabilityKind,
          readable: true,
          operations: ['set_value', 'set'],
          minimum: typeof attrs.min === 'number' ? attrs.min : undefined,
          maximum: typeof attrs.max === 'number' ? attrs.max : undefined,
          step: typeof attrs.step === 'number' ? attrs.step : undefined,
          unit:
            typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : undefined,
        },
      ];
    case 'text':
    case 'input_text':
      return [
        {
          id: 'text',
          kind: 'string' as CapabilityKind,
          readable: true,
          operations: ['set_value', 'set'],
        },
      ];
    case 'camera':
      return [
        {
          id: 'camera',
          kind: 'video_stream' as CapabilityKind,
          readable: true,
          operations: ['turn_on', 'turn_off'],
        },
        onOffCapability,
      ];
    case 'binary_sensor':
      return [binarySensorCapability(attrs.device_class)];
    case 'sensor':
      return sensorCapabilities(payload);
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
    case 'input_button':
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
    case 'select':
    case 'input_select': {
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
