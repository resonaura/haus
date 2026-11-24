/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { TransportEntityState } from './contract.js';

export interface LightColorPreset {
  readonly name: string;
  readonly hex: string;
  readonly rgb: readonly [number, number, number];
}

export const LIGHT_COLOUR_PRESETS: readonly LightColorPreset[] = [
  { name: 'Candlelight', hex: '#ffc47c', rgb: [255, 196, 124] },
  { name: 'Warm white', hex: '#ffe7ba', rgb: [255, 231, 186] },
  { name: 'Daylight', hex: '#ecf5ff', rgb: [236, 245, 255] },
  { name: 'Rose', hex: '#eea5a9', rgb: [238, 165, 169] },
  { name: 'Lavender', hex: '#acaff4', rgb: [172, 175, 244] },
  { name: 'Ocean', hex: '#8fc8dc', rgb: [143, 200, 220] },
];

export const MEDIA_REMOTE_DPAD = [
  { command: 'up', label: 'Up' },
  { command: 'left', label: 'Left' },
  { command: 'select', label: 'Select' },
  { command: 'right', label: 'Right' },
  { command: 'down', label: 'Down' },
] as const;

export const MEDIA_REMOTE_ACTIONS = [
  { command: 'home', label: 'Home' },
  { command: 'menu', label: 'Back' },
  { command: 'play_pause', label: 'Play / Pause' },
] as const;

export function hsvToRgb(h: number, s: number, v = 100): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const val = Math.max(0, Math.min(100, v)) / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = Math.max(0, Math.min(255, r)) / 255;
  const gn = Math.max(0, Math.min(255, g)) / 255;
  const bn = Math.max(0, Math.min(255, b)) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : (d / max) * 100;
  return [Math.round(h), Math.round(s), Math.round(max * 100)];
}

export function canonicalEntityId(entity: TransportEntityState): string {
  const attrId = entity.attributes.haus_ha_entity_id;
  if (typeof attrId === 'string' && attrId.includes('.')) {
    return attrId.toLowerCase();
  }
  return entity.entity_id.toLowerCase();
}

export function canonicalEntityDomain(entity: TransportEntityState): string {
  const canonical = canonicalEntityId(entity);
  return canonical.split('.')[0] || entity.entity_id.split('.')[0] || '';
}

export function canonicalEntityObjectId(entity: TransportEntityState): string {
  const canonical = canonicalEntityId(entity);
  return canonical.split('.')[1] ?? canonical;
}

export function friendlyEntityLabel(entity: TransportEntityState, deviceName?: string): string {
  const raw =
    typeof entity.attributes.friendly_name === 'string' && entity.attributes.friendly_name.trim()
      ? entity.attributes.friendly_name.trim()
      : canonicalEntityObjectId(entity).replace(/_/g, ' ');
  if (deviceName && raw.toLowerCase().startsWith(deviceName.toLowerCase())) {
    const stripped = raw
      .slice(deviceName.length)
      .replace(/^[\s\-_:]+/, '')
      .trim();
    if (stripped) return stripped;
  }
  return raw;
}

export function findUpdateEntities<T extends TransportEntityState>(
  entities: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.entity_id)) return false;
    seen.add(entity.entity_id);
    return canonicalEntityDomain(entity) === 'update' || entity.entity_id.startsWith('update.');
  });
}

export function findQrImageEntities<T extends TransportEntityState>(
  entities: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.entity_id)) return false;
    seen.add(entity.entity_id);
    const domain = canonicalEntityDomain(entity);
    const objectId = canonicalEntityObjectId(entity);
    const name = String(entity.attributes.friendly_name ?? '').toLowerCase();
    return (
      domain === 'image' ||
      entity.entity_id.startsWith('image.') ||
      objectId.includes('qr_code') ||
      name.includes('qr code')
    );
  });
}

export interface ClassifiedNetworkStates<T extends TransportEntityState = TransportEntityState> {
  readonly all: readonly T[];
  readonly statusEntity: T;
  readonly clientsEntity?: T;
  readonly guestClientsEntity?: T;
  readonly downloadSpeedEntity?: T;
  readonly uploadSpeedEntity?: T;
  readonly publicIpEntity?: T;
  readonly gatewayIpEntity?: T;
  readonly meshQualityEntity?: T;
  readonly statusLightEntity?: T;
  readonly switchEntities: readonly T[];
  readonly buttonEntities: readonly T[];
  readonly selectEntities: readonly T[];
  readonly updateEntities: readonly T[];
  readonly qrImageEntities: readonly T[];
}

