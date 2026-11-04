/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it } from 'vitest';
import { createMobileDashboardProjection } from '../src/home/mobile-dashboard';
import { sanitizePreferences } from '@haus/ha/view/preferences';
import type { HassEntity, Snapshot } from '@haus/ha/types';

const entity = (
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: '2026-11-03T16:00:00Z',
});
function snapshot(): Snapshot {
  return {
    config: { location_name: 'Home' },
    user: { name: 'User', is_admin: true },
    services: { climate: { set_hvac_mode: {} }, light: { turn_on: {} } },
    areas: [{ area_id: 'narnia', name: 'Narnia' }],
    devices: [
      { id: 'hvac', name: 'Air conditioner', area_id: 'narnia' },
      { id: 'temperature', name: 'Temperature', area_id: 'narnia' },
      { id: 'camera', name: 'Camera', area_id: 'narnia' },
      { id: 'lamp', name: 'Lamp', area_id: 'narnia' },
    ],
    entities: [
      { entity_id: 'climate.narnia', device_id: 'hvac' },
      { entity_id: 'switch.narnia_turbo', device_id: 'hvac' },
      { entity_id: 'sensor.temperature', device_id: 'temperature' },
      { entity_id: 'camera.source', device_id: 'camera' },
      { entity_id: 'camera.haus_proxy', device_id: 'camera', platform: 'haus' },
      { entity_id: 'sensor.camera_diagnostic', device_id: 'camera', entity_category: 'diagnostic' },
      { entity_id: 'light.lamp', device_id: 'lamp' },
    ],
    states: [
      entity('climate.narnia', 'cool', {
        current_temperature: 22.5,
        friendly_name: 'Air conditioner',
      }),
      entity('switch.narnia_turbo', 'off', { friendly_name: 'Turbo' }),
      entity('sensor.temperature', '21.3999996185303', {
        friendly_name: 'Temperature',
        device_class: 'temperature',
        unit_of_measurement: '°C',
      }),
      entity('camera.source', 'unavailable', { friendly_name: 'Camera' }),
      entity('camera.haus_proxy', 'idle', { haus_camera_proxy: 1, friendly_name: 'Camera proxy' }),
      entity('sensor.camera_diagnostic', '0'),
      entity('light.lamp', 'off', { friendly_name: 'Lamp' }),
      entity('scene.night', 'scening', { friendly_name: 'Night' }),
    ],
  };
}

it('renders physical devices and scenes, preserves offline cameras, and filters proxies and diagnostic entities', () => {
  const sections = createMobileDashboardProjection()(snapshot());
  const devices = sections.find((section) => section.key === 'narnia')!.data;
  expect(devices.map((item) => item.name)).toEqual(
    expect.arrayContaining(['Air conditioner', 'Temperature', 'Camera', 'Lamp']),
  );
  expect(devices).toHaveLength(4);
  expect(devices.find((item) => item.name === 'Camera')).toMatchObject({ available: false });
  expect(devices.find((item) => item.name === 'Temperature')?.state).toBe('21.4°C');
  expect(sections.find((section) => section.key === 'scenes')?.data[0]).toMatchObject({
    name: 'Night',
    kind: 'scene',
  });
});

it('uses desktop Home hiding, favorites and room order without changing HA data', () => {
  const input = snapshot();
  const before = JSON.stringify(input);
  const project = createMobileDashboardProjection();
  const original = project(input).find((section) => section.key === 'narnia')!.data;
  const lamp = original.find((item) => item.name === 'Lamp')!;
  const changed = project(
    input,
    sanitizePreferences({
      hiddenHome: ['sensor.temperature'],
      hiddenApp: ['scene.night'],
      favorites: ['light.lamp'],
      deviceOrder: { 'home:room:narnia': [lamp.id] },
    }),
  );
  expect(changed.map((section) => section.key)).toEqual(['narnia']);
  expect(changed[0]!.data.map((item) => item.name)).not.toContain('Temperature');
  expect(changed[0]!.data[0]).toMatchObject({ name: 'Lamp', favorite: true });
  expect(JSON.stringify(input)).toBe(before);
});

it('keeps Home-only hidden devices in their room and excludes app-hidden items from navigation', () => {
  const input = snapshot();
  const project = createMobileDashboardProjection();
  const preferences = sanitizePreferences({
    hiddenHome: ['sensor.temperature'],
    hiddenApp: ['light.lamp', 'scene.night'],
  });
  expect(project(input, preferences, 'rooms')[0]?.data[0]).toMatchObject({
    id: 'narnia',
    kind: 'room',
  });
  const devices = project(input, preferences, 'rooms', 'narnia').flatMap((section) => section.data);
  expect(devices.map((item) => item.name)).toContain('Temperature');
  expect(devices.map((item) => item.name)).not.toContain('Lamp');
  expect(project(input, preferences, 'scenes')).toEqual([]);
});

it('keeps unchanged rows and sections referentially stable across unrelated state emissions', () => {
  const input = snapshot();
  const project = createMobileDashboardProjection();
  const first = project(input);
  const same = structuredClone(input);
  same.states.find((item) => item.entity_id === 'sensor.camera_diagnostic')!.state = '1';
  expect(project(same)).toBe(first);
  same.states.find((item) => item.entity_id === 'sensor.temperature')!.state = '24.5';
  const changed = project(same);
  const byName = (sections: typeof first, name: string) =>
    sections.flatMap((section) => section.data).find((item) => item.name === name);
  expect(byName(changed, 'Temperature')).not.toBe(byName(first, 'Temperature'));
  expect(byName(changed, 'Air conditioner')).toBe(byName(first, 'Air conditioner'));
  expect(changed[0]).toBe(first[0]);
});
