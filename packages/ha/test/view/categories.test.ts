/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  accessoriesForCategory,
  accessoryCategories,
  accessoryMatchesCategory,
  projectAccessoryEntity,
  projectAccessoryForCategory,
} from '../../src/view/categories.js';
import { buildHomeView, roomTemperatureFor } from '../../src/view/home-view.js';
import { normalizeHome } from '../../src/view/normalize.js';
import { defaults } from '../../src/view/preferences.js';
import { describeAccessory } from '../../src/view/presentation.js';
import { visibilityTarget } from '../../src/view/visibility.js';
import type { HassEntity, Snapshot } from '../../src/view/types.js';

const entity = (
  entity_id: string,
  state = 'on',
  attributes: Record<string, unknown> = {},
): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: '2026-11-21T12:00:00Z',
});

function baseSnapshot(): Snapshot {
  return {
    config: { location_name: 'Haus', unit_system: { temperature: '°C' } },
    user: { name: 'Admin', is_admin: true },
    areas: [
      { area_id: 'hallway', name: 'Hallway' },
      { area_id: 'bedroom', name: 'Bedroom' },
      { area_id: 'kitchen', name: 'Kitchen' },
      { area_id: 'garage', name: 'Garage' },
    ],
    devices: [],
    entities: [],
    states: [],
    services: {
      light: { turn_on: {}, turn_off: {}, toggle: {} },
      fan: { turn_on: {}, turn_off: {}, toggle: {}, set_percentage: {} },
      switch: { turn_on: {}, turn_off: {}, toggle: {} },
      cover: { open_cover: {}, close_cover: {}, stop_cover: {} },
    },
  };
}

