/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  deriveDeviceHausAddress,
  deriveEndpointHausAddress,
  parseAddress,
  resolveGlobalDomain,
  toHausSlug,
} from '../../src/identity/index.js';

describe('Haus-style canonical device and endpoint IDs', () => {
  it('transliterates Cyrillic and non-ASCII names into valid kebab-case slugs', () => {
    expect(toHausSlug('Гостиная')).toBe('gostinaya');
    expect(toHausSlug('Спальня — Потолок №1')).toBe('spalnya-potolok-1');
    expect(toHausSlug('Küchen Café Lamp')).toBe('kuchen-cafe-lamp');
    expect(toHausSlug('   ', 'fallback-id')).toBe('fallback-id');
  });

  it('maps HA domains and Haus categories onto valid GlobalDomains', () => {
    expect(resolveGlobalDomain('light')).toBe('light');
    expect(resolveGlobalDomain('lights')).toBe('lighting');
    expect(resolveGlobalDomain('outlets')).toBe('outlet');
    expect(resolveGlobalDomain('binary_sensor')).toBe('binary-sensor');
    expect(resolveGlobalDomain('water_heater')).toBe('appliance');
    expect(resolveGlobalDomain('printers')).toBe('x-haus-printer');
    expect(resolveGlobalDomain('custom_widget')).toBe('x-ha-custom-widget');
  });

  it('derives device Haus IDs stripping redundant room prefixes', () => {
    expect(
      deriveDeviceHausAddress({
        category: 'lights',
        areaName: 'Bedroom',
        areaId: 'bedroom',
        deviceName: 'Bedroom Ceiling Lamp',
        deviceId: 'dev_1',
      }),
    ).toBe('lighting::bedroom:ceiling-lamp');

    expect(
      deriveDeviceHausAddress({
        category: 'sensors',
        areaName: 'Прихожая',
        areaId: 'prikhozhaya',
        deviceName: 'Прихожая Датчик движения',
        deviceId: 'motion_1',
      }),
    ).toBe('sensor::prikhozhaya:datchik-dvizheniya');

    expect(
      deriveDeviceHausAddress({
        category: 'outlets',
        deviceName: 'Desk Lamp',
        deviceId: 'plug_1',
      }),
    ).toBe('outlet::home:desk-lamp');
  });

  it('preserves authoritative Hub addresses when valid and derives endpoint IDs cleanly', () => {
    expect(
      deriveDeviceHausAddress({
        existingAddress: 'lighting::master-suite:floor-lamp',
        category: 'lights',
        areaName: 'Living Room',
        deviceName: 'Other Name',
      }),
    ).toBe('lighting::master-suite:floor-lamp');

    const deviceAddr = 'lighting::bedroom:ceiling-lamp';
    expect(
      deriveEndpointHausAddress({
        domain: 'light',
        entityId: 'light.bedroom_ceiling_lamp',
        deviceAddress: deviceAddr,
      }),
    ).toBe('light::bedroom:ceiling-lamp');

    expect(
      deriveEndpointHausAddress({
        category: 'lighting',
        areaId: 'unassigned',
        entityId: 'light.unassigned_table_lamp',
        deviceAddress: 'lighting::home:table-lamp',
      }),
    ).toBe('light::home:table-lamp');

    expect(
      deriveEndpointHausAddress({
        domain: 'sensor',
        entityId: 'sensor.bedroom_ceiling_lamp_power',
        deviceAddress: deviceAddr,
      }),
    ).toBe('sensor::bedroom:ceiling-lamp:power');

    expect(parseAddress('sensor::bedroom:ceiling-lamp:power')).toEqual({
      type: 'sensor',
      area: 'bedroom',
      device: 'ceiling-lamp',
      entity: 'power',
    });
  });
});
