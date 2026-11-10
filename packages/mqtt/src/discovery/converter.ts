/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  createEventCapability,
  inferEntityCategory,
  stripEntityRoleSuffix,
  type Capability,
  type DeviceCategory,
  type HausEndpoint,
} from '@haus/core';
import type { HaMqttComponentConfig, HaMqttDeviceBlock, MqttEndpointBinding } from '../types.js';
import { extractTemplatePropertyKey } from './template.js';
import { buildAvailabilityRule } from './availability.js';
import { fanCapabilities } from './fan.js';
import { numberCapability, selectCapability } from './controls.js';

export function sanitizeMqttId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function extractRawIdentifier(device?: HaMqttDeviceBlock): string | undefined {
  if (!device) return undefined;
  if (typeof device.identifiers === 'string' && device.identifiers.trim()) {
    return device.identifiers.trim();
  }
  if (Array.isArray(device.identifiers) && device.identifiers.length > 0) {
    const first = device.identifiers[0];
    if (typeof first === 'string' && first.trim()) return first.trim();
  }
  if (Array.isArray(device.connections) && device.connections.length > 0) {
    const conn = device.connections[0];
    if (Array.isArray(conn) && conn.length >= 2 && conn[0] && conn[1]) {
      return `${conn[0]}_${conn[1]}`;
    }
  }
  if (typeof device.serial_number === 'string' && device.serial_number.trim()) {
    return device.serial_number.trim();
  }
  return undefined;
}

/**
 * Resolves the canonical physical device identifier from an HA MQTT discovery
 * device block, topic `node_id`, or structural entity `unique_id` pattern.
 */
export function resolvePhysicalDeviceId(
  uniqueId: string,
  device?: HaMqttDeviceBlock,
  _nodeId?: string,
): string {
  const cleanUnique = uniqueId.replace(/^mqtt_/, '').replace(/^ep_(mqtt_)?/, '');

  const explicit = extractRawIdentifier(device);
  if (explicit) return explicit;

  // Pattern 1: <bridge>-<id>-(<index>|powerSwitch|request-platform-data|status)
  const dashSubMatch = cleanUnique.match(
    /^([a-zA-Z0-9]+-[0-9A-Fa-f]{8,24})-(?:\d+|powerSwitch|request-platform-data|status)$/,
  );
  if (dashSubMatch?.[1]) return dashSubMatch[1];

  // Pattern 2: sensor-<id>-<bridge>-status -> <bridge>-<id>
  const statusSensorMatch = cleanUnique.match(/^sensor-([0-9A-Fa-f]{8,24})-([a-zA-Z0-9]+)-status$/);
  if (statusSensorMatch?.[1] && statusSensorMatch?.[2]) {
    return `${statusSensorMatch[2]}-${statusSensorMatch[1]}`;
  }

  // Pattern 3: <prefix>_<hex_or_numeric_hardware_id>_<property> (e.g. Zigbee2MQTT, Lumi/Aqara, Kettle, Shelly)
  const hwPrefixMatch = cleanUnique.match(
    /^([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)?_(?:0x)?[0-9a-fA-F]{6,24})_.+$/,
  );
  if (hwPrefixMatch?.[1]) return hwPrefixMatch[1];

  // Pattern 4: Multi-segment / multi-tube / multi-channel / clock suffix
  const roleSuffixMatch = cleanUnique.match(
    /^(.+?)_(?:all_tubes|tube_\d+|segment_\d+|zone_\d+|pixel_\d+|channel_\d+|ch_\d+|outlet_\d+|socket_\d+|timezone|time_format|sync_time|alarm_hour|alarm_minute|timer|firmware)$/,
  );
  if (roleSuffixMatch?.[1]) return roleSuffixMatch[1];

  // Pattern 5: Global bridge diagnostics (e.g. global-purge_caches, global-version)
  if (
    /^global[-_]/.test(cleanUnique) ||
    /^(?:gv2mqtt|govee2mqtt|govee_to_mqtt)(?:_bridge)?$/i.test(cleanUnique)
  ) {
    const rawLabel = (device?.model || device?.name || 'mqtt').toLowerCase();
    if (
      rawLabel.includes('govee') ||
      rawLabel === 'gv2mqtt' ||
      cleanUnique.includes('govee') ||
      cleanUnique.includes('gv2mqtt')
    ) {
      return 'gv2mqtt';
    }
    return `${sanitizeMqttId(rawLabel)}_bridge`;
  }

  return cleanUnique;
}

