/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  hsToRgb,
  rgbToHs,
  inferDeviceCategory,
  inferEntityCategory,
  inferRoomIdFromLabels,
  type HausDevice,
} from '@haus/core';
import {
  buildCommandMessages,
  buildEndpointFromComponent,
  consolidateLegacyMqttDevices,
  evaluateValueTemplate,
  expandHaDiscoveryPayload,
  extractEndpointStatePatch,
  resolveCommonDeviceName,
  resolvePhysicalDeviceId,
} from '../src/index.js';

describe('HA MQTT Discovery & Universal Heuristics (@haus/mqtt + @haus/core)', () => {
  it('expands HA MQTT Discovery abbreviations and resolves ~ base topic recursively', () => {
    const raw = {
      '~': 'zigbee2mqtt/attic_motion_sensor',
      name: 'Attic Motion Sensor Illuminance',
      uniq_id: '0x00158d00045abcde_illuminance_zigbee2mqtt',
      stat_t: '~/state',
      val_tpl: '{{ value_json.illuminance_lux }}',
      dev_cla: 'illuminance',
      unit_of_meas: 'lx',
      ent_cat: 'diagnostic',
      dev: {
        ids: ['zigbee2mqtt_0x00158d00045abcde'],
        name: 'Attic Motion Sensor',
        mf: 'Aqara',
        mdl: 'RTCGQ11LM',
        sa: 'Attic',
      },
    };

    const expanded = expandHaDiscoveryPayload(raw);
    expect(expanded.unique_id).toBe('0x00158d00045abcde_illuminance_zigbee2mqtt');
    expect(expanded.state_topic).toBe('zigbee2mqtt/attic_motion_sensor/state');
    expect(expanded.value_template).toBe('{{ value_json.illuminance_lux }}');
    expect(expanded.device_class).toBe('illuminance');
    expect(expanded.unit_of_measurement).toBe('lx');
    expect(expanded.entity_category).toBe('diagnostic');

    const dev = expanded.device as Record<string, unknown>;
    expect(dev.identifiers).toEqual(['zigbee2mqtt_0x00158d00045abcde']);
    expect(dev.manufacturer).toBe('Aqara');
    expect(dev.model).toBe('RTCGQ11LM');
    expect(dev.suggested_area).toBe('Attic');
  });

  it('infers custom room IDs from suggested_area, knownRoomIds, and <Location> <Hardware Noun> labels', () => {
    expect(
      inferRoomIdFromLabels({
        suggestedArea: 'Guest Studio',
        candidateLabels: ['Ceiling Light'],
      }),
    ).toBe('guest_studio');

    expect(
      inferRoomIdFromLabels({
        candidateLabels: ['Sunroom Plant Monitor'],
        knownRoomIds: new Set(['sunroom', 'garage']),
      }),
    ).toBe('sunroom');

    expect(inferRoomIdFromLabels({ candidateLabels: ['Narnia Tube Clock'] })).toBe('narnia');
    expect(inferRoomIdFromLabels({ candidateLabels: ['Guinea Pigs Camera'] })).toBe('guinea_pigs');
    expect(inferRoomIdFromLabels({ candidateLabels: ['Server Closet Temperature Sensor'] })).toBe(
      'server_closet',
    );
    expect(inferRoomIdFromLabels({ candidateLabels: ['Kids Playroom Ceiling Fan'] })).toBe(
      'kids_playroom',
    );
  });

  it('evaluates common HA Jinja2 value_templates and builds endpoint state patches', () => {
    expect(
      evaluateValueTemplate(
        "{{ 'ON' if value_json.state.on else 'OFF' }}",
        { state: { on: true, brightness: 80 }, power: 'ON' },
        '',
      ),
    ).toBe('ON');

    expect(
      evaluateValueTemplate(
        '{{ value_json.Wifi.Signal }}',
        { Period: 4, Heap: 25, Wifi: { Signal: -52 } },
        '',
      ),
    ).toBe(-52);

    const { binding } = buildEndpointFromComponent({
      deviceId: 'mqtt_workshop_strip',
      deviceName: 'Workshop Strip',
      component: 'light',
      uniqueId: 'workshop_strip_main',
      endpointId: 'main',
      config: {
        name: 'Workshop Strip',
        state_topic: 'gv2mqtt/light/ABC123/state',
        command_topic: 'gv2mqtt/light/ABC123/command',
        brightness_scale: 100,
        supported_color_modes: ['hs', 'color_temp'],
        effect_list: ['Rainbow', 'Pulse'],
      },
    });

    const patch = extractEndpointStatePatch(
      binding,
      JSON.stringify({
        state: 'ON',
        brightness: 50,
        color: { h: 120, s: 100 },
        color_temp: 250,
        effect: 'Rainbow',
      }),
    );

    expect(patch).toEqual({
      state: 'on',
      on_off: true,
      power: true,
      brightness: 128,
      hs_color: [120, 100],
      color: { r: 0, g: 255, b: 0 },
      color_temp_kelvin: 4000,
      effect: 'Rainbow',
    });

    const rgbBack = hsToRgb(120, 100);
    expect(rgbBack).toEqual({ r: 0, g: 255, b: 0 });
    expect(rgbToHs(rgbBack.r, rgbBack.g, rgbBack.b)).toEqual({ h: 120, s: 100 });
  });

  it('evaluates producer boolean templates with default filters without executing Jinja', () => {
    const template = "{{ 'ON' if value_json.flag | default(0) else 'OFF' }}";
    expect(evaluateValueTemplate(template, { flag: 1 }, '')).toBe('ON');
    expect(evaluateValueTemplate(template, { flag: 0 }, '')).toBe('OFF');
    expect(evaluateValueTemplate(template, { flag: false }, '')).toBe('OFF');
    expect(evaluateValueTemplate(template, {}, '')).toBe('OFF');
    expect(evaluateValueTemplate(template, undefined, '')).toBe('OFF');
    expect(
      evaluateValueTemplate("{{ 'ON' if value_json.flag | default(false) else 'OFF' }}", {}, ''),
    ).toBe('OFF');
  });

  it('builds command messages for JSON-schema lights and converts RGB to HS when required', () => {
    const { binding } = buildEndpointFromComponent({
      deviceId: 'mqtt_workshop_strip',
      deviceName: 'Workshop Strip',
      component: 'light',
      uniqueId: 'workshop_strip_main',
      endpointId: 'main',
      config: {
        name: 'Workshop Strip',
        command_topic: 'gv2mqtt/light/ABC123/command',
        brightness_scale: 100,
        supported_color_modes: ['hs', 'color_temp'],
      },
    });

    const cmds = buildCommandMessages(binding, 'color', 'set', {
      brightness: 128,
      color: { r: 0, g: 0, b: 255 },
    });
    expect(cmds).toHaveLength(1);
    expect(JSON.parse(cmds[0]!.payload)).toEqual({
      state: 'ON',
      brightness: 50,
      color: { h: 240, s: 100 },
    });
  });

  it('consolidates fragmented legacy MQTT devices universally across bridges', () => {
    const deviceMap = new Map<string, HausDevice>([
      [
        'mqtt_zigbee2mqtt_0x00158d0001234567_occupancy',
        {
          id: 'mqtt_zigbee2mqtt_0x00158d0001234567_occupancy',
          name: 'Hallway Motion Sensor Occupancy',
          roomId: 'unassigned',
          category: 'occupancy_sensors',
          connectivity: { status: 'online', protocol: 'mqtt' },
          capabilities: [{ id: 'occupancy', kind: 'binary', readable: true, operations: [] }],
          endpoints: [
            {
              id: 'main',
              name: 'Hallway Motion Sensor Occupancy',
              category: 'occupancy_sensors',
              capabilities: [{ id: 'occupancy', kind: 'binary', readable: true, operations: [] }],
            },
          ],
          state: { state: 'on', occupancy: true },
        },
      ],
      [
        'mqtt_zigbee2mqtt_0x00158d0001234567_battery',
        {
          id: 'mqtt_zigbee2mqtt_0x00158d0001234567_battery',
          name: 'Hallway Motion Sensor Battery',
          roomId: 'unassigned',
          category: 'environmental_sensors',
          connectivity: { status: 'online', protocol: 'mqtt' },
          capabilities: [{ id: 'battery', kind: 'numeric', readable: true, operations: [] }],
          endpoints: [
            {
              id: 'main',
              name: 'Hallway Motion Sensor Battery',
              category: 'environmental_sensors',
              capabilities: [{ id: 'battery', kind: 'numeric', readable: true, operations: [] }],
            },
          ],
          state: { state: 95, battery: 95 },
        },
      ],
    ]);
    const endpointStateMap = new Map<string, Record<string, unknown>>([
      ['main', { occupancy: true, battery: 95 }],
    ]);

    const consolidatedCount = consolidateLegacyMqttDevices({
      listDevices: () => [...deviceMap.values()],
      registerDevice: (dev) => {
        deviceMap.set(dev.id, dev);
        return dev;
      },
      removeDevice: (id) => deviceMap.delete(id),
      getEndpointState: (epId) => endpointStateMap.get(epId) ?? {},
      updateEndpointState: async (epId, st) => {
        endpointStateMap.set(epId, st);
      },
    });

    expect(consolidatedCount).toBe(2);
    expect(deviceMap.size).toBe(1);

    const merged = deviceMap.get('mqtt_zigbee2mqtt_0x00158d0001234567')!;
    expect(merged).toBeDefined();
    expect(merged.name).toBe('Hallway Motion Sensor');
    expect(merged.roomId).toBe('hallway');
    expect(merged.category).toBe('occupancy_sensors');
    expect(merged.endpoints).toHaveLength(2);

    expect(
      resolveCommonDeviceName(
        ['Narnia Tube Clock Light', 'Narnia Tube Clock Temperature'],
        'Narnia Tube Clock Light',
      ),
    ).toBe('Narnia Tube Clock');
    expect(resolvePhysicalDeviceId('zigbee2mqtt_0x00158d0001234567_temperature')).toBe(
      'zigbee2mqtt_0x00158d0001234567',
    );
    expect(
      inferEntityCategory({
        component: 'sensor',
        id: 'rssi',
        name: 'Raspberry Pi RSSI',
      }),
    ).toBe('diagnostic');
    expect(
      inferDeviceCategory({
        id: merged.id,
        name: merged.name,
        model: 'RTCGQ11LM',
        endpoints: merged.endpoints ?? [],
      }),
    ).toBe('occupancy_sensors');
  });
});
