import { describe, expect, it } from 'vitest';
import {
  applyDemoAction,
  buildAction,
  createDemoSnapshot,
  effectiveArea,
  generateDashboard,
  isSegmentEntity,
  isStatefulScene,
  normalizeHome,
  resolveCapabilities,
} from './index';
import type { Device, HassEntity, Snapshot } from './index';

const entity = (
  entity_id: string,
  state = 'on',
  attributes: Record<string, unknown> = {},
): HassEntity => ({ entity_id, state, attributes, last_changed: '2026-10-16T12:00:00Z' });
const state = (snapshot: Snapshot, id: string) =>
  snapshot.states.find((item) => item.entity_id === id)!;

describe('area resolution', () => {
  const devices = new Map<string, Device>([
    ['parent', { id: 'parent', area_id: 'living' }],
    ['child', { id: 'child', parent_device_id: 'parent', area_id: null }],
    ['own', { id: 'own', parent_device_id: 'parent', area_id: 'bedroom' }],
    ['gateway-device', { id: 'gateway-device', via_device_id: 'parent' }],
    ['a', { id: 'a', parent_device_id: 'b' }],
    ['b', { id: 'b', parent_device_id: 'a' }],
  ]);
  it('prefers entity overrides, then a device area, then the logical parent', () => {
    expect(
      effectiveArea({ entity_id: 'light.x', device_id: 'child', area_id: 'kitchen' }, devices),
    ).toBe('kitchen');
    expect(effectiveArea({ entity_id: 'light.x', device_id: 'own' }, devices)).toBe('bedroom');
    expect(effectiveArea({ entity_id: 'light.x', device_id: 'child' }, devices)).toBe('living');
  });
  it('handles cycles and missing devices without looping', () => {
    expect(effectiveArea({ entity_id: 'light.x', device_id: 'a' }, devices)).toBeUndefined();
    expect(effectiveArea({ entity_id: 'light.x', device_id: 'missing' }, devices)).toBeUndefined();
  });
  it('does not inherit the area of a network gateway', () => {
    expect(
      effectiveArea({ entity_id: 'light.x', device_id: 'gateway-device' }, devices),
    ).toBeUndefined();
  });
});