describe('multi-characteristic device categorization', () => {
  it('surfaces a motion sensor with ambient temperature and illuminance in climate and sensors lenses', () => {
    const snapshot = baseSnapshot();
    snapshot.devices.push({ id: 'hue_motion', name: 'Hallway Motion', area_id: 'hallway' });
    snapshot.entities.push(
      { entity_id: 'binary_sensor.hallway_motion', device_id: 'hue_motion' },
      { entity_id: 'sensor.hallway_temperature', device_id: 'hue_motion' },
      { entity_id: 'sensor.hallway_humidity', device_id: 'hue_motion' },
      { entity_id: 'sensor.hallway_illuminance', device_id: 'hue_motion' },
      {
        entity_id: 'sensor.hallway_battery',
        device_id: 'hue_motion',
        entity_category: 'diagnostic',
      },
    );
    snapshot.states.push(
      entity('binary_sensor.hallway_motion', 'off', {
        device_class: 'motion',
        friendly_name: 'Hallway Motion',
      }),
      entity('sensor.hallway_temperature', '21.4', {
        device_class: 'temperature',
        unit_of_measurement: '°C',
        friendly_name: 'Hallway Temperature',
      }),
      entity('sensor.hallway_humidity', '48', {
        device_class: 'humidity',
        unit_of_measurement: '%',
        friendly_name: 'Hallway Humidity',
      }),
      entity('sensor.hallway_illuminance', '120', {
        device_class: 'illuminance',
        unit_of_measurement: 'lx',
        friendly_name: 'Hallway Illuminance',
      }),
      entity('sensor.hallway_battery', '88', {
        device_class: 'battery',
        unit_of_measurement: '%',
        friendly_name: 'Hallway Battery',
      }),
    );

    const model = normalizeHome(snapshot);
    const motion = model.accessories[0]!;
    expect(motion.category).toBe('security');
    expect(accessoryCategories(motion)).toEqual(['security', 'climate', 'sensors']);
    expect(accessoryMatchesCategory(motion, 'climate')).toBe(true);
    expect(accessoryMatchesCategory(motion, 'sensors')).toBe(true);
    expect(accessoryMatchesCategory(motion, 'other')).toBe(false);

    const climateItems = accessoriesForCategory(model.accessories, 'climate', {
      services: snapshot.services,
      excludeCameras: true,
    });
    expect(climateItems).toHaveLength(1);
    expect(climateItems[0]!.id).toBe('binary_sensor.hallway_motion');
    expect(climateItems[0]!.primaryEntityId).toBe('sensor.hallway_temperature');
    expect(climateItems[0]!.category).toBe('climate');
    expect(describeAccessory(climateItems[0]!)).toBe('21.4°C');
    expect(climateItems[0]!.capabilities).toEqual([]);

    // Visibility operations on a projected tile resolve back to the canonical accessory.
    expect(visibilityTarget(climateItems[0]!, model.accessories).id).toBe(
      'binary_sensor.hallway_motion',
    );

    const view = buildHomeView({
      model,
      snapshot,
      preferences: defaults,
      route: { kind: 'home' },
      search: '',
      selectedLightGroup: null,
    });
    expect(view.navigationCategories.map((c) => c.id)).toContain('sensors');
    expect(view.indoorTemperature).toBe('21.4°C');
    expect(roomTemperatureFor(model.rooms[0]!.accessories, snapshot)).toBe('21.4°C');
  });

  it('surfaces controllable secondary traits such as a ceiling fan on a light or a garage cover on a light', () => {
    const snapshot = baseSnapshot();
    snapshot.devices.push(
      { id: 'ceiling_combo', name: 'Bedroom Ceiling', area_id: 'bedroom' },
      { id: 'garage_opener', name: 'Garage Opener', area_id: 'garage' },
    );
    snapshot.entities.push(
      { entity_id: 'light.bedroom_ceiling', device_id: 'ceiling_combo' },
      { entity_id: 'fan.bedroom_ceiling', device_id: 'ceiling_combo' },
      { entity_id: 'sensor.bedroom_ceiling_temperature', device_id: 'ceiling_combo' },
      { entity_id: 'light.garage_opener', device_id: 'garage_opener' },
      { entity_id: 'cover.garage_door', device_id: 'garage_opener' },
    );
    snapshot.states.push(
      entity('light.bedroom_ceiling', 'on', { brightness: 200, friendly_name: 'Bedroom Ceiling' }),
      entity('fan.bedroom_ceiling', 'off', {
        percentage: 40,
        friendly_name: 'Bedroom Ceiling Fan',
      }),
      entity('sensor.bedroom_ceiling_temperature', '22.0', {
        device_class: 'temperature',
        unit_of_measurement: '°C',
      }),
      entity('light.garage_opener', 'off', { friendly_name: 'Garage Opener Light' }),
      entity('cover.garage_door', 'closed', {
        current_position: 0,
        friendly_name: 'Garage Door',
      }),
    );

    const model = normalizeHome(snapshot);
    const ceiling = model.accessories.find((item) => item.id === 'light.bedroom_ceiling')!;
    expect(ceiling.category).toBe('lights');
    expect(accessoryCategories(ceiling)).toEqual(['lights', 'climate']);

    // Controllable fan takes priority over read-only temperature sensor in the climate lens.
    const climateProjected = projectAccessoryForCategory(ceiling, 'climate', snapshot.services);
    expect(climateProjected.primaryEntityId).toBe('fan.bedroom_ceiling');
    expect(climateProjected.state.state).toBe('off');
    expect(climateProjected.capabilities).toContain('toggle');

    // Covers category appears in navigation even when the only cover lives on a light device.
    const view = buildHomeView({
      model,
      snapshot,
      preferences: defaults,
      route: { kind: 'home' },
      search: '',
      selectedLightGroup: null,
    });
    expect(view.navigationCategories.map((c) => c.id)).toContain('covers');
    const coverItems = accessoriesForCategory(model.accessories, 'covers', {
      services: snapshot.services,
    });
    expect(coverItems.map((item) => item.primaryEntityId)).toEqual(['cover.garage_door']);
  });

  it('surfaces a camera light or ambient temperature sensor in those lenses without duplicating cameras in security', () => {
    const snapshot = baseSnapshot();
    snapshot.devices.push({ id: 'nursery_cam', name: 'Nursery Camera', area_id: 'bedroom' });
    snapshot.entities.push(
      { entity_id: 'camera.nursery', device_id: 'nursery_cam' },
      { entity_id: 'light.nursery_nightlight', device_id: 'nursery_cam' },
      { entity_id: 'light.nursery_status_light', device_id: 'nursery_cam' },
      { entity_id: 'sensor.nursery_temperature', device_id: 'nursery_cam' },
    );
    snapshot.states.push(
      entity('camera.nursery', 'idle', { friendly_name: 'Nursery Camera' }),
      entity('light.nursery_nightlight', 'on', { friendly_name: 'Nursery Nightlight' }),
      entity('light.nursery_status_light', 'on', { friendly_name: 'Status Light' }),
      entity('sensor.nursery_temperature', '20.5', {
        device_class: 'temperature',
        unit_of_measurement: '°C',
        friendly_name: 'Nursery Temperature',
      }),
    );

    const model = normalizeHome(snapshot);
    const cam = model.accessories[0]!;
    expect(cam.category).toBe('security');
    expect(accessoryCategories(cam)).toEqual(['security', 'climate', 'lights']);

    expect(
      accessoriesForCategory(model.accessories, 'security', { excludeCameras: true }),
    ).toHaveLength(0);
    const climateItems = accessoriesForCategory(model.accessories, 'climate', {
      services: snapshot.services,
      excludeCameras: true,
    });
    expect(climateItems.map((item) => item.primaryEntityId)).toEqual([
      'sensor.nursery_temperature',
    ]);
    const lightItems = accessoriesForCategory(model.accessories, 'lights', {
      services: snapshot.services,
      excludeCameras: true,
    });
    expect(lightItems.map((item) => item.primaryEntityId)).toEqual(['light.nursery_nightlight']);
    expect(lightItems[0]!.capabilities).toContain('toggle');
  });

  it('does not leak diagnostics, internal hardware temps, kettle temps, printer fans, or feature switches into extra categories', () => {
    const snapshot = baseSnapshot();
    snapshot.devices.push(
      { id: 'desk_plug', name: 'Desk Plug', area_id: 'bedroom' },
      { id: 'kettle', name: 'Kitchen Kettle', area_id: 'kitchen' },
      { id: 'bambu', name: 'Bambu Lab X1C', manufacturer: 'Bambu Lab', area_id: 'garage' },
      { id: 'router', name: 'Eero Gateway', manufacturer: 'eero', area_id: 'hallway' },
      { id: 'ac', name: 'Living AC', area_id: 'hallway' },
    );
    snapshot.entities.push(
      { entity_id: 'switch.desk_plug', device_id: 'desk_plug' },
      { entity_id: 'sensor.desk_plug_device_temperature', device_id: 'desk_plug' },
      { entity_id: 'sensor.desk_plug_power', device_id: 'desk_plug' },
      { entity_id: 'water_heater.kettle', device_id: 'kettle' },
      { entity_id: 'sensor.kettle_temperature', device_id: 'kettle' },
      { entity_id: 'climate.kettle_legacy', device_id: 'kettle', entity_category: 'diagnostic' },
      { entity_id: 'sensor.bambu_status', device_id: 'bambu' },
      { entity_id: 'sensor.bambu_nozzle_temperature', device_id: 'bambu' },
      { entity_id: 'fan.bambu_part_cooling', device_id: 'bambu' },
      { entity_id: 'binary_sensor.router_status', device_id: 'router' },
      { entity_id: 'sensor.router_temperature', device_id: 'router' },
      { entity_id: 'climate.living_ac', device_id: 'ac' },
      { entity_id: 'switch.living_ac_timer', device_id: 'ac' },
      { entity_id: 'select.living_ac_swing', device_id: 'ac' },
    );
    snapshot.states.push(
      entity('switch.desk_plug', 'on', { device_class: 'outlet', friendly_name: 'Desk Plug' }),
      entity('sensor.desk_plug_device_temperature', '39', {
        device_class: 'temperature',
        unit_of_measurement: '°C',
        friendly_name: 'Desk Plug Device Temperature',
      }),
      entity('sensor.desk_plug_power', '42', {
        device_class: 'power',
        unit_of_measurement: 'W',
        friendly_name: 'Desk Plug Power',
      }),
      entity('water_heater.kettle', 'off', {
        current_temperature: 85,
        friendly_name: 'Kitchen Kettle',
      }),
      entity('sensor.kettle_temperature', '85', {
        device_class: 'temperature',
        unit_of_measurement: '°C',
        friendly_name: 'Temperature',
      }),
      entity('climate.kettle_legacy', 'off', { current_temperature: 85 }),
      entity('sensor.bambu_status', 'idle', { friendly_name: 'Bambu Lab Status' }),
      entity('sensor.bambu_nozzle_temperature', '210', {
        device_class: 'temperature',
        unit_of_measurement: '°C',
      }),
      entity('fan.bambu_part_cooling', 'off', { friendly_name: 'Part Cooling Fan' }),
      entity('binary_sensor.router_status', 'on', {
        device_class: 'connectivity',
        friendly_name: 'Eero Gateway Status',
      }),
      entity('sensor.router_temperature', '58', {
        device_class: 'temperature',
        unit_of_measurement: '°C',
      }),
      entity('climate.living_ac', 'cool', {
        current_temperature: 23,
        temperature: 21,
        friendly_name: 'Living AC',
      }),
      entity('switch.living_ac_timer', 'off', { friendly_name: 'AC Timer' }),
      entity('select.living_ac_swing', 'auto', { friendly_name: 'AC Swing' }),
    );

    const model = normalizeHome(snapshot);
    const byDevice = new Map(model.accessories.map((item) => [item.deviceId, item]));
    expect(accessoryCategories(byDevice.get('desk_plug')!)).toEqual(['outlets']);
    expect(accessoryCategories(byDevice.get('kettle')!)).toEqual(['water']);
    expect(accessoryCategories(byDevice.get('bambu')!)).toEqual(['printers']);
    expect(accessoryCategories(byDevice.get('router')!)).toEqual(['network']);
    expect(accessoryCategories(byDevice.get('ac')!)).toEqual(['climate']);

    const view = buildHomeView({
      model,
      snapshot,
      preferences: defaults,
      route: { kind: 'home' },
      search: '',
      selectedLightGroup: null,
    });
    // Only the real AC climate temperature (23°C) is eligible — never plug/kettle/printer/router temps.
    expect(view.indoorTemperature).toBe('23°C');
    expect(roomTemperatureFor([byDevice.get('kettle')!], snapshot)).toBe('—');
  });

  it('infers climate traits for ambient temperature or humidity sensors missing device_class and projects icons cleanly', () => {
    const snapshot = baseSnapshot();
    snapshot.devices.push({ id: 'sonoff_th', name: 'Terrarium Relay', area_id: 'bedroom' });
    snapshot.entities.push(
      { entity_id: 'switch.terrarium_relay', device_id: 'sonoff_th' },
      { entity_id: 'sensor.terrarium_temperature', device_id: 'sonoff_th' },
    );
    snapshot.states.push(
      entity('switch.terrarium_relay', 'on', { device_class: 'outlet' }),
      entity('sensor.terrarium_temperature', '24.2', {
        unit_of_measurement: '°C',
        friendly_name: 'Terrarium Temperature',
      }),
    );

    const model = normalizeHome(snapshot);
    const relay = model.accessories[0]!;
    expect(relay.category).toBe('outlets');
    expect(accessoryCategories(relay)).toEqual(['outlets', 'climate']);
    const projected = projectAccessoryEntity(relay, relay.secondaryEntities[0]!);
    expect(projected.category).toBe('climate');
    expect(projected.primaryEntityId).toBe('sensor.terrarium_temperature');
  });
});
