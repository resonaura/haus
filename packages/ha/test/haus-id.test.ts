/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { parseAddress } from '@haus/core/identity';
import type { Snapshot } from '../src/types.js';
import { normalizeHome } from '../src/view/normalize.js';
import { resolveDeviceHausId, resolveEntityHausId } from '../src/view/device-identity.js';

function baseSnapshot(): Snapshot {
  return {
    areas: [
      { area_id: 'bedroom', name: 'Спальня' },
      { area_id: 'kitchen', name: 'Kitchen' },
    ],
    devices: [
      { id: 'd-lamp-1', name: 'Ceiling Lamp', area_id: 'bedroom' },
      { id: 'd-lamp-2', name: 'Ceiling Lamp', area_id: 'bedroom' },
      {
        id: 'd-hub',
        name: 'Table Lamp',
        area_id: 'kitchen',
        haus_id: 'lighting::kitchen:hub-lamp',
      },
      { id: 'd-sensor-only', name: 'Leak Sensor', area_id: 'kitchen' },
    ],
    entities: [
      { entity_id: 'light.bedroom_ceiling_lamp', device_id: 'd-lamp-1' },
      { entity_id: 'sensor.bedroom_ceiling_lamp_power', device_id: 'd-lamp-1' },
      { entity_id: 'light.bedroom_ceiling_lamp_2', device_id: 'd-lamp-2' },
      {
        entity_id: 'light.kitchen_table_lamp',
        device_id: 'd-hub',
        haus_id: 'light::kitchen:hub-lamp',
      },
      { entity_id: 'binary_sensor.kitchen_leak', device_id: 'd-sensor-only' },
    ],
    states: [
      {
        entity_id: 'light.bedroom_ceiling_lamp',
        state: 'on',
        attributes: { friendly_name: 'Ceiling Lamp' },
      },
      {
        entity_id: 'sensor.bedroom_ceiling_lamp_power',
        state: '12.5',
        attributes: { friendly_name: 'Ceiling Lamp Power', unit_of_measurement: 'W' },
      },
      {
        entity_id: 'light.bedroom_ceiling_lamp_2',
        state: 'off',
        attributes: { friendly_name: 'Ceiling Lamp' },
      },
      {
        entity_id: 'light.kitchen_table_lamp',
        state: 'on',
        attributes: { friendly_name: 'Table Lamp' },
      },
      {
        entity_id: 'binary_sensor.kitchen_leak',
        state: 'off',
        attributes: { friendly_name: 'Leak Sensor', device_class: 'moisture' },
      },
      {
        entity_id: 'light.standalone_porch',
        state: 'off',
        attributes: { friendly_name: 'Porch Light' },
      },
    ],
    services: {},
    config: { location_name: 'Haus' },
    user: { name: 'Tester', is_admin: true },
  };
}

describe('normalizeHome Haus ID assignment', () => {
  it('assigns unique valid Haus IDs for Cyrillic rooms, duplicate devices, secondary entities, and Hub overrides', () => {
    const snapshot = baseSnapshot();
    const model = normalizeHome(snapshot);

    expect(model.accessories.length).toBeGreaterThanOrEqual(5);
    const seenDeviceIds = new Set<string>();
    const seenEntityIds = new Set<string>();

    for (const acc of model.accessories) {
      expect(acc.hausId).toBeTruthy();
      expect(parseAddress(acc.hausId!)).toBeTruthy();
      expect(seenDeviceIds.has(acc.hausId!)).toBe(false);
      seenDeviceIds.add(acc.hausId!);

      const eids = new Set([
        acc.primaryEntityId,
        ...acc.entityIds,
        ...acc.secondaryEntities.map((s) => s.entity_id),
      ]);
      for (const eid of eids) {
        const ehid = acc.entityHausIds?.[eid];
        expect(ehid).toBeTruthy();
        expect(parseAddress(ehid!)).toBeTruthy();
        expect(seenEntityIds.has(ehid!)).toBe(false);
        seenEntityIds.add(ehid!);
      }
    }

    const lamp1 = model.accessories.find((a) => a.deviceId === 'd-lamp-1')!;
    const lamp2 = model.accessories.find((a) => a.deviceId === 'd-lamp-2')!;
    const hub = model.accessories.find((a) => a.deviceId === 'd-hub')!;
    const standalone = model.accessories.find(
      (a) => a.primaryEntityId === 'light.standalone_porch',
    )!;

    expect(lamp1.hausId).toBe('light::spalnya:ceiling-lamp');
    expect(lamp1.entityHausIds?.['light.bedroom_ceiling_lamp']).toBe('light::spalnya:ceiling-lamp');
    expect(lamp1.entityHausIds?.['sensor.bedroom_ceiling_lamp_power']).toBe(
      'sensor::spalnya:ceiling-lamp:power',
    );

    expect(lamp2.hausId).toBe('light::spalnya:ceiling-lamp-2');
    expect(hub.hausId).toBe('lighting::kitchen:hub-lamp');
    expect(hub.entityHausIds?.['light.kitchen_table_lamp']).toBe('light::kitchen:hub-lamp');
    expect(standalone.hausId).toBe('light::home:porch-light');
  });

  it('resolves standalone device and entity Haus IDs directly from a snapshot', () => {
    const snapshot = baseSnapshot();
    const sensorDevice = snapshot.devices.find((d) => d.id === 'd-sensor-only')!;
    expect(resolveDeviceHausId(sensorDevice, snapshot)).toBe('binary-sensor::kitchen:leak-sensor');
    expect(resolveEntityHausId('binary_sensor.kitchen_leak', snapshot)).toBe(
      'binary-sensor::kitchen:leak-sensor:leak',
    );
  });
});