describe('normalization', () => {
  it('recognizes segmented light entities for the compact device picker', () => {
    expect(isSegmentEntity(entity('light.gradient_strip_segment_1'))).toBe(true);
    expect(isSegmentEntity(entity('light.reading_lamp'))).toBe(false);

    const snapshot = createDemoSnapshot();
    const parent = snapshot.entities.find((item) => item.entity_id === 'light.corner_lamp')!;
    snapshot.entities.push({
      entity_id: 'light.corner_lamp_segment_1',
      device_id: parent.device_id,
    });
    snapshot.states.push(entity('light.corner_lamp_segment_1'));
    const lamp = normalizeHome(snapshot).accessories.find((item) =>
      item.entityIds.includes('light.corner_lamp_segment_1'),
    )!;
    expect(lamp.primaryEntityId).toBe('light.corner_lamp');
  });
  it('groups entities from one physical device under its best primary control', () => {
    const model = normalizeHome(createDemoSnapshot());
    const doorbell = model.accessories.find(
      (item) => item.primaryEntityId === 'camera.front_door',
    )!;
    expect(doorbell.entityIds).toContain('light.front_door');
    expect(model.accessories.some((item) => item.primaryEntityId === 'light.front_door')).toBe(
      false,
    );
    expect(model.rooms.find((room) => room.id === 'outdoor')!.accessories).toContain(doorbell);
  });
  it('keeps climate controller switches attached to the physical climate accessory', () => {
    const snapshot = createDemoSnapshot();
    snapshot.devices.push({ id: 'sensibo', name: 'TV Place AC', area_id: 'tv_place' });
    snapshot.entities.push(
      { entity_id: 'climate.tv_place_ac', device_id: 'sensibo' },
      { entity_id: 'switch.tv_place_ac_climate_react', device_id: 'sensibo' },
      { entity_id: 'switch.tv_place_ac_timer', device_id: 'sensibo' },
    );
    snapshot.states.push(
      entity('climate.tv_place_ac', 'off', {
        current_temperature: 20.5,
        temperature: 18,
        friendly_name: 'TV Place AC',
      }),
      entity('switch.tv_place_ac_climate_react', 'off', {
        friendly_name: 'TV Place AC Climate React',
      }),
      entity('switch.tv_place_ac_timer', 'off', { friendly_name: 'TV Place AC Timer' }),
    );

    const model = normalizeHome(snapshot);
    const climate = model.accessories.find(
      (item) => item.primaryEntityId === 'climate.tv_place_ac',
    );
    expect(climate?.entityIds).toEqual([
      'climate.tv_place_ac',
      'switch.tv_place_ac_climate_react',
      'switch.tv_place_ac_timer',
    ]);
    expect(
      model.accessories.some((item) =>
        ['switch.tv_place_ac_climate_react', 'switch.tv_place_ac_timer'].includes(
          item.primaryEntityId,
        ),
      ),
    ).toBe(false);
  });
  it('keeps diagnostic/config/disabled/hidden entities in details, off the home grid', () => {
    const snapshot = createDemoSnapshot();
    const parent = snapshot.entities.find((item) => item.entity_id === 'light.corner_lamp')!;
    for (const [id, metadata] of [
      ['sensor.lamp_rssi', { entity_category: 'diagnostic' }],
      ['select.lamp_startup', { entity_category: 'config' }],
      ['light.lamp_hidden', { hidden_by: 'user' }],
      ['light.lamp_disabled', { disabled_by: 'integration' }],
    ] as const) {
      snapshot.entities.push({ entity_id: id, device_id: parent.device_id, ...metadata });
      snapshot.states.push(entity(id));
    }
    const model = normalizeHome(snapshot);
    const lamp = model.accessories.find((item) => item.id === 'light.corner_lamp')!;
    expect(lamp.secondaryEntities).toHaveLength(4);
    expect(model.accessories.some((item) => item.id === 'select.lamp_startup')).toBe(false);
    expect(model.accessories.some((item) => item.id === 'light.lamp_disabled')).toBe(false);
    expect(model.accessories.some((item) => item.id === 'light.lamp_hidden')).toBe(false);
  });
  it('groups readings from one sensor while keeping battery levels as secondary data', () => {
    const snapshot = createDemoSnapshot();
    snapshot.entities.push({
      entity_id: 'sensor.bedroom_humidity',
      device_id: 'bedroom_environment',
    });
    snapshot.states.push(entity('sensor.bedroom_humidity', '44', { device_class: 'humidity' }));
    const model = normalizeHome(snapshot);
    const temperature = model.accessories.find((item) => item.id === 'sensor.bedroom_temperature')!;
    expect(temperature.secondaryEntities.map((item) => item.entity_id)).toContain(
      'sensor.bedroom_humidity',
    );
    expect(model.accessories.some((item) => item.id === 'sensor.bedroom_humidity')).toBe(false);
    expect(model.accessories.some((item) => item.state.attributes.device_class === 'battery')).toBe(
      false,
    );
  });
  it('attaches a battery sensor from a separate HA device record to its matching accessory', () => {
    const snapshot = createDemoSnapshot();
    snapshot.devices.push(
      { id: 'bedroom_door', name: 'Bedroom Door', area_id: 'bedroom' },
      { id: 'bedroom_door_battery', name: 'Bedroom Door Battery', area_id: 'bedroom' },
    );
    snapshot.entities.push(
      { entity_id: 'binary_sensor.bedroom_door', device_id: 'bedroom_door' },
      { entity_id: 'sensor.bedroom_door_battery', device_id: 'bedroom_door_battery' },
      { entity_id: 'binary_sensor.bedroom_door_charging', device_id: 'bedroom_door_battery' },
    );
    snapshot.states.push(
      entity('binary_sensor.bedroom_door', 'off', {
        device_class: 'door',
        friendly_name: 'Bedroom Door Door',
      }),
      entity('sensor.bedroom_door_battery', '76', {
        device_class: 'battery',
        unit_of_measurement: '%',
        friendly_name: 'Bedroom Door Battery',
      }),
      entity('binary_sensor.bedroom_door_charging', 'on', {
        device_class: 'battery_charging',
        friendly_name: 'Bedroom Door Charging',
      }),
    );
    const model = normalizeHome(snapshot);
    const door = model.accessories.find(
      (item) => item.primaryEntityId === 'binary_sensor.bedroom_door',
    )!;
    expect(door.name).toBe('Bedroom Door');
    expect(door.batteryLevel).toBe(76);
    expect(door.batteryCharging).toBe(true);
    expect(door.entityIds).toContain('sensor.bedroom_door_battery');
    expect(door.entityIds).toContain('binary_sensor.bedroom_door_charging');
    expect(door.secondaryEntities.map((item) => item.entity_id)).toContain(
      'binary_sensor.bedroom_door_charging',
    );
    expect(
      model.accessories.some((item) => item.primaryEntityId === 'sensor.bedroom_door_battery'),
    ).toBe(false);
    expect(
      model.accessories.some(
        (item) => item.primaryEntityId === 'binary_sensor.bedroom_door_charging',
      ),
    ).toBe(false);
  });
  it('uses explicit charging attributes without treating unavailable charging sensors as idle', () => {
    const snapshot = createDemoSnapshot();
    const light = snapshot.states.find((item) => item.entity_id.startsWith('light.'))!;
    light.attributes.is_charging = true;
    let model = normalizeHome(snapshot);
    expect(
      model.accessories.find((item) => item.primaryEntityId === light.entity_id)?.batteryCharging,
    ).toBe(true);
    light.attributes.is_charging = false;
    model = normalizeHome(snapshot);
    expect(
      model.accessories.find((item) => item.primaryEntityId === light.entity_id)?.batteryCharging,
    ).toBe(false);
    delete light.attributes.is_charging;
    model = normalizeHome(snapshot);
    expect(
      model.accessories.find((item) => item.primaryEntityId === light.entity_id)?.batteryCharging,
    ).toBeUndefined();
  });
  it('surfaces independent switches in a room while keeping a light power relay with its lamp', () => {
    const snapshot = createDemoSnapshot();
    snapshot.devices.push({ id: 'bedroom_bed_lamp', name: 'Bedroom Bed Lamp', area_id: 'bedroom' });
    snapshot.entities.push(
      { entity_id: 'light.bedroom_bed_lamp', device_id: 'bedroom_bed_lamp' },
      { entity_id: 'switch.bedroom_wall_switch', device_id: 'bedroom_bed_lamp' },
      { entity_id: 'switch.bedroom_bed_lamp_power', device_id: 'bedroom_bed_lamp' },
    );
    snapshot.states.push(
      entity('light.bedroom_bed_lamp', 'off', {
        supported_color_modes: ['onoff'],
        friendly_name: 'Bedroom Bed Lamp',
      }),
      entity('switch.bedroom_wall_switch', 'on', {
        friendly_name: 'Bedroom Wall Switch',
      }),
      entity('switch.bedroom_bed_lamp_power', 'off', {
        friendly_name: 'Bedroom Bed Lamp Power Switch',
      }),
    );
    const model = normalizeHome(snapshot);
    const room = model.rooms.find((item) => item.id === 'bedroom')!;
    const wallSwitch = room.accessories.find(
      (item) => item.primaryEntityId === 'switch.bedroom_wall_switch',
    );
    const lamp = room.accessories.find((item) => item.primaryEntityId === 'light.bedroom_bed_lamp');
    expect(wallSwitch?.category).toBe('outlets');
    expect(lamp?.entityIds).toContain('switch.bedroom_bed_lamp_power');
    expect(lamp?.entityIds).not.toContain('switch.bedroom_wall_switch');
  });
  it('recognizes printers and uses their status sensor as the device summary', () => {
    const snapshot = createDemoSnapshot();
    snapshot.devices.push({
      id: 'office_printer',
      name: 'Office Printer',
      manufacturer: 'Brother',
      model: 'MFC-L3770CDW',
      area_id: 'office',
    });
    snapshot.entities.push(
      { entity_id: 'sensor.office_printer_status', device_id: 'office_printer' },
      { entity_id: 'button.office_printer_cancel', device_id: 'office_printer' },
    );
    snapshot.states.push(
      entity('sensor.office_printer_status', 'Printing', { device_class: 'enum' }),
      entity('button.office_printer_cancel', '2026-10-16T12:00:00Z'),
    );

    const printer = normalizeHome(snapshot).accessories.find(
      (item) => item.category === 'printers',
    );
    expect(printer?.primaryEntityId).toBe('sensor.office_printer_status');
    expect(printer?.entityIds).toContain('button.office_printer_cancel');
  });
  it('preserves unavailable and unknown states and produces useful attention items', () => {
    const snapshot = createDemoSnapshot();
    state(snapshot, 'binary_sensor.kitchen_leak').state = 'on';
    state(snapshot, 'light.corner_lamp').state = 'unknown';
    const model = normalizeHome(snapshot);
    expect(model.accessories.find((item) => item.id === 'switch.entry_plug')!.availability).toBe(
      'unavailable',
    );
    expect(model.accessories.find((item) => item.id === 'light.corner_lamp')!.availability).toBe(
      'unknown',
    );
    expect(model.attention.some((item) => item.entityId === 'sensor.bedroom_sensor_battery')).toBe(
      true,
    );
    expect(
      model.attention.find((item) => item.entityId === 'binary_sensor.kitchen_leak')!.severity,
    ).toBe('critical');
  });
  it('retains entities with missing registry entries in an unassigned room', () => {
    const snapshot = createDemoSnapshot();
    snapshot.states.push(entity('light.unregistered', 'off'));
    const model = normalizeHome(snapshot);
    expect(
      model.rooms
        .find((room) => room.id === 'unassigned')!
        .accessories.some((item) => item.id === 'light.unregistered'),
    ).toBe(true);
    expect(model.scenes).toHaveLength(4);
    expect(model.cameras).toHaveLength(3);
  });
  it('assigns room scenes to their rooms and keeps the away scene global', () => {
    const snapshot = createDemoSnapshot();
    const entities = new Map(snapshot.entities.map((entry) => [entry.entity_id, entry]));
    const devices = new Map(snapshot.devices.map((device) => [device.id, device]));

    expect(effectiveArea(entities.get('scene.good_morning'), devices)).toBe('kitchen');
    expect(effectiveArea(entities.get('scene.movie_time'), devices)).toBe('living_room');
    expect(effectiveArea(entities.get('scene.good_night'), devices)).toBe('bedroom');
    expect(effectiveArea(entities.get('scene.away'), devices)).toBeUndefined();

    const model = normalizeHome(snapshot);
    expect(
      model.scenePlacements.find((scene) => scene.sceneId === 'scene.good_morning'),
    ).toMatchObject({
      areaId: 'kitchen',
      scope: 'room',
    });
    expect(model.scenePlacements.find((scene) => scene.sceneId === 'scene.away')).toMatchObject({
      scope: 'home',
    });
  });
  it('infers the best room when most scene targets belong there', () => {
    const snapshot = createDemoSnapshot();
    const movie = state(snapshot, 'scene.movie_time');
    movie.attributes.entity_id = [
      'light.living_room_pendant',
      'light.corner_lamp',
      'cover.living_room_blinds',
      'switch.coffee_machine',
    ];
    const model = normalizeHome(snapshot);
    expect(model.scenePlacements.find((scene) => scene.sceneId === movie.entity_id)).toMatchObject({
      areaId: 'living_room',
      scope: 'room',
    });
  });
  it('keeps a scene global when most targets have no known room', () => {
    const snapshot = createDemoSnapshot();
    const scene = state(snapshot, 'scene.movie_time');
    scene.attributes.entity_id = [
      'light.living_room_pendant',
      'sensor.unassigned_one',
      'sensor.unassigned_two',
      'sensor.unassigned_three',
    ];
    scene.attributes.entities = {
      'light.living_room_pendant': { state: 'on' },
      'sensor.unassigned_one': { state: 'on' },
      'sensor.unassigned_two': { state: 'on' },
      'sensor.unassigned_three': { state: 'on' },
    };
    snapshot.entities.find((entry) => entry.entity_id === scene.entity_id)!.area_id = undefined;
    for (const entity_id of [
      'sensor.unassigned_one',
      'sensor.unassigned_two',
      'sensor.unassigned_three',
    ]) {
      snapshot.states.push(entity(entity_id));
      snapshot.entities.push({ entity_id });
    }

    expect(
      normalizeHome(snapshot).scenePlacements.find((item) => item.sceneId === scene.entity_id),
    ).toMatchObject({ scope: 'home' });
  });
  it('keeps a large scene spanning several rooms in the whole-home section', () => {
    const snapshot = createDemoSnapshot();
    const scene = state(snapshot, 'scene.movie_time');
    scene.attributes.entity_id = [
      'light.living_room_pendant',
      'light.corner_lamp',
      'climate.home',
      'cover.living_room_blinds',
      'media_player.living_room',
      'switch.coffee_machine',
    ];
    const placement = normalizeHome(snapshot).scenePlacements.find(
      (item) => item.sceneId === scene.entity_id,
    )!;
    expect(placement.scope).toBe('home');
  });
  it('scores the most likely active scene from saved settings and tolerates small drift', () => {
    const snapshot = createDemoSnapshot();
    const scene = state(snapshot, 'scene.movie_time');
    const placement = normalizeHome(snapshot).scenePlacements.find(
      (item) => item.sceneId === scene.entity_id,
    )!;
    expect(placement.matchScore).toBe(1);
    expect(placement.matchCoverage).toBe(1);

    state(snapshot, 'light.corner_lamp').attributes.brightness = 170;
    const slightlyChanged = normalizeHome(snapshot).scenePlacements.find(
      (item) => item.sceneId === scene.entity_id,
    )!;
    expect(slightlyChanged.matchScore).toBe(1);

    state(snapshot, 'light.corner_lamp').attributes.brightness = 40;
    const changed = normalizeHome(snapshot).scenePlacements.find(
      (item) => item.sceneId === scene.entity_id,
    )!;
    expect(changed.matchScore).toBeLessThan(1);
  });
  it('uses an available stored scene config and stays undecided when target settings are unavailable', () => {
    const snapshot = createDemoSnapshot();
    const scene = state(snapshot, 'scene.movie_time');
    const sceneConfig = scene.attributes.entities;
    delete scene.attributes.entities;
    snapshot.sceneConfigs = { [scene.entity_id]: { entities: sceneConfig } };
    expect(
      normalizeHome(snapshot).scenePlacements.find((item) => item.sceneId === scene.entity_id)
        ?.matchScore,
    ).toBe(1);

    delete snapshot.sceneConfigs;
    expect(
      normalizeHome(snapshot).scenePlacements.find((item) => item.sceneId === scene.entity_id)
        ?.matchScore,
    ).toBeUndefined();
  });
  it('matches powered-off lamps without comparing their stale brightness or color', () => {
    const snapshot = createDemoSnapshot();
    const scene = state(snapshot, 'scene.movie_time');
    scene.attributes.entities = {
      'light.corner_lamp': { state: 'off', brightness: 0, rgb_color: [0, 0, 0] },
    };
    state(snapshot, 'light.corner_lamp').state = 'off';
    expect(
      normalizeHome(snapshot).scenePlacements.find((p) => p.sceneId === scene.entity_id),
    ).toMatchObject({ matchScore: 1, matchCoverage: 1 });
    state(snapshot, 'light.corner_lamp').state = 'on';
    expect(
      normalizeHome(snapshot).scenePlacements.find((p) => p.sceneId === scene.entity_id)
        ?.matchScore,
    ).toBe(0);
  });
  it('does not claim a complete match when an expected live attribute is missing', () => {
    const snapshot = createDemoSnapshot();
    const scene = state(snapshot, 'scene.movie_time');
    scene.attributes.entities = { 'light.corner_lamp': { state: 'on', brightness: 153 } };
    delete state(snapshot, 'light.corner_lamp').attributes.brightness;
    expect(
      normalizeHome(snapshot).scenePlacements.find((p) => p.sceneId === scene.entity_id)
        ?.matchScore,
    ).toBeLessThan(1);
  });
  it('uses a linked Stateful Scenes monitor when the integration reports activity', () => {
    const snapshot = createDemoSnapshot();
    const scene = state(snapshot, 'scene.movie_time');
    delete scene.attributes.entities;
    snapshot.states.push(
      entity('switch.scene_monitor', 'on', { scene_entity_id: scene.entity_id }),
    );
    expect(
      normalizeHome(snapshot).scenePlacements.find((p) => p.sceneId === scene.entity_id)?.active,
    ).toBe(true);
    state(snapshot, 'switch.scene_monitor').state = 'off';
    expect(
      normalizeHome(snapshot).scenePlacements.find((p) => p.sceneId === scene.entity_id)?.active,
    ).toBe(false);
  });
  it('identifies Stateful Scenes entities and marks them defaultHidden and isService', () => {
    const statefulEntity = entity('switch.stateful_scene_relaxation', 'on', {
      friendly_name: 'Relaxation Scene Switch',
      scene_entity_id: 'scene.relaxation',
    });
    expect(
      isStatefulScene(statefulEntity, {
        entity_id: statefulEntity.entity_id,
        platform: 'stateful_scenes',
      }),
    ).toBe(true);

    const normalSwitch = entity('switch.coffee_maker', 'on');
    expect(
      isStatefulScene(normalSwitch, {
        entity_id: normalSwitch.entity_id,
        platform: 'tasmota',
      }),
    ).toBe(false);

    const snapshot = createDemoSnapshot();
    const model = normalizeHome(snapshot);
    const sceneSwitch = model.accessories.find(
      (item) => item.primaryEntityId === 'switch.stateful_scene_evening_relaxation',
    );
    expect(sceneSwitch).toBeDefined();
    expect(sceneSwitch?.defaultHidden).toBe(true);
    expect(sceneSwitch?.isService).toBe(true);
  });
});

