/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { translateService } from './commands';
import { buildView } from './entities';
import { parseDevices, parseStates } from './types';

const devices = parseDevices({
  devices: [
    {
      id: 'mqtt_lamp',
      name: 'Lamp',
      category: 'lighting',
      roomId: 'bedroom',
      availability: 'online',
      endpoints: [
        {
          id: 'ep_lamp',
          name: 'Lamp',
          capabilities: [
            { id: 'on_off', kind: 'binary', operations: ['set', 'turn_on', 'turn_off'] },
            { id: 'brightness', kind: 'numeric', operations: ['set'] },
            { id: 'color', kind: 'complex', operations: ['set'] },
          ],
        },
      ],
    },
    {
      id: 'leak_1',
      name: 'Leak',
      category: 'security',
      roomId: 'unassigned',
      availability: 'online',
      endpoints: [
        {
          id: 'ep_leak',
          name: 'Leak',
          capabilities: [{ id: 'leak', kind: 'binary', operations: [] }],
        },
      ],
    },
    {
      id: 'temp_sensor',
      name: 'Living Room Sensor',
      category: 'environmental_sensors',
      roomId: 'living_room',
      availability: 'online',
      endpoints: [
        {
          id: 'ep_temp',
          name: 'Living Room Sensor Temperature',
          capabilities: [{ id: 'temperature', kind: 'numeric', operations: [], unit: '°C' }],
        },
        {
          id: 'ep_batt',
          name: 'Living Room Sensor Battery',
          capabilities: [{ id: 'battery', kind: 'numeric', operations: [] }],
        },
      ],
    },
    {
      id: 'kettle_1',
      name: 'Kitchen Kettle',
      category: 'appliances',
      roomId: 'kitchen',
      availability: 'online',
      endpoints: [
        {
          id: 'ep_kettle_pwr',
          name: 'Kitchen Kettle Power',
          capabilities: [{ id: 'on_off', kind: 'binary', operations: ['turn_on', 'turn_off'] }],
        },
        {
          id: 'ep_kettle_temp',
          name: 'Kitchen Kettle Target Temp',
          capabilities: [{ id: 'target_temperature', kind: 'numeric', operations: ['set'] }],
        },
      ],
    },
    {
      id: 'blinds_1',
      name: 'Office Blinds',
      category: 'covers',
      roomId: 'office',
      availability: 'online',
      endpoints: [
        {
          id: 'ep_blinds',
          name: 'Office Blinds Position',
          capabilities: [{ id: 'position', kind: 'numeric', operations: ['set'] }],
        },
      ],
    },
    { id: 7, name: 'dropped' },
  ],
});

const states = parseStates({
  states: {
    ep_lamp: { state: 'on', on_off: true, brightness: 128, color: { r: 1, g: 2, b: 3 } },
    ep_leak: { state: 'on', leak: true },
    ep_temp: { state: '21.5', value: 21.5, temperature: 21.5 },
    ep_batt: { state: '95', value: 95, battery: 95 },
    ep_kettle_pwr: { state: 'on', on_off: true },
    ep_kettle_temp: { state: '90', target_temperature: 90, temperature: 85 },
    ep_blinds: { state: '80', position: 80 },
  },
});

describe('Hub compatibility view', () => {
  const view = buildView(devices, states, 'now');

  it('drops malformed devices and maps domains, rooms and attributes', () => {
    expect(devices).toHaveLength(5);
    const light = view.states.find((s) => s.entity_id === 'light.mqtt_lamp');
    expect(light).toMatchObject({
      state: 'on',
      attributes: {
        friendly_name: 'Lamp',
        brightness: 128,
        rgb_color: [1, 2, 3],
        supported_color_modes: ['rgb'],
      },
    });
    expect(view.states.find((s) => s.entity_id === 'binary_sensor.leak_1')).toMatchObject({
      state: 'on',
      attributes: { friendly_name: 'Leak', device_class: 'moisture' },
    });
    expect(view.areas).toEqual(
      expect.arrayContaining([
        { area_id: 'bedroom', name: 'Bedroom' },
        { area_id: 'living_room', name: 'Living room' },
        { area_id: 'kitchen', name: 'Kitchen' },
        { area_id: 'office', name: 'Office' },
      ]),
    );
    expect(view.devices.find((d) => d.id === 'leak_1')).toMatchObject({ area_id: null });
  });

  it('assigns device classes and units to numeric sensors and labels endpoints uniquely', () => {
    const temp = view.states.find((s) => s.entity_id.startsWith('sensor.temp_sensor'));
    expect(temp).toMatchObject({
      state: '21.5',
      attributes: {
        device_class: 'temperature',
        unit_of_measurement: '°C',
        friendly_name: 'Living Room Sensor Temperature',
      },
    });
    const batt = view.states.find((s) => s.entity_id === 'sensor.temp_sensor_2');
    expect(batt).toMatchObject({
      state: '95',
      attributes: {
        device_class: 'battery',
        unit_of_measurement: '%',
        friendly_name: 'Living Room Sensor Battery',
      },
    });
  });

  it('maps appliances and covers correctly', () => {
    const kettleHeater = view.states.find((s) => s.entity_id.startsWith('water_heater.kettle_1'));
    expect(kettleHeater).toBeDefined();
    expect(kettleHeater?.attributes).toMatchObject({
      friendly_name: 'Kitchen Kettle Target Temp',
      temperature: 90,
      current_temperature: 85,
    });

    const cover = view.states.find((s) => s.entity_id.startsWith('cover.blinds_1'));
    expect(cover).toBeDefined();
    expect(cover).toMatchObject({
      state: 'open',
      attributes: { current_position: 80, friendly_name: 'Office Blinds' },
    });
  });

  it('reports offline devices as unavailable', () => {
    const offline = buildView(
      devices.map((d) => ({ ...d, availability: 'offline' })),
      states,
    );
    expect(offline.states.every((s) => s.state === 'unavailable')).toBe(true);
  });
});

