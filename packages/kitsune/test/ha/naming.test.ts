/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import { HacsVirtualizer } from '../../src/hacs/virtualizer.js';

describe('HacsVirtualizer HAP device naming and power command mapping', () => {
  it('names devices from deviceName rather than random first entity and preserves multi-sibling names across incremental arrivals', async () => {
    const invoked: Array<{
      domain: string;
      service: string;
      serviceData?: Record<string, unknown>;
    }> = [];
    const virt = new HacsVirtualizer(undefined, async (payload) => {
      invoked.push(payload);
    });

    virt.handleEntityAdded({
      entityId: 'light.yeelight_colora_0xe9f6873',
      name: 'Yeelight Colora 0xe9f6873',
      domain: 'light',
      state: 'on',
      attributes: { brightness: 180, supported_color_modes: ['rgb', 'color_temp'] },
      deviceId: 'dev_yeelight',
      deviceName: 'Narnia Lamp',
    });

    const lamp = virt.getDevice('dev_yeelight');
    expect(lamp?.name).toBe('Narnia Lamp');
    expect(lamp?.endpoints[0]?.id).toBe('light.yeelight_colora_0xe9f6873');
    expect(lamp?.endpoints[0]?.name).toBe('');

    // Canonical `power` capability routes cleanly to HA `light.turn_off` / `light.turn_on`.
    await virt.executeCommand({
      deviceId: 'dev_yeelight',
      endpointId: 'light.yeelight_colora_0xe9f6873',
      capability: 'power',
      value: false,
    });
    await virt.executeCommand({
      deviceId: 'dev_yeelight',
      endpointId: 'light.yeelight_colora_0xe9f6873',
      capability: 'power',
      value: true,
      parameters: { brightness: 75 },
    });
    expect(invoked).toEqual([
      {
        domain: 'light',
        service: 'turn_off',
        serviceData: { entity_id: 'light.yeelight_colora_0xe9f6873' },
      },
      {
        domain: 'light',
        service: 'turn_on',
        serviceData: { entity_id: 'light.yeelight_colora_0xe9f6873', brightness: 191 },
      },
    ]);

    // Incremental arrival of two temperature sensors must retain both disambiguated labels.
    virt.handleEntityAdded({
      entityId: 'sensor.outdoor_weather_temperature',
      name: 'Outdoor Weather Temperature',
      domain: 'sensor',
      state: '18.2',
      attributes: { device_class: 'temperature', unit_of_measurement: '°C' },
      deviceId: 'dev_weather',
      deviceName: 'Outdoor Weather',
    });
    expect(virt.getDevice('dev_weather')?.endpoints[0]?.name).toBe('');

    virt.handleEntityAdded({
      entityId: 'sensor.outdoor_weather_feels_like',
      name: 'Outdoor Weather Apparent temperature',
      domain: 'sensor',
      state: '17.0',
      attributes: { device_class: 'temperature', unit_of_measurement: '°C' },
      deviceId: 'dev_weather',
      deviceName: 'Outdoor Weather',
    });
    expect(virt.getDevice('dev_weather')?.endpoints.map((ep) => ep.name)).toEqual([
      'Temperature',
      'Apparent temperature',
    ]);
  });

  it('upgrades an entity-seeded device name as soon as an authoritative deviceName arrives', () => {
    const virt = new HacsVirtualizer(
      undefined,
      vi.fn(async () => {}),
    );
    virt.handleEntityAdded({
      entityId: 'sensor.foxymeter_humidity',
      name: 'Foxymeter Humidity',
      domain: 'sensor',
      state: '45',
      attributes: { device_class: 'humidity', unit_of_measurement: '%' },
      deviceId: 'dev_foxy',
    });
    expect(virt.getDevice('dev_foxy')?.name).toBe('Foxymeter Humidity');

    virt.handleEntityAdded({
      entityId: 'sensor.foxymeter_temperature',
      name: 'Foxymeter Temperature',
      domain: 'sensor',
      state: '22.4',
      attributes: { device_class: 'temperature', unit_of_measurement: '°C' },
      deviceId: 'dev_foxy',
      deviceName: 'Narnia Temperature',
    });
    const upgraded = virt.getDevice('dev_foxy');
    expect(upgraded?.name).toBe('Narnia Temperature');
    expect(upgraded?.endpoints.map((ep) => ep.name)).toEqual(['', '']);
  });

  it('defaults single-key remote commands to delay_secs: 0 and forwards hold_secs', async () => {
    const dispatched: Array<{
      domain: string;
      service: string;
      serviceData?: Record<string, unknown>;
    }> = [];
    const virt = new HacsVirtualizer(undefined, async (payload) => {
      dispatched.push(payload);
    });
    virt.handleEntityAdded({
      entityId: 'remote.bedroom_apple_tv',
      name: 'Bedroom Apple TV',
      domain: 'remote',
      state: 'on',
      attributes: {},
      deviceId: 'dev_atv',
      deviceName: 'Bedroom Apple TV',
    });

    await virt.executeCommand({
      deviceId: 'dev_atv',
      endpointId: 'remote.bedroom_apple_tv',
      capability: 'remote_key',
      value: 'down',
      parameters: { command: 'down', key: 'down' },
    });
    await virt.executeCommand({
      deviceId: 'dev_atv',
      endpointId: 'remote.bedroom_apple_tv',
      capability: 'remote_key',
      value: 'home',
      parameters: { command: 'home', hold_secs: 1 },
    });

    expect(dispatched).toEqual([
      {
        domain: 'remote',
        service: 'send_command',
        serviceData: { entity_id: 'remote.bedroom_apple_tv', command: 'down', delay_secs: 0 },
      },
      {
        domain: 'remote',
        service: 'send_command',
        serviceData: {
          entity_id: 'remote.bedroom_apple_tv',
          command: 'home',
          hold_secs: 1,
          delay_secs: 0,
        },
      },
    ]);
  });
});
