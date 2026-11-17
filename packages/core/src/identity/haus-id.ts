/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { formatAddress, parseAddress } from './address.js';
import { isValidGlobalDomain, type GlobalDomain } from './domains.js';
import { slugifySegment } from './rewrites.js';
import { transliterateForSlug, UNASSIGNED_ROOM_ID } from './room-registry.js';

const DOMAIN_ALIASES: Readonly<Record<string, string>> = {
  lights: 'lighting',
  outlets: 'outlet',
  sensors: 'sensor',
  robotics: 'vacuum',
  lawn_mower: 'vacuum',
  water: 'appliance',
  water_heater: 'appliance',
  printers: 'x-haus-printer',
  printer: 'x-haus-printer',
  alarm_control_panel: 'alarm',
  siren: 'alarm',
  input_boolean: 'switch',
  input_button: 'button',
  valve: 'x-ha-valve',
  remote: 'x-ha-remote',
  select: 'x-ha-select',
  input_select: 'x-ha-select',
  number: 'x-ha-number',
  input_number: 'x-ha-number',
  update: 'x-ha-update',
  device_tracker: 'x-ha-device-tracker',
  weather: 'x-ha-weather',
  notify: 'x-ha-notify',
  person: 'x-ha-person',
  zone: 'x-ha-zone',
  sun: 'x-ha-sun',
  calendar: 'x-ha-calendar',
  todo: 'x-ha-todo',
};

function sanitizeRawSlug(value: string): string {
  const normalized = transliterateForSlug(
    value
      .replace(/№/g, ' ')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, ''),
  );
  const cleaned = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 128)
    .replace(/-+$/g, '');
  return cleaned;
}

/** Converts arbitrary human or system labels (including Cyrillic) into a valid kebab-case Haus segment. */
export function toHausSlug(value: string, fallback = 'item'): string {
  const cleaned = sanitizeRawSlug(value);
  if (cleaned) return cleaned;
  return sanitizeRawSlug(fallback) || slugifySegment(fallback);
}

/** Strips redundant area/device tokens from a slug when a non-empty remainder stays. */
export function stripHausSlugAffixes(slug: string, prefixes: readonly string[]): string {
  let current = slug;
  let changed = true;
  while (changed) {
    changed = false;
    for (const rawPrefix of prefixes) {
      if (!rawPrefix) continue;
      if (current.startsWith(`${rawPrefix}-`) && current.length > rawPrefix.length + 1) {
        current = current.slice(rawPrefix.length + 1);
        changed = true;
      } else if (current.endsWith(`-${rawPrefix}`) && current.length > rawPrefix.length + 1) {
        current = current.slice(0, current.length - rawPrefix.length - 1);
        changed = true;
      }
    }
  }
  return current;
}

function mapSingleDomain(raw?: string): GlobalDomain | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'other' || trimmed === 'unknown') return undefined;
  const hyphenated = sanitizeRawSlug(trimmed);
  if (!hyphenated) return undefined;
  if (isValidGlobalDomain(hyphenated)) return hyphenated;
  const underscored = trimmed.replace(/-/g, '_');
  const alias = DOMAIN_ALIASES[trimmed] ?? DOMAIN_ALIASES[underscored];
  if (alias && isValidGlobalDomain(alias)) return alias;
  const ext = hyphenated.startsWith('x-') ? hyphenated : `x-ha-${hyphenated}`;
  return isValidGlobalDomain(ext) ? ext : undefined;
}

/** Maps a Haus category or HA domain into a validated GlobalDomain (`OWNED_GLOBAL_DOMAINS` or extension). */
export function resolveGlobalDomain(
  primary?: string,
  secondary?: string,
  fallback: GlobalDomain = 'generic',
): GlobalDomain {
  return mapSingleDomain(primary) ?? mapSingleDomain(secondary) ?? fallback;
}

export interface DeriveDeviceHausAddressInput {
  readonly existingAddress?: string | null;
  readonly category?: string | null;
  readonly primaryDomain?: string | null;
  readonly areaName?: string | null;
  readonly areaId?: string | null;
  readonly deviceName?: string | null;
  readonly deviceId?: string | null;
  readonly defaultArea?: string;
}