describe('capability discovery', () => {
  const services = createDemoSnapshot().services;
  it('uses color modes instead of a global domain service to infer light controls', () => {
    expect(
      resolveCapabilities(
        entity('light.simple', 'on', { supported_color_modes: ['onoff'] }),
        services,
      ),
    ).toEqual(['toggle']);
    expect(
      resolveCapabilities(
        entity('light.color', 'on', { supported_color_modes: ['rgb', 'color_temp'] }),
        services,
      ),
    ).toEqual(['toggle', 'brightness', 'color', 'temperature']);
    expect(
      resolveCapabilities(entity('light.color', 'on', { supported_color_modes: ['rgb'] }), {}),
    ).toEqual([]);
  });
  it('checks the flags and services for covers, media, and climate', () => {
    expect(
      resolveCapabilities(entity('cover.simple', 'open', { supported_features: 3 }), services),
    ).toEqual(['open', 'close']);
    expect(
      resolveCapabilities(
        entity('media_player.volume', 'idle', { supported_features: 4 }),
        services,
      ),
    ).toEqual(['volume']);
    expect(
      resolveCapabilities(
        entity('climate.readonly', 'heat', { supported_features: 0, hvac_modes: ['heat'] }),
        services,
      ),
    ).toEqual(['hvac-mode']);
  });
  it('never infers Talk from streaming or a camera name', () => {
    expect(
      resolveCapabilities(
        entity('camera.doorbell', 'idle', {
          supported_features: 3,
          audio: true,
          two_way_audio: true,
        }),
        services,
      ),
    ).toEqual(['live']);
  });
});

