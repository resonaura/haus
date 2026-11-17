/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { parseDevices } from '../types.js';
import { buildView } from '../entities.js';
import { normalizeHome } from '@haus/ha/view/normalize';
import type { Snapshot } from '@haus/ha/types';

describe('Desktop Hub CompatView Haus ID propagation', () => {
  it('parses Hub device and endpoint addresses into CompatView haus_id and preserves them through normalizeHome', () => {
    const parsed = parseDevices({
      devices: [
        {
          id: 'dev_hall_light',
          address: 'lighting::prikhozhaya:ceiling-lamp',
          name: 'Потолочная лампа',
          category: 'lighting',
          roomId: 'prikhozhaya',
          availability: 'online',
          endpoints: [
            {
              id: 'ep_light',
              address: 'light::prikhozhaya:ceiling-lamp',
              name: 'Main Light',
              capabilities: [{ id: 'on_off', kind: 'binary', operations: ['turn_on', 'turn_off'] }],
            },
            {
              id: 'ep_power',
              address: 'sensor::prikhozhaya:ceiling-lamp:power',
              name: 'Power',
              capabilities: [{ id: 'power', kind: 'numeric', operations: [], unit: 'W' }],
            },
          ],
        },
        {
          id: 'dev_invalid_addr',
          address: 'not a valid haus address',
          name: 'Porch Outlet',
          category: 'outlet',
          roomId: 'porch',
          availability: 'online',
          endpoints: [
            {
              id: 'ep_outlet',
              address: 'bad:::',
              name: 'Outlet',
              capabilities: [{ id: 'on_off', kind: 'binary', operations: ['turn_on'] }],
            },
          ],
        },
      ],
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0].address).toBe('lighting::prikhozhaya:ceiling-lamp');
    expect(parsed[0].endpoints[0].address).toBe('light::prikhozhaya:ceiling-lamp');
    expect(parsed[0].endpoints[1].address).toBe('sensor::prikhozhaya:ceiling-lamp:power');
    expect(parsed[1].address).toBeUndefined();
    expect(parsed[1].endpoints[0].address).toBeUndefined();

    const view = buildView(
      parsed,
      {
        ep_light: { state: 'on', updatedAt: Date.now() },
        ep_power: { state: '14', updatedAt: Date.now() },
        ep_outlet: { state: 'off', updatedAt: Date.now() },
      },
      '2026-11-14T10:00:00Z',
      [],
      [{ id: 'prikhozhaya', name: 'Прихожая' }],
    );

    expect(view.devices.find((d) => d.id === 'dev_hall_light')?.haus_id).toBe(
      'lighting::prikhozhaya:ceiling-lamp',
    );
    expect(
      view.entities.find(
        (e) => e.device_id === 'dev_hall_light' && e.unique_id === 'ep_light:on_off',
      )?.haus_id,
    ).toBe('light::prikhozhaya:ceiling-lamp');

    const snapshot: Snapshot = {
      states: view.states as Snapshot['states'],
      areas: view.areas.map((a) => ({ area_id: String(a.area_id), name: String(a.name) })),
      devices: view.devices.map((d) => ({
        ...d,
        id: String(d.id),
        haus_id: typeof d.haus_id === 'string' ? d.haus_id : undefined,
      })),
      entities: view.entities as Snapshot['entities'],
      services: {},
      config: { location_name: 'Haus Hub' },
      user: { name: 'Admin', is_admin: true },
    };
    const model = normalizeHome(snapshot);

    const hallLamp = model.accessories.find((a) => a.deviceId === 'dev_hall_light');
    expect(hallLamp?.hausId).toBe('lighting::prikhozhaya:ceiling-lamp');
    expect(hallLamp?.entityHausIds?.['light.dev_hall_light']).toBe(
      'light::prikhozhaya:ceiling-lamp',
    );
    expect(hallLamp?.entityHausIds?.['sensor.dev_hall_light']).toBe(
      'sensor::prikhozhaya:ceiling-lamp:power',
    );

    const porchOutlet = model.accessories.find((a) => a.deviceId === 'dev_invalid_addr');
    expect(porchOutlet?.hausId).toBe('switch::porch:outlet');
  });
});
