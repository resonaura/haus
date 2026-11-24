/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  buildInventoryRecords,
  classifyInventoryStatus,
  countInventoryByFilter,
  filterInventoryDevices,
  scopeInventoryDevices,
  type InventoryDeviceSummary,
} from '../../src/transport/index.js';

describe('@haus/core transport inventory helpers', () => {
  it('classifies device statuses across all 5 states', () => {
    expect(
      classifyInventoryStatus({
        disabled: true,
        totalEntities: 2,
        enabledEntities: 2,
        entityStates: ['on'],
      }),
    ).toBe('disabled');
    expect(
      classifyInventoryStatus({
        disabled: false,
        totalEntities: 3,
        enabledEntities: 0,
        entityStates: [],
      }),
    ).toBe('disabled');
    expect(
      classifyInventoryStatus({
        disabled: false,
        totalEntities: 1,
        enabledEntities: 1,
        entityStates: [],
      }),
    ).toBe('no_entities');
    expect(
      classifyInventoryStatus({
        disabled: false,
        totalEntities: 2,
        enabledEntities: 2,
        entityStates: ['unavailable', 'unavailable'],
      }),
    ).toBe('unavailable');
    expect(
      classifyInventoryStatus({
        disabled: false,
        totalEntities: 2,
        enabledEntities: 2,
        entityStates: ['unknown', 'unavailable'],
      }),
    ).toBe('unknown');
    expect(
      classifyInventoryStatus({
        disabled: false,
        totalEntities: 2,
        enabledEntities: 2,
        entityStates: ['on', 'unavailable'],
      }),
    ).toBe('available');
  });

  it('scopes, filters, and counts registered device inventory summaries', () => {
    const items: InventoryDeviceSummary[] = [
      {
        id: 'dev-1',
        hausId: 'network::eero',
        name: 'Eero Gateway',
        manufacturer: 'eero',
        model: 'Pro 6E',
        areaId: 'living',
        category: 'network',
        status: 'available',
        entityCount: 4,
        activeEntityCount: 4,
      },
      {
        id: 'dev-2',
        hausId: 'printers::bambu',
        name: 'Bambu X1C',
        manufacturer: 'Bambu Lab',
        model: 'X1C',
        category: 'printers',
        status: 'unavailable',
        entityCount: 5,
        activeEntityCount: 5,
      },
      {
        id: 'dev-3',
        hausId: 'other::bridge',
        name: 'Hue Bridge',
        manufacturer: 'Signify',
        model: 'BSB002',
        areaId: 'living',
        category: 'other',
        status: 'no_entities',
        entityCount: 0,
        activeEntityCount: 0,
      },
    ];

    expect(scopeInventoryDevices(items, { area: 'living', query: '' }).map((d) => d.id)).toEqual([
      'dev-1',
      'dev-3',
    ]);
    expect(scopeInventoryDevices(items, { area: 'unassigned', query: '' }).map((d) => d.id)).toEqual([
      'dev-2',
    ]);
    expect(scopeInventoryDevices(items, { area: 'all', query: 'signify' }).map((d) => d.id)).toEqual([
      'dev-3',
    ]);

    expect(filterInventoryDevices(items, 'network').map((d) => d.id)).toEqual(['dev-1']);
    expect(filterInventoryDevices(items, 'printers').map((d) => d.id)).toEqual(['dev-2']);
    expect(filterInventoryDevices(items, 'unavailable').map((d) => d.id)).toEqual(['dev-2']);
    expect(filterInventoryDevices(items, 'no_entities').map((d) => d.id)).toEqual(['dev-3']);

    expect(countInventoryByFilter(items)).toEqual({
      all: 3,
      network: 1,
      printers: 1,
      unavailable: 1,
      no_entities: 1,
    });
  });

  it('builds sorted inventory records with alias collapsing, heuristics, and app filtering', () => {
    const devices = [
      { id: 'd-printer', name: 'Office Laser', manufacturer: 'Brother', model: 'HL-L2350', area_id: null },
      { id: 'd-router', name: 'Main Router', manufacturer: 'eero', model: 'Pro 6', area_id: 'living' },
      { id: 'd-alias', name: 'Matter Duplicate', manufacturer: 'Matter', model: 'Bridge', area_id: 'living' },
      { id: 'd-app', name: 'Haus App Service', manufacturer: 'Home Assistant', model: 'Home Assistant App' },
      { id: 'd-disabled', name: 'Old Plug', manufacturer: 'Hue', model: 'Plug', disabled_by: 'user' },
    ];
    const entities = [
      { entity_id: 'sensor.printer_status', device_id: 'd-printer', platform: 'ipp' },
      { entity_id: 'sensor.router_wan', device_id: 'd-router', platform: 'generic' },
      { entity_id: 'sensor.alias_entity', device_id: 'd-alias', platform: 'matter' },
      { entity_id: 'switch.old_plug', device_id: 'd-disabled', platform: 'hue' },
    ];
    const states = [
      { entity_id: 'sensor.printer_status', state: 'unavailable' },
      { entity_id: 'sensor.router_wan', state: 'connected' },
      { entity_id: 'switch.old_plug', state: 'off' },
    ];
    const effective = new Map(
      entities.map((entry) => [
        entry.entity_id,
        entry.entity_id === 'sensor.alias_entity' ? { ...entry, device_id: 'd-router' } : entry,
      ]),
    );

    const records = buildInventoryRecords({
      devices,
      entities,
      states,
      accessories: [],
      effectiveEntities: effective.values(),
      resolveEffectiveEntity: (id) => effective.get(id),
    });

    expect(records.map((r) => [r.name, r.category, r.status, r.entityCount, r.activeEntityCount])).toEqual([
      ['Main Router', 'network', 'available', 2, 1],
      ['Office Laser', 'printers', 'unavailable', 1, 1],
      ['Old Plug', 'other', 'disabled', 1, 1],
    ]);
  });
});
