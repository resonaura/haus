/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { entityDomain } from './capabilities.js';
import type { Category, Device, EntityRegistryEntry, HassEntity } from './types.js';

export const controlDomains = new Set([
  'light',
  'switch',
  'climate',
  'cover',
  'media_player',
  'lock',
  'camera',
  'printer',
  'fan',
  'valve',
  'humidifier',
  'water_heater',
  'alarm_control_panel',
  'vacuum',
  'siren',
  'select',
  'number',
  'button',
  'input_boolean',
  'input_number',
  'input_select',
  'input_button',
]);

export const specialDomains = new Set([
  'scene',
  'automation',
  'script',
  'person',
  'zone',
  'sun',
  'weather',
  'update',
]);

export const securityClasses = new Set([
  'door',
  'window',
  'opening',
  'garage_door',
  'motion',
  'occupancy',
  'presence',
  'smoke',
  'gas',
  'carbon_monoxide',
  'safety',
  'tamper',
  'vibration',
]);

export const climateClasses = new Set([
  'temperature',
  'humidity',
  'carbon_dioxide',
  'pm1',
  'pm25',
  'pm10',
  'aqi',
  'volatile_organic_compounds',
  'volatile_organic_compounds_parts',
  'air_quality',
]);

export const applianceClasses = new Set([
  'appliance',
  'coffee',
  'kettle',
  'cooking',
  'microwave',
  'oven',
  'washer',
  'dryer',
  'dishwasher',
]);

export const environmentalSensorClasses = new Set([
  'illuminance',
  'atmospheric_pressure',
  'pressure',
  'sound_pressure',
  'wind_speed',
  'precipitation',
  'precipitation_intensity',
  'irradiance',
]);

const NON_AMBIENT_TEMP_SOURCE =
  'cpu|gpu|soc|chip|board|pcb|core|disk|drive|hdd|ssd|nvme|battery|device|internal|nozzle|extruder|hotend|heatbed|print[_\\s-]*bed|water|boiler|kettle|oil|coolant|exhaust|intake|food|meat|oven|fridge|freezer';

const NON_AMBIENT_TEMP_RE = new RegExp(
  `(?:^|[_\\.\\s-])(?:${NON_AMBIENT_TEMP_SOURCE})[_\\.\\s-]*(?:temp|temperature)(?:$|[_\\.\\s-])|(?:^|[_\\.\\s-])(?:temp|temperature)[_\\.\\s-]*(?:${NON_AMBIENT_TEMP_SOURCE})(?:$|[_\\.\\s-])`,
  'i',
);

const INDICATOR_LIGHT_RE = /status[_\s-]*light|indicator|led[_\s-]*ring|power[_\s-]*led/i;

export function isNonAmbientTemperature(entity: HassEntity, entry?: EntityRegistryEntry): boolean {
  const label = `${entity.entity_id} ${friendlyName(entity)} ${entry?.name ?? ''} ${entry?.original_name ?? ''}`;
  return NON_AMBIENT_TEMP_RE.test(label);
}

export function isNonClimateHardware(primary: HassEntity, primaryCategory: Category): boolean {
  return (
    primaryCategory === 'printers' ||
    primaryCategory === 'network' ||
    primaryCategory === 'appliances' ||
    entityDomain(primary) === 'water_heater'
  );
}

export function effectiveClimateClass(
  entity: HassEntity,
  entry?: EntityRegistryEntry,
): string | undefined {
  const domain = entityDomain(entity);
  if (domain !== 'sensor' && domain !== 'binary_sensor') return undefined;
  const deviceClass = String(entity.attributes.device_class ?? '');
  if (climateClasses.has(deviceClass)) {
    if (deviceClass === 'temperature' && isNonAmbientTemperature(entity, entry)) return undefined;
    return deviceClass;
  }
  if (deviceClass || domain !== 'sensor') return undefined;
  const unit = String(entity.attributes.unit_of_measurement ?? '').trim();
  const label = `${entity.entity_id} ${friendlyName(entity)} ${entry?.name ?? ''} ${entry?.original_name ?? ''}`;
  if (
    ['°C', '°F', 'C', 'F'].includes(unit) &&
    /(?:^|[_.\s-])(?:temp|temperature)(?:$|[_.\s-])/i.test(label) &&
    !isNonAmbientTemperature(entity, entry)
  ) {
    return 'temperature';
  }
  if (unit === '%' && /(?:^|[_.\s-])humidity(?:$|[_.\s-])/i.test(label)) {
    return 'humidity';
  }
  return undefined;
}