describe('call_service translation', () => {
  const { bindings } = buildView(devices, states);
  const call = (service: string, data?: Record<string, unknown>, id = 'light.mqtt_lamp') =>
    translateService(
      bindings,
      { service, target: { entity_id: id }, service_data: data },
      () => true,
    );

  it('turns brightness_pct and rgb_color into Hub light parameters', () => {
    expect(call('turn_on', { brightness_pct: 50, rgb_color: [255, 0, 10] })).toEqual([
      {
        deviceId: 'mqtt_lamp',
        endpointId: 'ep_lamp',
        capability: 'on_off',
        command: 'turn_on',
        parameters: { brightness: 128, color: { r: 255, g: 0, b: 10 } },
      },
    ]);
  });

  it('translates cover commands', () => {
    const coverEntry = [...bindings.entries()].find(([, b]) => b.domain === 'cover');
    expect(coverEntry).toBeDefined();
    const coverId = coverEntry![0];
    expect(call('open_cover', {}, coverId)).toEqual([
      {
        deviceId: 'blinds_1',
        endpointId: 'ep_blinds',
        capability: 'position',
        command: 'set',
        parameters: { value: 100, position: 100 },
      },
    ]);
    expect(call('set_cover_position', { position: 40 }, coverId)).toEqual([
      {
        deviceId: 'blinds_1',
        endpointId: 'ep_blinds',
        capability: 'position',
        command: 'set',
        parameters: { value: 40, position: 40 },
      },
    ]);
  });

  it('translates water_heater commands', () => {
    const heaterEntry = [...bindings.entries()].find(([, b]) => b.domain === 'water_heater');
    expect(heaterEntry).toBeDefined();
    const heaterId = heaterEntry![0];
    expect(call('set_temperature', { temperature: 100 }, heaterId)).toEqual([
      {
        deviceId: 'kettle_1',
        endpointId: 'ep_kettle_temp',
        capability: 'target_temperature',
        command: 'set',
        parameters: { value: 100, target_temperature: 100 },
      },
    ]);
  });

  it('toggles from the current state and rejects unsupported targets', () => {
    expect(call('toggle')[0]?.command).toBe('turn_off');
    expect(() => call('turn_on', {}, 'light.missing')).toThrow('no longer available');
    expect(() => call('turn_on', {}, 'binary_sensor.leak_1')).toThrow('cannot be controlled');
    expect(() => call('explode')).toThrow('does not support');
    expect(() => translateService(bindings, { service: 'turn_on' }, () => false)).toThrow(
      'Choose an accessory',
    );
  });

  it('maps multi-endpoint MQTT devices with semantic entity IDs and non-unknown defaults', () => {
    const mqttDevices = parseDevices({
      devices: [
        {
          id: 'mqtt_gv2mqtt_1EC8',
          name: 'Bedroom Bed Lamp',
          category: 'lighting',
          roomId: 'bedroom',
          availability: 'online',
          connectivity: { protocol: 'mqtt' },
          endpoints: [
            {
              id: 'ep_mqtt_gv2mqtt_1EC8',
              name: 'Bedroom Bed Lamp',
              capabilities: [
                {
                  id: 'on_off',
                  kind: 'binary',
                  operations: ['set', 'turn_on', 'turn_off'],
                  supportedColorModes: ['rgb', 'color_temp'],
                },
                { id: 'brightness', kind: 'numeric', operations: ['set'] },
                { id: 'color', kind: 'complex', operations: ['set'] },
              ],
            },
            {
              id: 'ep_mqtt_gv2mqtt_1EC8_0',
              name: 'Bedroom Bed Lamp Segment 001',
              capabilities: [
                { id: 'on_off', kind: 'binary', operations: ['set', 'turn_on', 'turn_off'] },
                { id: 'brightness', kind: 'numeric', operations: ['set'] },
              ],
            },
            {
              id: 'ep_mqtt_gv2mqtt_1EC8_status',
              name: 'Bedroom Bed Lamp Status',
              capabilities: [
                {
                  id: 'sensor',
                  kind: 'string',
                  operations: [],
                  entityCategory: 'diagnostic',
                },
              ],
            },
          ],
        },
      ],
    });
    const mqttView = buildView(mqttDevices, {});
    const mainLight = mqttView.states.find((s) => s.entity_id === 'light.gv2mqtt_1ec8');
    const segLight = mqttView.states.find((s) => s.entity_id === 'light.gv2mqtt_1ec8_0');
    const diagEntry = mqttView.entities.find(
      (e) => e.entity_id === 'sensor.gv2mqtt_1ec8_status',
    );

    expect(mainLight?.state).toBe('off');
    expect(segLight?.state).toBe('off');
    expect(segLight?.attributes.friendly_name).toBe('Bedroom Bed Lamp Segment 001');
    expect(diagEntry?.entity_category).toBe('diagnostic');
    expect(diagEntry?.platform).toBe('mqtt');
  });

  it('maps HomeKit contact sensor closed/open polarity and clean friendly name', () => {
    const hkDevices = parseDevices({
      devices: [
        {
          id: 'hk_7fd1ed2f4ab3_aid_36',
          name: 'Contact Sensor 1',
          category: 'environmental_sensors',
          roomId: 'unassigned',
          availability: 'online',
          connectivity: { protocol: 'homekit' },
          endpoints: [
            {
              id: 'ep_hk_7fd1ed2f4ab3_aid_36',
              name: 'Contact Sensor 1',
              capabilities: [
                { id: 'contact', kind: 'contact', operations: [] },
                { id: 'battery', kind: 'numeric', operations: [], unit: '%', entityCategory: 'diagnostic' },
              ],
            },
          ],
        },
      ],
    });

    const closedView = buildView(hkDevices, {
      ep_hk_7fd1ed2f4ab3_aid_36: { state: 'closed', contact: true, battery: 100 },
    });
    const closedDoor = closedView.states.find((s) => s.entity_id.startsWith('binary_sensor.'));
    expect(closedDoor?.state).toBe('off');
    expect(closedDoor?.attributes.friendly_name).toBe('Contact Sensor 1');

    const openView = buildView(hkDevices, {
      ep_hk_7fd1ed2f4ab3_aid_36: { state: 'open', contact: false, battery: 100 },
    });
    const openDoor = openView.states.find((s) => s.entity_id.startsWith('binary_sensor.'));
    expect(openDoor?.state).toBe('on');
  });

  it('projects MQTT JSON attributes onto the compatibility entity', () => {
    const devices = parseDevices({
      devices: [
        {
          id: 'mqtt_attribute_sensor',
          name: 'Attribute sensor',
          category: 'environmental_sensors',
          availability: 'online',
          connectivity: { protocol: 'mqtt' },
          endpoints: [
            {
              id: 'ep_mqtt_attribute_sensor',
              name: 'Temperature',
              capabilities: [{ id: 'temperature', kind: 'numeric', operations: [], unit: '°C' }],
            },
          ],
        },
      ],
    });
    const view = buildView(devices, {
      ep_mqtt_attribute_sensor: {
        temperature: 21.5,
        attributes: {
          signal: 'strong',
          details: { channel: 11, access_token: 'sensitive', auth: 'Bearer secret' },
          stream_url: 'rtsp://camera/private',
          preview: 'data:image/jpeg;base64,private',
        },
      },
    });

    const sensor = view.states.find((entry) => entry.entity_id.startsWith('sensor.'));
    expect(sensor?.attributes).toMatchObject({
      signal: 'strong',
      details: { channel: 11 },
    });
    expect(sensor?.attributes).not.toHaveProperty('stream_url');
    expect(sensor?.attributes).not.toHaveProperty('preview');
    expect(sensor?.attributes.details).not.toHaveProperty('access_token');
    expect(sensor?.attributes.details).not.toHaveProperty('auth');
  });
});
