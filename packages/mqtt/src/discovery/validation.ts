/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  DeviceBundleDiscoveryPayload,
  HaMqttComponentConfig,
  HaMqttDeviceBlock,
  HaMqttOriginBlock,
} from '../types.js';

export function discoveryObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
const string = (value: unknown) => typeof value === 'string';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const boolean = (value: unknown) => typeof value === 'boolean';
const strings = (value: unknown) => Array.isArray(value) && value.every(string);
const primitive = (value: unknown) => string(value) || number(value) || boolean(value);

function fields(
  value: Record<string, unknown>,
  keys: readonly string[],
  valid: (field: unknown) => boolean,
): boolean {
  return keys.every((key) => value[key] === undefined || valid(value[key]));
}

function device(value: unknown): value is HaMqttDeviceBlock {
  return (
    discoveryObject(value) &&
    fields(
      value,
      [
        'name',
        'manufacturer',
        'model',
        'sw_version',
        'hw_version',
        'serial_number',
        'model_id',
        'configuration_url',
        'suggested_area',
        'via_device',
      ],
      string,
    ) &&
    (value.identifiers === undefined || string(value.identifiers) || strings(value.identifiers)) &&
    (value.connections === undefined ||
      (Array.isArray(value.connections) &&
        value.connections.every(
          (item) => Array.isArray(item) && item.length === 2 && item.every(string),
        )))
  );
}

function origin(value: unknown): value is HaMqttOriginBlock {
  return (
    discoveryObject(value) &&
    fields(value, ['name', 'sw_version', 'support_url'], string) &&
    typeof value.name === 'string' &&
    value.name.length > 0
  );
}

/** Validate every field promised by the typed mapper, while retaining unknown provider extensions. */
export function componentDiscovery(value: unknown): value is HaMqttComponentConfig {
  return (
    discoveryObject(value) &&
    (value.origin === undefined || origin(value.origin)) &&
    fields(
      value,
      [
        'platform',
        'unique_id',
        'object_id',
        'schema',
        'state_topic',
        'command_topic',
        'availability_topic',
        'availability_mode',
        'availability_template',
        'payload_available',
        'payload_not_available',
        'json_attributes_topic',
        'json_attributes_template',
        'value_template',
        'command_template',
        'payload_press',
        'device_class',
        'unit_of_measurement',
        'entity_category',
        'icon',
        'mode',
        'temperature_unit',
        'mode_state_topic',
        'mode_state_template',
        'mode_command_topic',
        'temperature_state_topic',
        'temperature_state_template',
        'temperature_command_topic',
        'current_temperature_topic',
        'current_temperature_template',
        'power_command_topic',
        'position_topic',
        'set_position_topic',
        'percentage_state_topic',
        'percentage_value_template',
        'percentage_command_topic',
        'payload_reset_percentage',
        'state_value_template',
      ],
      string,
    ) &&
    fields(
      value,
      [
        'brightness_scale',
        'min_mireds',
        'max_mireds',
        'min_kelvin',
        'max_kelvin',
        'min',
        'max',
        'step',
        'min_temp',
        'max_temp',
        'precision',
        'temp_step',
        'speed_range_min',
        'speed_range_max',
      ],
      number,
    ) &&
    (value.speed_range_min === undefined ||
      (typeof value.speed_range_min === 'number' &&
        Number.isInteger(value.speed_range_min) &&
        value.speed_range_min >= 1)) &&
    (value.speed_range_max === undefined ||
      (typeof value.speed_range_max === 'number' &&
        Number.isInteger(value.speed_range_max) &&
        value.speed_range_max >= 1)) &&
    Number(value.speed_range_max ?? 100) >= Number(value.speed_range_min ?? 1) &&
    fields(value, ['enabled_by_default', 'brightness', 'color_mode', 'effect'], boolean) &&
    fields(value, ['supported_color_modes', 'effect_list', 'options', 'modes'], strings) &&
    fields(value, ['payload_on', 'payload_off', 'state_on', 'state_off'], primitive) &&
    (value.json_attributes_topic === undefined ||
      (typeof value.json_attributes_topic === 'string' &&
        value.json_attributes_topic.trim().length > 0)) &&
    (value.json_attributes_template === undefined ||
      (typeof value.json_attributes_template === 'string' &&
        value.json_attributes_template.trim().length > 0)) &&
    (value.availability_mode === undefined ||
      ['all', 'any', 'latest'].includes(String(value.availability_mode))) &&
    (value.availability === undefined ||
      (Array.isArray(value.availability) &&
        value.availability.length > 0 &&
        value.availability.every(
          (item) =>
            discoveryObject(item) &&
            fields(
              item,
              ['topic', 'payload_available', 'payload_not_available', 'value_template'],
              string,
            ) &&
            typeof item.topic === 'string' &&
            item.topic.trim().length > 0,
        ))) &&
    !(value.availability !== undefined && value.availability_topic !== undefined) &&
    (value.name === undefined || value.name === null || string(value.name)) &&
    (value.device === undefined || device(value.device))
  );
}

export function bundleDiscovery(value: unknown): value is DeviceBundleDiscoveryPayload {
  return (
    discoveryObject(value) &&
    componentDiscovery(value) &&
    discoveryObject(value.components) &&
    Object.values(value.components).every(componentDiscovery)
  );
}