export const isSecondary = (entry?: EntityRegistryEntry) =>
  Boolean(entry?.disabled_by || entry?.hidden_by || entry?.entity_category);

export const friendlyName = (entity: HassEntity) =>
  entity.attributes.friendly_name ||
  entity.entity_id.split('.')[1]?.replaceAll('_', ' ') ||
  entity.entity_id;

export const batteryChargingValue = (entity: HassEntity): boolean | undefined => {
  const value = entity.attributes.is_charging ?? entity.state;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase().replaceAll('_', ' ');
  if (['on', 'true', '1', 'charging', 'finishing charge'].includes(normalized)) return true;
  if (['off', 'false', '0', 'not charging', 'discharging', 'charged', 'full'].includes(normalized))
    return false;
  return undefined;
};

export function displayNameForDevice(
  entity: HassEntity,
  entry: EntityRegistryEntry | undefined,
  device: Device | undefined,
  _useDeviceName = true,
): string {
  const entityName = String(entry?.name || friendlyName(entity))
    .replace(/\s+/g, ' ')
    .trim();
  const chosenDeviceName = String(device?.name_by_user || device?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (chosenDeviceName) return chosenDeviceName;
  return entityName || entity.entity_id;
}

export function batteryMatchTokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(
      /\b(battery|batteries|batt|charge|charging|level|percentage|percent|capacity|sensor|device)\b/g,
      ' ',
    )
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

export function powerEntityMatchesDevice(entityLabel: string, deviceLabel: string): boolean {
  if (/\b(power|relay)\b/i.test(entityLabel)) return true;
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/\b(power|relay|switch|light|lamp|on|off)\b/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const entityBase = normalize(entityLabel);
  return Boolean(entityBase && entityBase === normalize(deviceLabel));
}

export function batteryNameScore(batteryName: string, accessoryNames: string[]): number {
  const batteryTokens = batteryMatchTokens(batteryName);
  if (batteryTokens.length < 2) return 0;
  return accessoryNames.reduce((best, name) => {
    const accessoryTokens = batteryMatchTokens(name);
    if (accessoryTokens.length < 2) return best;
    const accessorySet = new Set(accessoryTokens);
    const shared = batteryTokens.filter((token) => accessorySet.has(token)).length;
    const score = shared / Math.max(batteryTokens.length, accessorySet.size);
    return Math.max(best, score);
  }, 0);
}

export const isSegmentEntity = (entity: HassEntity) =>
  /segment|pixel|(?:^|[_.\s-])zone(?:$|[_.\s-])/i.test(
    `${entity.entity_id} ${String(entity.attributes.friendly_name ?? '')}`,
  );

/** Only logical children inherit an area. via_device_id is a gateway, not a room parent. */
export function effectiveArea(
  entry: EntityRegistryEntry | undefined,
  devices: ReadonlyMap<string, Device>,
): string | undefined {
  if (entry?.area_id) return entry.area_id;
  let deviceId = entry?.device_id;
  const visited = new Set<string>();
  while (deviceId && !visited.has(deviceId)) {
    visited.add(deviceId);
    const device = devices.get(deviceId);
    if (!device) return undefined;
    if (device.area_id) return device.area_id;
    deviceId = device.parent_device_id;
  }
  return undefined;
}

export function entityCategory(entity: HassEntity): Category {
  const domain = entityDomain(entity);
  const deviceClass = String(entity.attributes.device_class ?? '');
  if (domain === 'light') return 'lights';
  if (domain === 'printer') return 'printers';
  if (['climate', 'fan', 'humidifier'].includes(domain) || effectiveClimateClass(entity))
    return 'climate';
  if (
    ['camera', 'lock', 'alarm_control_panel', 'siren'].includes(domain) ||
    securityClasses.has(deviceClass)
  )
    return 'security';
  if (domain === 'media_player') return 'media';
  if (
    ['valve', 'water_heater'].includes(domain) ||
    ['moisture', 'water', 'water_flow'].includes(deviceClass)
  )
    return 'water';
  if (['switch', 'input_boolean'].includes(domain) || deviceClass === 'outlet') return 'outlets';
  if (domain === 'cover') return 'covers';
  if (domain === 'vacuum' || domain === 'lawn_mower') return 'robotics';
  if (applianceClasses.has(deviceClass)) return 'appliances';
  if (domain === 'sensor' || domain === 'binary_sensor') return 'sensors';
  return 'other';
}

/**
 * Classifies a non-diagnostic secondary entity on a multi-function device into an
 * additional user-facing category lens without leaking feature toggles, diagnostics,
 * indicator LEDs, or internal hardware telemetry.
 */
export function secondaryEntityCategory(
  entity: HassEntity,
  entry: EntityRegistryEntry | undefined,
  primary: HassEntity,
  primaryCategory: Category,
): Category | undefined {
  if (isSecondary(entry)) return undefined;
  const domain = entityDomain(entity);
  if (specialDomains.has(domain) || isSegmentEntity(entity)) return undefined;
  const deviceClass = String(entity.attributes.device_class ?? '');
  if (deviceClass === 'battery' || deviceClass === 'battery_charging') return undefined;

  if (domain === 'light') {
    const label = `${entity.entity_id} ${friendlyName(entity)} ${entry?.name ?? ''} ${entry?.original_name ?? ''}`;
    return INDICATOR_LIGHT_RE.test(label) ? undefined : 'lights';
  }
  if (domain === 'printer') return 'printers';

  const nonClimateHardware = isNonClimateHardware(primary, primaryCategory);
  if (domain === 'climate' || domain === 'humidifier') return 'climate';
  if (domain === 'fan') return nonClimateHardware ? undefined : 'climate';
  const climateClass = effectiveClimateClass(entity, entry);
  if (climateClass) {
    if (primaryCategory === 'printers' || primaryCategory === 'network') return undefined;
    if (climateClass === 'temperature' && nonClimateHardware) return undefined;
    return 'climate';
  }

  if (
    ['camera', 'lock', 'alarm_control_panel', 'siren'].includes(domain) ||
    securityClasses.has(deviceClass)
  ) {
    return 'security';
  }
  if (domain === 'media_player') return 'media';
  if (
    ['valve', 'water_heater'].includes(domain) ||
    ['moisture', 'water', 'water_flow'].includes(deviceClass)
  ) {
    return 'water';
  }
  if (['switch', 'input_boolean'].includes(domain) && deviceClass === 'outlet') return 'outlets';
  if (domain === 'cover') return 'covers';
  if (domain === 'vacuum' || domain === 'lawn_mower') return 'robotics';
  if (applianceClasses.has(deviceClass)) return 'appliances';
  if (
    (domain === 'sensor' || domain === 'binary_sensor') &&
    environmentalSensorClasses.has(deviceClass)
  )
    return 'sensors';
  return undefined;
}

const CONTROL_CATEGORY_RANK: Readonly<Record<string, number>> = {
  light: 1,
  lock: 2,
  climate: 3,
  media_player: 4,
  cover: 5,
  fan: 6,
  valve: 7,
  humidifier: 8,
  water_heater: 9,
  alarm_control_panel: 10,
  siren: 11,
  vacuum: 12,
  lawn_mower: 12,
  switch: 13,
  input_boolean: 14,
  printer: 15,
};

const SENSOR_CLASS_CATEGORY_RANK: Readonly<Record<string, number>> = {
  temperature: 20,
  humidity: 21,
  carbon_dioxide: 22,
  pm25: 23,
  pm10: 24,
  pm1: 25,
  aqi: 26,
  air_quality: 26,
  volatile_organic_compounds: 27,
  volatile_organic_compounds_parts: 27,
  smoke: 20,
  gas: 20,
  carbon_monoxide: 20,
  safety: 20,
  door: 21,
  window: 21,
  opening: 21,
  garage_door: 21,
  motion: 22,
  occupancy: 22,
  presence: 22,
  vibration: 23,
  tamper: 24,
  moisture: 20,
  water_flow: 21,
  water: 22,
  illuminance: 20,
  atmospheric_pressure: 21,
  pressure: 21,
};

export function categoryEntityRank(entity: HassEntity): number {
  const domain = entityDomain(entity);
  const controlRank = CONTROL_CATEGORY_RANK[domain];
  if (controlRank !== undefined) return controlRank;
  const effectiveClass =
    effectiveClimateClass(entity) ?? String(entity.attributes.device_class ?? '');
  return SENSOR_CLASS_CATEGORY_RANK[effectiveClass] ?? 50;
}
