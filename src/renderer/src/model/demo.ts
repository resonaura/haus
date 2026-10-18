import type { HassEntity, Snapshot } from './types';

/** Fictional local sample home. No network, account, or real camera is represented here. */
export function createDemoSnapshot(): Snapshot {
  const timestamp = new Date().toISOString();
  const snapshot: Snapshot = {
    config: {
      location_name: 'Willow House',
      version: '2026.10.0',
      unit_system: { temperature: '°C' },
      demo: true,
    },
    user: { name: 'Alex', is_admin: true },
    areas: [
      { area_id: 'living_room', name: 'Living Room', icon: 'mdi:sofa-outline' },
      { area_id: 'bedroom', name: 'Bedroom', icon: 'mdi:bed-king-outline' },
      { area_id: 'kitchen', name: 'Kitchen', icon: 'mdi:countertop-outline' },
      { area_id: 'outdoor', name: 'Outdoor', icon: 'mdi:tree-outline' },
      { area_id: 'hallway', name: 'Hallway', icon: 'mdi:door-open' },
    ],
    devices: [],
    entities: [],
    states: [],
    services: Object.fromEntries(
      Object.entries({
        light: ['turn_on', 'turn_off', 'toggle'],
        switch: ['turn_on', 'turn_off', 'toggle'],
        climate: ['set_temperature', 'set_hvac_mode', 'turn_on', 'turn_off'],
        cover: ['open_cover', 'close_cover', 'stop_cover', 'set_cover_position'],
        valve: ['open_valve', 'close_valve', 'stop_valve', 'set_valve_position'],
        media_player: ['turn_on', 'turn_off', 'volume_set', 'media_play_pause'],
        lock: ['lock', 'unlock'],
        scene: ['turn_on'],
        fan: ['turn_on', 'turn_off', 'set_percentage'],
        select: ['select_option'],
        number: ['set_value'],
        button: ['press'],
      }).map(([domain, names]) => [
        domain,
        Object.fromEntries(
          names.map((name) => [name, { name: name.replaceAll('_', ' '), fields: {} }]),
        ),
      ]),
    ),
  };
  function add(
    entity_id: string,
    name: string,
    area: string,
    state: string,
    attributes: Record<string, unknown> = {},
    deviceId = entity_id.replace('.', '_'),
  ) {
    if (!snapshot.devices.some((device) => device.id === deviceId))
      snapshot.devices.push({
        id: deviceId,
        name,
        area_id: area,
        manufacturer: 'Haus Demo',
        model: 'Fictional sample',
      });
    snapshot.entities.push({
      entity_id,
      device_id: deviceId,
      original_name: name,
      entity_category: null,
      disabled_by: null,
      hidden_by: null,
    });
    snapshot.states.push({
      entity_id,
      state,
      attributes: { friendly_name: name, ...attributes },
      last_changed: timestamp,
      last_updated: timestamp,
    });
  }
  function diagnostic(
    entity_id: string,
    name: string,
    deviceId: string,
    state: string,
    attrs: Record<string, unknown> = {},
  ) {
    snapshot.entities.push({ entity_id, device_id: deviceId, entity_category: 'diagnostic' });
    snapshot.states.push({
      entity_id,
      state,
      attributes: { friendly_name: name, ...attrs },
      last_changed: timestamp,
      last_updated: timestamp,
    });
  }
  const warm = {
    supported_color_modes: ['color_temp'],
    color_mode: 'color_temp',
    color_temp_kelvin: 3000,
    min_color_temp_kelvin: 2200,
    max_color_temp_kelvin: 6500,
  };
  const rgb = { ...warm, supported_color_modes: ['color_temp', 'rgb'], rgb_color: [255, 200, 140] };
  add('light.living_room_pendant', 'Pendant lights', 'living_room', 'on', {
    ...warm,
    brightness: 191,
  });
  add('light.corner_lamp', 'Corner lamp', 'living_room', 'on', { ...rgb, brightness: 153 });
  add('climate.home', 'Thermostat', 'living_room', 'heat', {
    supported_features: 385,
    temperature: 22,
    current_temperature: 21.5,
    current_humidity: 44,
    hvac_action: 'heating',
    hvac_modes: ['off', 'heat', 'cool', 'auto'],
    min_temp: 15,
    max_temp: 30,
    target_temp_step: 0.5,
    temperature_unit: '°C',
  });
  add('cover.living_room_blinds', 'Window shades', 'living_room', 'open', {
    supported_features: 15,
    device_class: 'shade',
    current_position: 72,
  });
  add('media_player.living_room', 'Living Room speaker', 'living_room', 'playing', {
    supported_features: 16781,
    volume_level: 0.35,
    media_title: 'A little room to breathe',
    media_artist: 'Haus Radio · Demo',
    media_content_type: 'music',
  });
  add('camera.living_room', 'Living Room', 'living_room', 'idle', {
    supported_features: 2,
    frontend_stream_type: 'web_rtc',
    demo_scene: 'living-room',
    demo: true,
  });
  add('switch.reading_nook', 'Reading nook', 'living_room', 'on', { device_class: 'outlet' });
  add('light.bedroom_lamps', 'Bedside lamps', 'bedroom', 'off', { ...rgb, brightness: 128 });
  add('cover.bedroom_curtains', 'Curtains', 'bedroom', 'open', {
    supported_features: 15,
    device_class: 'curtain',
    current_position: 100,
  });
  add('fan.bedroom', 'Ceiling fan', 'bedroom', 'off', {
    supported_features: 1,
    percentage: 40,
    percentage_step: 20,
  });
  add(
    'sensor.bedroom_temperature',
    'Room temperature',
    'bedroom',
    '20.8',
    { device_class: 'temperature', unit_of_measurement: '°C' },
    'bedroom_environment',
  );
  diagnostic(
    'sensor.bedroom_sensor_battery',
    'Bedroom sensor battery',
    'bedroom_environment',
    '18',
    { device_class: 'battery', unit_of_measurement: '%' },
  );
  add('light.kitchen_pendants', 'Kitchen pendants', 'kitchen', 'on', { ...warm, brightness: 230 });
  add('light.kitchen_counter', 'Under-cabinet lights', 'kitchen', 'off', {
    ...warm,
    brightness: 205,
  });
  add('switch.coffee_machine', 'Coffee machine', 'kitchen', 'off', { device_class: 'outlet' });
  diagnostic('sensor.coffee_machine_power', 'Power', 'switch_coffee_machine', '0', {
    device_class: 'power',
    unit_of_measurement: 'W',
  });
  add('binary_sensor.kitchen_leak', 'Water leak sensor', 'kitchen', 'off', {
    device_class: 'moisture',
  });
  diagnostic(
    'sensor.kitchen_leak_battery',
    'Leak sensor battery',
    'binary_sensor_kitchen_leak',
    '94',
    { device_class: 'battery', unit_of_measurement: '%' },
  );
  add('sensor.kitchen_humidity', 'Humidity', 'kitchen', '46', {
    device_class: 'humidity',
    unit_of_measurement: '%',
  });
  add(
    'camera.front_door',
    'Front door',
    'outdoor',
    'idle',
    {
      supported_features: 2,
      frontend_stream_type: 'web_rtc',
      demo_scene: 'front-door',
      demo: true,
    },
    'front_door_camera',
  );
  add(
    'light.front_door',
    'Porch light',
    'outdoor',
    'off',
    { supported_color_modes: ['brightness'], brightness: 200 },
    'front_door_camera',
  );
  diagnostic('sensor.front_door_camera_wifi', 'Wi-Fi signal', 'front_door_camera', '-55', {
    device_class: 'signal_strength',
    unit_of_measurement: 'dBm',
  });
  add('camera.garden', 'Garden', 'outdoor', 'idle', {
    supported_features: 2,
    frontend_stream_type: 'web_rtc',
    demo_scene: 'garden',
    demo: true,
  });
  add('light.garden', 'Garden lights', 'outdoor', 'off', { ...warm, brightness: 210 });
  add('binary_sensor.garden_motion', 'Garden motion', 'outdoor', 'off', { device_class: 'motion' });
  add('valve.garden', 'Garden irrigation', 'outdoor', 'closed', {
    supported_features: 15,
    current_position: 0,
  });
  add('lock.front_door', 'Front door lock', 'hallway', 'locked', { supported_features: 0 });
  diagnostic('sensor.front_door_lock_battery', 'Front door lock battery', 'lock_front_door', '76', {
    device_class: 'battery',
    unit_of_measurement: '%',
  });
  add('light.hallway', 'Hallway light', 'hallway', 'off', { ...warm, brightness: 128 });
  add('binary_sensor.front_door', 'Door sensor', 'hallway', 'off', { device_class: 'door' });
  add('binary_sensor.hallway_smoke', 'Smoke detector', 'hallway', 'off', { device_class: 'smoke' });
  add('switch.entry_plug', 'Entry outlet', 'hallway', 'unavailable', { device_class: 'outlet' });
  for (const [id, name, icon, areaId] of [
    ['good_morning', 'Good morning', 'mdi:weather-sunset-up', 'kitchen'],
    ['movie_time', 'Movie time', 'mdi:movie-open-outline', 'living_room'],
    ['good_night', 'Good night', 'mdi:weather-night', 'bedroom'],
    ['away', 'Away', 'mdi:door-open', undefined],
  ] as const) {
    const scene: HassEntity = {
      entity_id: `scene.${id}`,
      state: 'unknown',
      attributes: {
        friendly_name: name,
        icon,
        entity_id:
          id === 'good_morning'
            ? ['light.kitchen_pendants', 'light.kitchen_counter', 'switch.coffee_machine']
            : id === 'movie_time'
              ? ['light.living_room_pendant', 'light.corner_lamp', 'cover.living_room_blinds']
              : id === 'good_night'
                ? ['light.bedroom_lamps', 'cover.bedroom_curtains', 'fan.bedroom']
                : [
                    'light.living_room_pendant',
                    'light.bedroom_lamps',
                    'light.kitchen_pendants',
                    'light.garden',
                  ],
        entities:
          id === 'good_morning'
            ? {
                'light.kitchen_pendants': { state: 'on', attributes: { brightness: 230 } },
                'light.kitchen_counter': { state: 'off' },
                'switch.coffee_machine': { state: 'off' },
              }
            : id === 'movie_time'
              ? {
                  'light.living_room_pendant': { state: 'on', attributes: { brightness: 191 } },
                  'light.corner_lamp': {
                    state: 'on',
                    attributes: { brightness: 153, rgb_color: [255, 200, 140] },
                  },
                  'cover.living_room_blinds': {
                    state: 'open',
                    attributes: { current_position: 72 },
                  },
                }
              : id === 'good_night'
                ? {
                    'light.bedroom_lamps': { state: 'off' },
                    'cover.bedroom_curtains': {
                      state: 'open',
                      attributes: { current_position: 100 },
                    },
                    'fan.bedroom': { state: 'off' },
                  }
                : {
                    'light.living_room_pendant': { state: 'off' },
                    'light.bedroom_lamps': { state: 'off' },
                    'light.kitchen_pendants': { state: 'off' },
                    'light.garden': { state: 'off' },
                  },
      },
      last_changed: timestamp,
    };
    snapshot.states.push(scene);
    snapshot.entities.push({ entity_id: scene.entity_id, ...(areaId ? { area_id: areaId } : {}) });
  }
  snapshot.states.push({
    entity_id: 'weather.home',
    state: 'partlycloudy',
    attributes: {
      friendly_name: 'Willow House',
      temperature: 16,
      temperature_unit: '°C',
      humidity: 67,
    },
    last_changed: timestamp,
  });
  snapshot.devices.push({
    id: 'stateful_scene_evening',
    name: 'Evening Relaxation Scene Switch',
    area_id: 'living_room',
    manufacturer: 'Hugo Bloem',
    model: 'Stateful Scene',
  });
  snapshot.entities.push({
    entity_id: 'switch.stateful_scene_evening_relaxation',
    device_id: 'stateful_scene_evening',
    platform: 'stateful_scenes',
    unique_id: 'stateful_scenes_evening_relaxation',
    original_name: 'Evening Relaxation Switch',
    entity_category: null,
    disabled_by: null,
    hidden_by: null,
  });
  snapshot.states.push({
    entity_id: 'switch.stateful_scene_evening_relaxation',
    state: 'on',
    attributes: {
      friendly_name: 'Evening Relaxation Switch',
      scene_entity_id: 'scene.evening_relaxation',
      integration: 'stateful_scenes',
      icon: 'mdi:palette',
    },
    last_changed: timestamp,
    last_updated: timestamp,
  });
  return snapshot;
}