describe('native actions and fictional replay', () => {
  it('builds native service calls with light percentages, Kelvin, and exact targets', () => {
    const light = entity('light.lamp', 'off', {
      min_color_temp_kelvin: 2200,
      max_color_temp_kelvin: 6500,
    });
    expect(buildAction(light, 'toggle')).toEqual({
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: 'light.lamp' },
    });
    expect(buildAction(light, 'brightness', 80).service_data).toEqual({ brightness_pct: 80 });
    expect(buildAction(light, 'temperature', 9000).service_data).toEqual({
      color_temp_kelvin: 6500,
    });
    expect(buildAction(light, 'color', '#f0a010').service_data).toEqual({
      rgb_color: [240, 160, 16],
    });
  });
  it('validates service-domain compatibility, availability, and invalid input', () => {
    expect(() => buildAction(entity('sensor.temp'), 'toggle')).toThrow('does not support');
    expect(() => buildAction(entity('light.lamp', 'unavailable'), 'toggle')).toThrow('unavailable');
    expect(() => buildAction(entity('light.lamp'), 'brightness', Number.NaN)).toThrow(
      'valid number',
    );
    expect(() => buildAction(entity('light.lamp'), 'color', 'red')).toThrow('RGB');
    expect(buildAction(entity('scene.new_scene', 'unknown'), 'run').service).toBe('turn_on');
    expect(buildAction(entity('button.new_button', 'unknown'), 'press').service).toBe('press');
    expect(() =>
      buildAction(
        entity('climate.home', 'heat', { hvac_modes: ['heat', 'off'] }),
        'hvac-mode',
        'cool',
      ),
    ).toThrow('not supported');
  });
  it('preserves Home Assistant units and supports explicit target temperature ranges', () => {
    const climate = entity('climate.home', 'heat', {
      min_temp: 60,
      max_temp: 85,
      temperature_unit: '°F',
    });
    expect(buildAction(climate, 'climate-temperature', 73).service_data).toEqual({
      temperature: 73,
    });
    climate.state = 'heat_cool';
    expect(() => buildAction(climate, 'climate-temperature', 73)).toThrow('both lower and upper');
    expect(
      buildAction(climate, 'climate-temperature', { target_temp_low: 68, target_temp_high: 76 })
        .service_data,
    ).toEqual({ target_temp_low: 68, target_temp_high: 76 });
  });
  it('replays control changes immutably and applies real scene entity IDs', () => {
    const original = createDemoSnapshot();
    const next = applyDemoAction(
      original,
      buildAction(state(original, 'light.corner_lamp'), 'brightness', 90),
    );
    expect(state(next, 'light.corner_lamp').attributes.brightness).toBe(230);
    expect(state(original, 'light.corner_lamp').attributes.brightness).toBe(153);
    const movie = applyDemoAction(next, buildAction(state(next, 'scene.movie_time'), 'run'));
    expect(state(movie, 'cover.living_room_blinds').state).toBe('closed');
    expect(state(movie, 'light.living_room_pendant').attributes.brightness).toBe(35);
    expect(state(movie, 'scene.movie_time').attributes.last_activated).toBeTruthy();
    const off = applyDemoAction(
      movie,
      buildAction(state(movie, 'light.corner_lamp'), 'brightness', 0),
    );
    expect(state(off, 'light.corner_lamp').state).toBe('off');
  });
  it('maps cover positions, media volume, and locks without unrelated state changes', () => {
    let snapshot = createDemoSnapshot();
    for (const [id, intent, value] of [
      ['cover.living_room_blinds', 'position', 27],
      ['media_player.living_room', 'volume', 0.64],
      ['lock.front_door', 'unlock', undefined],
    ] as const)
      snapshot = applyDemoAction(snapshot, buildAction(state(snapshot, id), intent, value));
    expect(state(snapshot, 'cover.living_room_blinds').attributes.current_position).toBe(27);
    expect(state(snapshot, 'media_player.living_room').attributes.volume_level).toBe(0.64);
    expect(state(snapshot, 'lock.front_door').state).toBe('unlocked');
    expect(state(snapshot, 'light.hallway').state).toBe('off');
  });
});

describe('Lovelace export', () => {
  it('generates portable Home, room, battery and configuration sections using built-in cards', () => {
    const snapshot = createDemoSnapshot();
    const before = JSON.stringify(snapshot);
    const dashboard = generateDashboard(snapshot);
    const views = dashboard.views as Array<Record<string, unknown>>;
    expect(views.map((view) => view.path)).toEqual([
      'home',
      'room-living_room',
      'room-bedroom',
      'room-kitchen',
      'room-outdoor',
      'room-hallway',
      'batteries',
      'configuration',
    ]);
    expect(views.every((view) => view.type === 'sections')).toBe(true);
    expect(JSON.stringify(dashboard)).not.toContain('custom:');
    expect(JSON.stringify(dashboard)).toContain('sensor.bedroom_sensor_battery');
    expect(JSON.stringify(dashboard)).toContain('scene.turn_on');
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
