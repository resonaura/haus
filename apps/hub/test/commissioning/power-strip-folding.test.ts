/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import type { HaEntitySnapshot, HaRuntimeEntity } from '@haus/kitsune';
import { HaIntegrationEntities } from '../../src/commissioning/ha-flow/entities.js';
import { StandaloneHomeService } from '../../src/home/home.service.js';

describe('Power strip sub-device folding & orphan pruning', () => {
  it('prunes persisted orphan power-strip sub-devices once folded into the physical parent device', async () => {
    const home = new StandaloneHomeService();
    home.registerDevice({
      id: 'ha:meross-entry:channel-2',
      name: 'Power strip Channel 2',
      roomId: 'unassigned',
      category: 'power',
      availability: 'online',
      connectivity: { protocol: 'ha' },
      source: { instanceId: 'ha:meross-entry', externalId: 'channel-2' },
      endpoints: [
        {
          id: 'switch.strip_wall_garland',
          name: 'Wall Garland',
          category: 'power',
          capabilities: [
            {
              id: 'on_off',
              kind: 'binary',
              readable: true,
              operations: ['set', 'turn_on', 'turn_off'],
              deviceClass: 'outlet',
            },
          ],
          readings: {},
        },
      ],
    });
    await home.updateEndpointState('switch.strip_wall_garland', { power: true }, false);

    const foldedEntities: HaRuntimeEntity[] = [
      {
        entityId: 'switch.strip_power',
        entryId: 'meross-entry',
        integration: 'meross_lan',
        uniqueId: 'strip_0',
        name: 'Bedroom Desk Surge Protector Power',
        domain: 'switch',
        state: 'on',
        attributes: { device_class: 'outlet' },
        deviceId: 'parent-strip',
        deviceName: 'Bedroom Desk Surge Protector',
        manufacturer: 'Meross',
        model: 'mss425f-eu',
      },
      {
        entityId: 'switch.strip_wall_garland',
        entryId: 'meross-entry',
        integration: 'meross_lan',
        uniqueId: 'strip_2',
        name: 'Bedroom Desk Surge Protector Wall Garland',
        domain: 'switch',
        state: 'on',
        attributes: { device_class: 'outlet' },
        deviceId: 'parent-strip',
        deviceName: 'Bedroom Desk Surge Protector',
        manufacturer: 'Meross',
        model: 'mss425f-eu',
      },
      {
        entityId: 'switch.strip_usb',
        entryId: 'meross-entry',
        integration: 'meross_lan',
        uniqueId: 'strip_5',
        name: 'Bedroom Desk Surge Protector USB',
        domain: 'switch',
        state: 'off',
        attributes: { device_class: 'outlet' },
        deviceId: 'parent-strip',
        deviceName: 'Bedroom Desk Surge Protector',
        manufacturer: 'Meross',
        model: 'mss425f-eu',
      },
    ];
    const runtime = {
      setupEntry: vi.fn(async () => ({ ok: true })),
      entitySnapshot: vi.fn(async (): Promise<HaEntitySnapshot> => ({
        entities: foldedEntities,
        events: [],
        sequence: 1,
        entries: [{ entryId: 'meross-entry', state: 'loaded' }],
      })),
      entityCommand: vi.fn(async () => ({ ok: true })),
      unloadEntry: vi.fn(async () => ({ ok: true })),
    };
    const entities = new HaIntegrationEntities(home);
    try {
      entities.sync(runtime, [
        { entryId: 'meross-entry', domain: 'meross_lan', title: 'Meross', data: {} },
      ]);
      await vi.waitFor(() => {
        expect(home.getDevice('ha:meross-entry:channel-2')).toBeUndefined();
        expect(home.getDevice('ha:meross-entry:parent-strip')).toBeDefined();
      });
      const parent = home.getDevice('ha:meross-entry:parent-strip');
      expect(parent?.deviceType).toBe('power_strip');
      expect(parent?.endpoints.map((ep) => ep.id)).toEqual([
        'switch.strip_power',
        'switch.strip_wall_garland',
        'switch.strip_usb',
      ]);
      expect(home.getEndpointProperty('switch.strip_wall_garland', 'power')).toBe(true);
    } finally {
      await entities.close();
    }
  }, 15_000);
});
