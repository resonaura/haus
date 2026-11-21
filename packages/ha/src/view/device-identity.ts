/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Device, HassEntity } from './types.js';
export const isServiceRoom = (name: string) =>
  /^(?:system|home assistant|homeassistant|services?|infrastructure)$/i.test(name.trim());
export const isVirtualDevice = (device?: Device) =>
  /^(?:integration|home assistant app|homebridge|service|add-on|addon)$/i.test(
    String(device?.model ?? '').trim(),
  ) ||
  /\b(?:2mqtt|to\s+mqtt|mqtt\s+bridge)\b/i.test(`${device?.model ?? ''} ${device?.name ?? ''}`);
export const isPhysicalHub = (device?: Device) =>
  !isVirtualDevice(device) &&
  !device?.management_url &&
  !/camera|nest/i.test(String(device?.model ?? '')) &&
  /(?:hub|bridge|gateway)/i.test(`${device?.model ?? ''}`);

const NETWORK_TYPES = new Set([
  'router',
  'network_switch',
  'repeater',
  'access_point',
  'modem',
  'firewall',
  'nas',
]);
const NETWORK_PLATFORMS = new Set(['eero', 'unifi', 'asuswrt', 'upnp', 'fritz', 'generic_network']);

export function resolveDeviceType(device?: Device, entity?: HassEntity): string | undefined {
  if (typeof device?.device_type === 'string' && device.device_type) return device.device_type;
  const attr = entity?.attributes?.haus_device_type;
  return typeof attr === 'string' && attr ? attr : undefined;
}

export function resolveManagementUrl(device?: Device, entity?: HassEntity): string | undefined {
  if (typeof device?.management_url === 'string' && device.management_url)
    return device.management_url;
  const attr = entity?.attributes?.haus_management_url;
  return typeof attr === 'string' && attr ? attr : undefined;
}

export function isNetworkDevice(
  device: Device | undefined,
  entity: HassEntity | undefined,
  platforms: readonly (string | null | undefined)[],
  context: string,
): boolean {
  const deviceType = resolveDeviceType(device, entity);
  return (
    device?.category === 'network' ||
    Boolean(resolveManagementUrl(device, entity)) ||
    (deviceType !== undefined && NETWORK_TYPES.has(deviceType)) ||
    platforms.some((platform) => NETWORK_PLATFORMS.has(platform ?? '')) ||
    /\b(?:router|eero|ubiquiti|mikrotik|netgear)\b/i.test(context)
  );
}
export const isButtonController = (device?: Device) =>
  /(?:tap dial|dimmer switch|smart button|remote control|wireless switch|ylkg0[78])/i.test(
    `${device?.model ?? ''}`,
  );
/** A clock's two integrations can describe the exact same physical object. Never join by room alone. */
export function clockDeviceAliases(devices: Device[]) {
  const groups = new Map<string, Device[]>();
  for (const device of devices) {
    const name = String(device.name_by_user || device.name || '')
      .trim()
      .toLowerCase();
    if (!device.area_id || !/\b(?:clock|nixie)\b/.test(`${name} ${device.model ?? ''}`)) continue;
    const key = `${device.area_id}:${name}`;
    groups.set(key, [...(groups.get(key) ?? []), device]);
  }
  const aliases = new Map<string, string>();
  for (const items of groups.values())
    if (items.length === 2) {
      const owner = items.find((item) => /clock|nixie/i.test(String(item.model)));
      if (owner) for (const item of items) aliases.set(item.id, owner.id);
    }
  return aliases;
}

export * from './identity/haus-id.js';
