/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { formatAddress, parseAddress, type Address } from './address.js';

/**
 * Canonical global domains owned by the Haus core domain model.
 */
export const OWNED_GLOBAL_DOMAINS = [
  'light',
  'lighting',
  'switch',
  'power',
  'outlet',
  'climate',
  'thermostat',
  'fan',
  'humidifier',
  'cover',
  'covers',
  'lock',
  'security',
  'alarm',
  'camera',
  'cameras',
  'media',
  'media-player',
  'speaker',
  'appliance',
  'appliances',
  'vacuum',
  'sensor',
  'binary-sensor',
  'occupancy-sensor',
  'occupancy-sensors',
  'environmental-sensor',
  'environmental-sensors',
  'safety-sensor',
  'safety-sensors',
  'energy',
  'energy-meter',
  'energy-meters',
  'network',
  'compute',
  'storage',
  'button',
  'event',
  'scene',
  'script',
  'automation',
  'group',
  'generic',
] as const;

export type OwnedGlobalDomain = (typeof OWNED_GLOBAL_DOMAINS)[number];
export type ExtensionDomain = `x-${string}-${string}`;
export type GlobalDomain = OwnedGlobalDomain | ExtensionDomain;

const ownedDomainSet: ReadonlySet<string> = new Set<string>(OWNED_GLOBAL_DOMAINS);

/**
 * Vendor/App extension domains must start with `x-<vendor>-<name>` in kebab-case
 * (at least two segments after `x-`) so they can never collide with owned global domains.
 */
const EXTENSION_DOMAIN_REGEX = /^x-[a-z0-9]+(?:-[a-z0-9]+)+$/;

export function isOwnedDomain(value: unknown): value is OwnedGlobalDomain {
  return typeof value === 'string' && ownedDomainSet.has(value);
}

export function isExtensionDomain(value: unknown): value is ExtensionDomain {
  return typeof value === 'string' && value.length <= 128 && EXTENSION_DOMAIN_REGEX.test(value);
}

export function isValidGlobalDomain(value: unknown): value is GlobalDomain {
  return isOwnedDomain(value) || isExtensionDomain(value);
}

export function classifyDomain(value: unknown): 'owned' | 'extension' | 'invalid' {
  if (isOwnedDomain(value)) return 'owned';
  if (isExtensionDomain(value)) return 'extension';
  return 'invalid';
}

export function assertValidGlobalDomain(value: unknown): asserts value is GlobalDomain {
  if (!isValidGlobalDomain(value)) {
    throw new Error('invalid_global_domain');
  }
}

/**
 * Parses an address and validates that its `type` segment is either an owned
 * Haus global domain or a well-formed `x-<vendor>-<domain>` extension domain.
 */
export function parseDomainAddress(value: unknown): Address | undefined {
  const parsed = parseAddress(value);
  if (!parsed) return undefined;
  if (!isValidGlobalDomain(parsed.type)) return undefined;
  return parsed;
}

/**
 * Formats an Address and enforces that `address.type` is a valid owned or extension domain.
 */
export function formatDomainAddress(address: Address): string {
  assertValidGlobalDomain(address.type);
  return formatAddress(address);
}