/** Derives a canonical `type::area:device` Haus ID, preserving an existing valid address. */
export function deriveDeviceHausAddress(input: DeriveDeviceHausAddressInput): string {
  if (input.existingAddress) {
    const parsed = parseAddress(input.existingAddress);
    if (parsed) {
      return formatAddress({
        type: parsed.type,
        area: parsed.area,
        device: parsed.device,
      });
    }
  }
  const type = resolveGlobalDomain(
    input.primaryDomain ?? undefined,
    input.category ?? undefined,
    'generic',
  );
  const rawArea =
    input.areaName?.trim() ||
    (input.areaId && input.areaId !== UNASSIGNED_ROOM_ID ? input.areaId.trim() : '');
  const area = toHausSlug(rawArea || input.defaultArea || 'home', 'home');
  const rawDevice = input.deviceName?.trim() || input.deviceId?.trim() || 'device';
  const deviceSlug = toHausSlug(rawDevice, input.deviceId?.trim() || 'device');
  const stripped = stripHausSlugAffixes(deviceSlug, [area]);
  const device = stripped || deviceSlug;
  return formatAddress({ type, area, device });
}

export interface DeriveEndpointHausAddressInput {
  readonly existingAddress?: string | null;
  readonly domain?: string | null;
  readonly category?: string | null;
  readonly areaName?: string | null;
  readonly areaId?: string | null;
  readonly deviceName?: string | null;
  readonly deviceId?: string | null;
  readonly entityId?: string | null;
  readonly entityName?: string | null;
  readonly deviceAddress?: string | null;
  readonly defaultArea?: string;
}

/** Derives a canonical `type::area:device:entity` Haus ID for an entity or endpoint. */
export function deriveEndpointHausAddress(input: DeriveEndpointHausAddressInput): string {
  if (input.existingAddress) {
    const parsed = parseAddress(input.existingAddress);
    if (parsed) {
      return formatAddress(parsed);
    }
  }
  const objectId =
    input.entityId && input.entityId.includes('.')
      ? input.entityId.split('.').slice(1).join('.')
      : (input.entityId ?? '');
  const entityDomain =
    input.domain ??
    (input.entityId && input.entityId.includes('.') ? input.entityId.split('.')[0] : undefined);

  const parsedParent = input.deviceAddress ? parseAddress(input.deviceAddress) : undefined;
  const fallbackParent = parsedParent ??
    parseAddress(
      deriveDeviceHausAddress({
        category: input.category,
        primaryDomain: entityDomain,
        areaName: input.areaName,
        areaId: input.areaId,
        deviceName: input.deviceName,
        deviceId: input.deviceId || objectId || input.entityId || 'device',
        defaultArea: input.defaultArea,
      }),
    ) ?? {
      type: resolveGlobalDomain(entityDomain ?? undefined, input.category ?? undefined, 'generic'),
      area: 'home',
      device: 'device',
    };

  const type = resolveGlobalDomain(
    entityDomain ?? undefined,
    input.category ?? undefined,
    'generic',
  );
  const rawEntity = objectId.trim() || input.entityName?.trim() || 'endpoint';
  const entitySlug = toHausSlug(rawEntity, 'endpoint');
  const redundantTokens = [
    fallbackParent.area,
    ...(input.areaId && input.areaId !== UNASSIGNED_ROOM_ID
      ? [toHausSlug(input.areaId)]
      : [UNASSIGNED_ROOM_ID]),
    fallbackParent.device,
  ].filter(Boolean);
  const trimmedEntity = stripHausSlugAffixes(entitySlug, redundantTokens);
  const isRedundantRemainder =
    trimmedEntity === fallbackParent.device ||
    trimmedEntity === UNASSIGNED_ROOM_ID ||
    trimmedEntity === fallbackParent.area;
  return formatAddress({
    type,
    area: fallbackParent.area,
    device: fallbackParent.device,
    ...(trimmedEntity && !isRedundantRemainder ? { entity: trimmedEntity } : {}),
  });
}
