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
  'pm25',
  'pm10',
  'volatile_organic_compounds',
  'air_quality',
]);

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
  useDeviceName: boolean,
): string {
  const entityName = String(entry?.name || friendlyName(entity))
    .replace(/\s+/g, ' ')
    .trim();
  const chosenDeviceName = String(device?.name_by_user || device?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (device?.name_by_user) return chosenDeviceName;
  if (useDeviceName && chosenDeviceName) return chosenDeviceName;
  if (chosenDeviceName) {
    const escaped = chosenDeviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const repeatedType = new RegExp(
      `^${escaped}\\s+(door|window|light|lamp|switch|sensor|lock|cover|battery)$`,
      'i',
    );
    if (repeatedType.test(entityName)) return chosenDeviceName;
  }
  return entityName || chosenDeviceName || entity.entity_id;
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
  if (['climate', 'fan', 'humidifier'].includes(domain) || climateClasses.has(deviceClass))
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
  return 'other';
}