/**
 * Computes the longest common word prefix across multiple entity names,
 * falling back to `stripEntityRoleSuffix` when only one name is available.
 */
export function resolveCommonDeviceName(
  candidateNames: readonly string[],
  fallbackName: string,
): string {
  const cleaned = candidateNames.map((n) => stripEntityRoleSuffix(n)).filter((n) => n.length > 0);
  if (cleaned.length === 0) return stripEntityRoleSuffix(fallbackName);
  if (cleaned.length === 1) return cleaned[0]!;

  const splitWords = cleaned.map((n) => n.split(/\s+/));
  const firstWords = splitWords[0]!;
  const commonWords: string[] = [];

  for (let i = 0; i < firstWords.length; i += 1) {
    const word = firstWords[i]!;
    if (splitWords.every((words) => words[i] && words[i]!.toLowerCase() === word.toLowerCase())) {
      commonWords.push(word);
    } else {
      break;
    }
  }

  if (commonWords.length >= 2) {
    return stripEntityRoleSuffix(commonWords.join(' '));
  }

  return cleaned.reduce((shortest, curr) => (curr.length < shortest.length ? curr : shortest));
}

export function buildEndpointFromComponent(params: {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly component: string;
  readonly uniqueId: string;
  readonly endpointId: string;
  readonly config: HaMqttComponentConfig;
  readonly componentKey?: string;
  readonly fallbackStateTopic?: string;
  readonly isCameraDevice?: boolean;
}): { readonly endpoint: HausEndpoint; readonly binding: MqttEndpointBinding } {
  const {
    deviceId,
    deviceName,
    component,
    uniqueId,
    endpointId,
    config,
    componentKey,
    fallbackStateTopic,
    isCameraDevice,
  } = params;

  const rawName = typeof config.name === 'string' ? config.name.trim() : '';
  const epName =
    rawName &&
    deviceName &&
    !rawName.toLowerCase().includes(deviceName.toLowerCase()) &&
    !deviceName.toLowerCase().includes(rawName.toLowerCase())
      ? `${deviceName} ${rawName}`
      : rawName || deviceName;

  const stateTopic =
    config.state_topic ??
    config.mode_state_topic ??
    config.current_temperature_topic ??
    config.position_topic ??
    fallbackStateTopic;

  const commandTopic =
    config.command_topic ??
    config.mode_command_topic ??
    config.temperature_command_topic ??
    config.power_command_topic ??
    config.set_position_topic ??
    config.percentage_command_topic;

  const entityCategory = inferEntityCategory({
    component,
    id: uniqueId,
    name: epName,
    deviceClass: config.device_class,
    explicitCategory: config.entity_category,
    isCameraSubEntity: isCameraDevice,
  });

  const capabilities: Capability[] =
    component === 'event' ? [createEventCapability(config.event_types ?? [])] : [];
  let epCategory: DeviceCategory = 'generic';
  let primaryCapabilityId = component === 'event' ? 'event' : 'state';
  let numericState: boolean | undefined;

  if (component === 'light') {
    epCategory = 'lighting';
    primaryCapabilityId = 'on_off';
    const modes = config.supported_color_modes ? [...config.supported_color_modes] : undefined;
    const effects = config.effect_list ? [...config.effect_list] : undefined;
    capabilities.push({
      id: 'on_off',
      kind: 'binary',
      readable: true,
      operations: commandTopic ? ['set', 'turn_on', 'turn_off'] : [],
      supportedColorModes: modes,
      effectList: effects,
      entityCategory,
      icon: config.icon,
    });
    const hasBrightness =
      config.brightness === true ||
      typeof config.brightness_scale === 'number' ||
      Boolean(modes?.some((m) => m !== 'onoff'));
    if (hasBrightness) {
      capabilities.push({
        id: 'brightness',
        kind: 'numeric',
        readable: true,
        operations: commandTopic ? ['set'] : [],
        minimum: 0,
        maximum: 255,
      });
    }
    const hasColor =
      config.color_mode === true ||
      Boolean(modes?.some((m) => ['rgb', 'hs', 'xy', 'rgbw', 'rgbww'].includes(m)));
    if (hasColor) {
      capabilities.push({
        id: 'color',
        kind: 'complex',
        readable: true,
        operations: commandTopic ? ['set'] : [],
        supportedColorModes: modes,
      });
    }
    if (
      modes?.includes('color_temp') ||
      config.min_mireds ||
      config.max_mireds ||
      config.min_kelvin
    ) {
      const minKelvin =
        config.min_kelvin ?? (config.max_mireds ? Math.round(1_000_000 / config.max_mireds) : 2000);
      const maxKelvin =
        config.max_kelvin ?? (config.min_mireds ? Math.round(1_000_000 / config.min_mireds) : 6500);
      capabilities.push({
        id: 'color_temp',
        kind: 'numeric',
        readable: true,
        operations: commandTopic ? ['set'] : [],
        unit: 'K',
        minimum: minKelvin,
        maximum: maxKelvin,
      });
    }
    if (config.effect === true || (effects && effects.length > 0)) {
      capabilities.push({
        id: 'effect',
        kind: 'string',
        readable: true,
        operations: commandTopic ? ['set'] : [],
        choices: effects,
      });
    }
  } else if (component === 'water_heater') {
    epCategory = 'appliances';
    primaryCapabilityId = 'water_heater';
    capabilities.push({
      id: 'water_heater',
      kind: 'complex',
      readable: true,
      operations: ['set', 'turn_on', 'turn_off'],
      unit: config.temperature_unit ?? '°C',
      minimum: config.min_temp ?? 40,
      maximum: config.max_temp ?? 99,
      step: config.precision ?? config.temp_step ?? 1,
      choices: config.modes ? [...config.modes] : ['off', 'electric', 'performance'],
      icon: config.icon ?? 'mdi:kettle-steam-outline',
      entityCategory,
    });
  } else if (component === 'climate') {
    epCategory = 'climate';
    primaryCapabilityId = 'climate';
    capabilities.push({
      id: 'climate',
      kind: 'complex',
      readable: true,
      operations: ['set', 'turn_on', 'turn_off'],
      unit: config.temperature_unit ?? '°C',
      minimum: config.min_temp ?? 7,
      maximum: config.max_temp ?? 35,
      step: config.precision ?? config.temp_step ?? 0.5,
      choices: config.modes ? [...config.modes] : ['off', 'heat', 'cool', 'auto'],
      icon: config.icon,
      entityCategory,
    });
  } else if (component === 'switch') {
    epCategory = 'power';
    primaryCapabilityId = 'on_off';
    capabilities.push({
      id: 'on_off',
      kind: 'binary',
      readable: true,
      operations: commandTopic ? ['set', 'turn_on', 'turn_off'] : [],
      deviceClass: config.device_class,
      entityCategory,
      icon: config.icon,
    });
  } else if (component === 'button') {
    epCategory = 'power';
    primaryCapabilityId = 'press';
    capabilities.push({
      id: 'press',
      kind: 'action',
      readable: false,
      operations: commandTopic ? ['press'] : [],
      deviceClass: config.device_class,
      entityCategory,
      icon: config.icon,
    });
  } else if (component === 'number') {
    epCategory = 'generic';
    primaryCapabilityId = 'number';
    capabilities.push(numberCapability(config, entityCategory, Boolean(commandTopic)));
  } else if (component === 'select') {
    epCategory = 'generic';
    primaryCapabilityId = 'select';
    capabilities.push(selectCapability(config, entityCategory, Boolean(commandTopic)));
  } else if (component === 'binary_sensor') {
    epCategory = 'security';
    primaryCapabilityId = config.device_class || 'binary_sensor';
    capabilities.push({
      id: primaryCapabilityId,
      kind: 'binary',
      readable: true,
      operations: [],
      deviceClass: config.device_class,
      entityCategory,
      icon: config.icon,
    });
  } else if (component === 'sensor') {
    epCategory = 'environmental_sensors';
    const inferredSensorClass =
      config.device_class ||
      (/(?:^|[_.\s-])temperature(?:$|[_.\s-])/i.test(`${uniqueId} ${epName}`)
        ? 'temperature'
        : /(?:^|[_.\s-])humidity(?:$|[_.\s-])/i.test(`${uniqueId} ${epName}`)
          ? 'humidity'
          : /(?:^|[_.\s-])battery(?:$|[_.\s-])/i.test(`${uniqueId} ${epName}`)
            ? 'battery'
            : undefined);
    primaryCapabilityId = inferredSensorClass || 'sensor';
    const enumOptions = inferredSensorClass === 'enum' ? config.options : undefined;
    const isNumeric = Boolean(
      config.unit_of_measurement ||
      config.suggested_display_precision !== undefined ||
      [
        'temperature',
        'humidity',
        'battery',
        'power',
        'energy',
        'voltage',
        'current',
        'illuminance',
        'pressure',
        'signal_strength',
        'duration',
      ].includes(inferredSensorClass ?? ''),
    );
    numericState = isNumeric
      ? true
      : entityCategory === 'diagnostic' || inferredSensorClass === 'enum'
        ? false
        : undefined;
    capabilities.push({
      id: primaryCapabilityId,
      kind: enumOptions ? 'enum' : isNumeric ? 'numeric' : 'string',
      readable: true,
      operations: [],
      unit: config.unit_of_measurement,
      displayPrecision: config.suggested_display_precision,
      choices: enumOptions ? [...enumOptions] : undefined,
      deviceClass: inferredSensorClass,
      entityCategory,
      icon: config.icon,
    });
  } else if (component === 'cover') {
    epCategory = 'covers';
    primaryCapabilityId = 'position';
    capabilities.push({
      id: 'position',
      kind: 'numeric',
      readable: true,
      operations: ['set', 'open', 'close', 'stop'],
      unit: '%',
      minimum: 0,
      maximum: 100,
      deviceClass: config.device_class,
      entityCategory,
      icon: config.icon,
    });
  } else if (component === 'lock') {
    epCategory = 'security';
    primaryCapabilityId = 'lock';
    capabilities.push({
      id: 'lock',
      kind: 'binary',
      readable: true,
      operations: ['set', 'lock', 'unlock'],
      entityCategory,
      icon: config.icon,
    });
  } else if (component === 'fan') {
    epCategory = 'climate';
    primaryCapabilityId = 'fan';
    capabilities.push(...fanCapabilities(config, entityCategory, Boolean(commandTopic)));
  } else if (component === 'camera') {
    epCategory = 'cameras';
    primaryCapabilityId = 'video';
    capabilities.push({
      id: 'video',
      kind: 'complex',
      readable: true,
      operations: [],
      entityCategory,
      icon: config.icon,
    });
  } else if (component !== 'event') {
    primaryCapabilityId = 'state';
    capabilities.push({
      id: 'state',
      kind: 'string',
      readable: true,
      operations: commandTopic ? ['set'] : [],
      entityCategory,
      icon: config.icon,
    });
  }

  const endpoint: HausEndpoint = {
    id: endpointId,
    name: epName,
    category: epCategory,
    capabilities,
    readings: {},
  };

  const binding: MqttEndpointBinding = {
    endpointId,
    deviceId,
    component,
    primaryCapabilityId,
    isJsonSchema:
      config.schema === 'json' ||
      (component === 'light' && Boolean(config.brightness_scale || config.supported_color_modes)),
    numericState,
    stateTopic,
    commandTemplate: Boolean(config.command_template),
    attributesTopic: config.json_attributes_topic,
    attributesTemplate: config.json_attributes_template,
    availability: buildAvailabilityRule(config),
    commandTopic,
    payloadOn: String(
      component === 'button'
        ? (config.payload_press ?? 'PRESS')
        : (config.payload_on ?? config.payload_press ?? 'ON'),
    ),
    payloadOff: String(config.payload_off ?? 'OFF'),
    valueTemplate: config.value_template,
    propertyKey: extractTemplatePropertyKey(config.value_template) ?? componentKey,
    brightnessScale: config.brightness_scale,
    colorTempKelvin: config.color_temp_kelvin,
    supportedColorModes: config.supported_color_modes,
    enumOptions:
      component === 'select' || (component === 'sensor' && config.device_class === 'enum')
        ? config.options
        : undefined,
    numberMinimum: component === 'number' ? (config.min ?? 1) : undefined,
    numberMaximum: component === 'number' ? (config.max ?? 100) : undefined,
    numberStep: component === 'number' ? (config.step ?? 1) : undefined,
    modeStateTopic: config.mode_state_topic,
    modeStateTemplate: config.mode_state_template,
    modeCommandTopic: config.mode_command_topic,
    temperatureStateTopic: config.temperature_state_topic,
    temperatureStateTemplate: config.temperature_state_template,
    temperatureCommandTopic: config.temperature_command_topic,
    currentTemperatureTopic: config.current_temperature_topic,
    currentTemperatureTemplate: config.current_temperature_template,
    powerCommandTopic: config.power_command_topic,
    percentageStateTopic: config.percentage_state_topic,
    percentageValueTemplate: config.percentage_value_template,
    payloadResetPercentage: String(config.payload_reset_percentage ?? 'None'),
    speedRangeMin: config.speed_range_min ?? 1,
    speedRangeMax: config.speed_range_max ?? 100,
    stateValueTemplate: config.state_value_template,
    eventTypes: component === 'event' ? config.event_types : undefined,
  };

  return { endpoint, binding };
}