export function classifyNetworkStates<T extends TransportEntityState>(
  primaryEntity: T,
  secondaryEntities: readonly T[],
): ClassifiedNetworkStates<T> {
  const rawAll = [primaryEntity, ...secondaryEntities];
  const seen = new Set<string>();
  const all = rawAll.filter((entity) => {
    if (seen.has(entity.entity_id)) return false;
    seen.add(entity.entity_id);
    return true;
  });

  const findBySuffix = (...patterns: readonly RegExp[]): T | undefined =>
    all.find((item) => {
      const obj = canonicalEntityObjectId(item);
      const name = String(item.attributes.friendly_name ?? '').toLowerCase();
      return patterns.some((re) => re.test(obj) || re.test(name));
    });

  const statusEntity =
    findBySuffix(/(?:^|_)status$/, /connectivity/) ??
    all.find((item) => item.attributes.device_class === 'connectivity') ??
    primaryEntity;

  return {
    all,
    statusEntity,
    clientsEntity: findBySuffix(/(?:^|_)connected_clients$/, /^connected clients$/),
    guestClientsEntity: findBySuffix(/(?:^|_)connected_guest_clients$/, /guest clients/),
    downloadSpeedEntity: findBySuffix(/download_speed/, /download speed/),
    uploadSpeedEntity: findBySuffix(/upload_speed/, /upload speed/),
    publicIpEntity: findBySuffix(/public_ip/, /public ip/),
    gatewayIpEntity: findBySuffix(/gateway_ip/, /gateway ip/),
    meshQualityEntity: findBySuffix(/mesh_quality/, /mesh quality/),
    statusLightEntity: all.find(
      (item) => canonicalEntityDomain(item) === 'light' || item.entity_id.startsWith('light.'),
    ),
    switchEntities: all.filter(
      (item) => canonicalEntityDomain(item) === 'switch' || item.entity_id.startsWith('switch.'),
    ),
    buttonEntities: all.filter(
      (item) => canonicalEntityDomain(item) === 'button' || item.entity_id.startsWith('button.'),
    ),
    selectEntities: all.filter(
      (item) => canonicalEntityDomain(item) === 'select' || item.entity_id.startsWith('select.'),
    ),
    updateEntities: findUpdateEntities(all),
    qrImageEntities: findQrImageEntities(all),
  };
}

export interface PrinterSupplyItem {
  readonly id: string;
  readonly label: string;
  readonly percentage?: number;
  readonly colorHex: string;
}

function supplyColorHex(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('cyan')) return '#06b6d4';
  if (lower.includes('magenta')) return '#ec4899';
  if (lower.includes('yellow')) return '#eab308';
  if (lower.includes('black') || lower.includes('mono') || lower.includes('bk')) return '#52525b';
  if (lower.includes('tri') || lower.includes('color') || lower.includes('colour')) return '#8b5cf6';
  return '#60a5fa';
}

export function extractPrinterSupplies(
  entities: readonly TransportEntityState[],
  deviceName?: string,
): PrinterSupplyItem[] {
  return entities
    .filter((item) =>
      /ink|toner|cartridge/i.test(`${item.entity_id} ${String(item.attributes.friendly_name ?? '')}`),
    )
    .map((item) => {
      const num =
        item.state.trim() && Number.isFinite(Number(item.state)) ? Number(item.state) : undefined;
      const percentage = num !== undefined && num >= 0 && num <= 100 ? Math.round(num) : undefined;
      const label = friendlyEntityLabel(item, deviceName);
      return {
        id: item.entity_id,
        label,
        percentage,
        colorHex: supplyColorHex(`${item.entity_id} ${label}`),
      };
    });
}

export interface PowerStripOutletItem<T extends TransportEntityState = TransportEntityState> {
  readonly entity: T;
  readonly isMaster: boolean;
  readonly label: string;
  readonly active: boolean;
  readonly available: boolean;
}

export function orderPowerStripOutlets<T extends TransportEntityState>(
  entities: readonly T[],
  deviceName?: string,
): PowerStripOutletItem<T>[] {
  const switches = entities.filter((item) => item.entity_id.startsWith('switch.'));
  const ordered = [
    ...switches.filter((item) => item.attributes.haus_outlet_role !== 'master'),
    ...switches.filter((item) => item.attributes.haus_outlet_role === 'master'),
  ];
  return ordered.map((entity) => {
    const isMaster = entity.attributes.haus_outlet_role === 'master';
    const available = !['unavailable', 'unknown'].includes(entity.state);
    return {
      entity,
      isMaster,
      label: isMaster ? 'All Outlets' : friendlyEntityLabel(entity, deviceName),
      active: entity.state === 'on',
      available,
    };
  });
}

export function collectHistoryEntities<T extends TransportEntityState>(entities: readonly T[]): T[] {
  return entities.filter(
    (item) =>
      /^(sensor|binary_sensor|light|switch|climate|cover|fan|lock|media_player|water_heater)\./.test(
        item.entity_id,
      ) && !/url|stream|token/i.test(item.entity_id),
  );
}
