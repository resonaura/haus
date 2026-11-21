/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  DeviceCategory,
  DeviceRegistry,
  Protocol,
  matchesTrigger,
  type HausDevice,
} from '../../src/index.js';

describe('HAP device collapsing, characteristic naming, and canonical power type', () => {
  it('clears redundant entity names on standard unique characteristics and uses canonical power', () => {
    const registry = new DeviceRegistry();
    const lamp = registry.registerDevice({
      id: 'ha:entry:lamp',
      name: 'Narnia Lamp',
      category: DeviceCategory.Lighting,
      connectivity: { protocol: Protocol.Virtual },
      availability: 'online',
      source: { instanceId: 'ha:entry', externalId: 'lamp' },
      endpoints: [
        {
          id: 'light.yeelight_colora_0xe9f6873',
          name: 'Yeelight Colora 0xe9f6873',
          category: DeviceCategory.Lighting,
          capabilities: [
            { id: 'on_off', kind: 'binary', readable: true, operations: ['turn_on', 'turn_off'] },
            { id: 'brightness', kind: 'numeric', readable: true, operations: ['set'] },
            { id: 'color_temp', kind: 'numeric', readable: true, operations: ['set'] },
          ],
          readings: {},
        },
      ],
    });

    expect(lamp.name).toBe('Narnia Lamp');
    expect(lamp.endpoints).toHaveLength(1);
    expect(lamp.endpoints[0]?.id).toBe('light.yeelight_colora_0xe9f6873');
    expect(lamp.endpoints[0]?.name).toBe('');
    expect(lamp.services).toHaveLength(1);
    expect(lamp.services?.[0]?.type).toBe('Lightbulb');
    expect(lamp.services?.[0]?.name).toBeUndefined();
    expect(lamp.services?.[0]?.characteristics.map((c) => c.type)).toEqual([
      'power',
      'brightness',
      'color_temp',
    ]);
    expect(lamp.services?.[0]?.characteristics.every((c) => c.customName === undefined)).toBe(true);
    expect(lamp.services?.[0]?.characteristics[0]?.sourceRefs[0]?.externalId).toBe(
      'light.yeelight_colora_0xe9f6873:on_off',
    );
  });

  it('distinguishes boolean power control from numeric electrical_power sensors and splits multi-cap sensors', () => {
    const registry = new DeviceRegistry();
    const plug = registry.registerDevice({
      id: 'tuya:washer',
      name: 'Washing Machine',
      category: DeviceCategory.Power,
      connectivity: { protocol: Protocol.LocalIp },
      availability: 'online',
      source: { instanceId: 'tuya', externalId: 'washer' },
      endpoints: [
        {
          id: 'ep_tuya_washer_switch_1',
          name: 'Washing Machine',
          capabilities: [
            { id: 'on_off', kind: 'binary', readable: true, operations: ['turn_on', 'turn_off'] },
          ],
          readings: {},
        },
        {
          id: 'ep_tuya_washer_sensors',
          name: 'Washing Machine Telemetry',
          capabilities: [
            {
              id: 'power',
              kind: 'numeric',
              readable: true,
              operations: [],
              deviceClass: 'power',
              unit: 'W',
            },
            {
              id: 'running',
              kind: 'binary',
              readable: true,
              operations: [],
              deviceClass: 'running',
            },
          ],
          readings: {},
        },
      ],
    });

    expect(plug.endpoints.map((ep) => [ep.id, ep.name])).toEqual([
      ['ep_tuya_washer_switch_1', ''],
      ['ep_tuya_washer_sensors', ''],
    ]);
    expect(plug.services?.map((svc) => svc.type)).toEqual(['Switch', 'PowerManagement']);
    expect(plug.services?.[0]?.characteristics.map((c) => c.type)).toEqual(['power']);
    expect(plug.services?.[1]?.characteristics.map((c) => c.type)).toEqual([
      'electrical_power',
      'running',
    ]);

    const door = registry.registerDevice({
      id: 'hk_door_1',
      name: 'Living Room Entrance',
      category: DeviceCategory.EnvironmentalSensors,
      connectivity: { protocol: Protocol.HomeKit },
      availability: 'online',
      source: { instanceId: 'homekit', externalId: 'aid_37' },
      endpoints: [
        {
          id: 'ep_hk_door_1',
          name: 'Contact Sensor 2',
          capabilities: [
            { id: 'contact', kind: 'contact', readable: true, operations: [] },
            {
              id: 'battery',
              kind: 'numeric',
              readable: true,
              operations: [],
              entityCategory: 'diagnostic',
            },
          ],
          readings: {},
        },
      ],
    });
    expect(door.endpoints[0]?.name).toBe('');
    expect(door.services?.map((svc) => svc.type)).toEqual(['ContactSensor', 'Battery']);
    expect(door.services?.every((svc) => svc.name === undefined)).toBe(true);
  });

  it('keeps stripped custom names ONLY for custom HA controls and multi-channel siblings, and is idempotent', () => {
    const registry = new DeviceRegistry();
    const raw: HausDevice = {
      id: 'ha:sensibo:ac',
      name: 'TV Place AC',
      category: DeviceCategory.Climate,
      connectivity: { protocol: Protocol.Virtual },
      availability: 'online',
      source: { instanceId: 'ha:sensibo', externalId: 'ac' },
      endpoints: [
        {
          id: 'climate.tv_place_ac',
          name: 'TV Place AC',
          capabilities: [
            { id: 'climate', kind: 'climate', readable: true, operations: ['set_hvac_mode'] },
            { id: 'on_off', kind: 'binary', readable: true, operations: ['turn_on', 'turn_off'] },
          ],
          readings: {},
        },
        {
          id: 'sensor.tv_place_ac_co2',
          name: 'TV Place AC AirQ CO2',
          capabilities: [{ id: 'co2', kind: 'numeric', readable: true, operations: [] }],
          readings: {},
        },
        {
          id: 'binary_sensor.tv_place_ac_filter_clean_required',
          name: 'TV Place AC Filter clean required',
          capabilities: [
            {
              id: 'problem',
              kind: 'binary',
              readable: true,
              operations: [],
              deviceClass: 'problem',
            },
          ],
          readings: {},
        },
        {
          id: 'button.tv_place_ac_reset_filter',
          name: 'TV Place AC Reset filter',
          capabilities: [
            {
              id: 'button',
              kind: 'event',
              readable: false,
              operations: ['press'],
              entityCategory: 'config',
            },
          ],
          readings: {},
        },
      ],
    };

    const first = registry.registerDevice(raw);
    const second = registry.registerDevice(first);
    expect(second).toEqual(first);

    expect(first.endpoints.map((ep) => [ep.id, ep.name])).toEqual([
      ['climate.tv_place_ac', ''],
      ['sensor.tv_place_ac_co2', ''],
      ['binary_sensor.tv_place_ac_filter_clean_required', 'Filter clean required'],
      ['button.tv_place_ac_reset_filter', 'Reset filter'],
    ]);
    expect(first.services?.find((s) => s.type === 'Thermostat')?.name).toBeUndefined();
    expect(first.services?.find((s) => s.type === 'CarbonDioxideSensor')?.name).toBeUndefined();
    expect(first.services?.find((s) => s.type === 'Generic')?.characteristics[0]?.customName).toBe(
      'Filter clean required',
    );
    expect(first.services?.find((s) => s.type === 'Config')?.characteristics[0]?.customName).toBe(
      'Reset filter',
    );

    // Shared model prefix stripping & multi-channel button disambiguation.
    const scale = registry.registerDevice({
      id: 'ha:eufy:scale',
      name: 'Living Room Scale',
      category: DeviceCategory.EnvironmentalSensors,
      connectivity: { protocol: Protocol.Virtual },
      availability: 'online',
      source: { instanceId: 'ha:eufy', externalId: 'scale' },
      endpoints: [
        {
          id: 'sensor.living_room_scale_real_time_weight',
          name: 'Smart Scale P3 Real-time weight',
          capabilities: [
            { id: 'value', kind: 'numeric', readable: true, operations: [], deviceClass: 'weight' },
          ],
          readings: {},
        },
        {
          id: 'sensor.living_room_scale_weight',
          name: 'Smart Scale P3 Weight',
          capabilities: [
            { id: 'value', kind: 'numeric', readable: true, operations: [], deviceClass: 'weight' },
          ],
          readings: {},
        },
      ],
    });
    expect(scale.endpoints.map((ep) => ep.name)).toEqual(['Real-time weight', 'Weight']);
  });

  it('matches boolean power and on_off automation triggers interchangeably without matching numeric wattage', () => {
    expect(
      matchesTrigger(
        { type: 'state', endpointId: 'light.lamp', property: 'power', to: true },
        { type: 'state', endpointId: 'light.lamp', property: 'on_off', from: false, to: true },
      ),
    ).toBe(true);
    expect(
      matchesTrigger(
        { type: 'state', endpointId: 'switch.plug', property: 'on_off', to: 'on' },
        { type: 'state', endpointId: 'switch.plug', property: 'power', from: false, to: true },
      ),
    ).toBe(true);
    expect(
      matchesTrigger(
        { type: 'state', endpointId: 'ep_sensors', property: 'on_off', to: true },
        { type: 'state', endpointId: 'ep_sensors', property: 'power', from: 0, to: 120 },
      ),
    ).toBe(false);
  });

  it('classifies multi-light independent bulbs vs segment sub-zones in Hub presentation metadata', () => {
    const registry = new DeviceRegistry();
    const dualLight = registry.registerDevice({
      id: 'ha:dual_ceiling',
      source: { instanceId: 'ha:e1', externalId: 'dual_ceiling' },
      name: 'Living Room Ceiling',
      category: 'lighting',
      connectivity: { protocol: 'local_ip' },
      availability: 'online',
      endpoints: [
        {
          id: 'light.living_room_ceiling_main',
          name: 'Living Room Ceiling Main',
          category: 'lighting',
          capabilities: [
            {
              id: 'on_off',
              kind: 'binary',
              readable: true,
              operations: ['set', 'turn_on', 'turn_off'],
            },
            { id: 'brightness', kind: 'numeric', readable: true, operations: ['set'] },
          ],
          readings: {},
        },
        {
          id: 'light.living_room_ceiling_nightlight',
          name: 'Living Room Ceiling Nightlight',
          category: 'lighting',
          capabilities: [
            {
              id: 'on_off',
              kind: 'binary',
              readable: true,
              operations: ['set', 'turn_on', 'turn_off'],
            },
          ],
          readings: {},
        },
      ],
      services: [],
    });

    const lightServices = (dualLight.services ?? []).filter((s) => s.type === 'Lightbulb');
    expect(lightServices).toHaveLength(2);
    expect(lightServices.map((s) => s.name)).toEqual(['Main', 'Nightlight']);
    expect(dualLight.opaqueMetadata?.presentation).toEqual({
      deviceType: 'light',
      independentLightEndpoints: [
        'light.living_room_ceiling_main',
        'light.living_room_ceiling_nightlight',
      ],
    });

    const segmented = registry.registerDevice({
      id: 'mqtt_bed_lamp',
      source: { instanceId: 'mqtt', externalId: 'bed_lamp' },
      name: 'Bedroom Bed Lamp',
      category: 'lighting',
      connectivity: { protocol: 'mqtt' },
      availability: 'online',
      endpoints: [
        {
          id: 'ep_main',
          name: '',
          capabilities: [
            { id: 'on_off', kind: 'binary', readable: true, operations: ['set'] },
            { id: 'brightness', kind: 'numeric', readable: true, operations: ['set'] },
          ],
          readings: {},
        },
        {
          id: 'ep_seg_1',
          name: 'Segment 001',
          capabilities: [
            { id: 'on_off', kind: 'binary', readable: true, operations: ['set'] },
            { id: 'color', kind: 'complex', readable: true, operations: ['set'] },
          ],
          readings: {},
        },
      ],
      services: [],
    });
    expect(segmented.opaqueMetadata?.presentation).toEqual({
      deviceType: 'light',
      segmentLightEndpoints: ['ep_seg_1'],
    });
  });
});
