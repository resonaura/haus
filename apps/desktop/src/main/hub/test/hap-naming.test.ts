/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { stripMasterOutlet, stripOutlets } from '@haus/ha/view/device-relationships';
import { normalizeHome } from '@haus/ha/view/normalize';
import type { Snapshot } from '@haus/ha/view/types';
import { buildView } from '../entities';
import { toHubDeviceTriggers } from '../management/hub-ha-device-triggers';
import { parseDevices, parseStates } from '../types';

function toSnapshot(view: ReturnType<typeof buildView>): Snapshot {
  return {
    states: view.states.map((s) => ({ ...s })),
    devices: view.devices as Snapshot['devices'],
    entities: view.entities as Snapshot['entities'],
    areas: view.areas as Snapshot['areas'],
    services: {
      light: { turn_on: {}, turn_off: {} },
      switch: { turn_on: {}, turn_off: {} },
      climate: { set_temperature: {}, set_hvac_mode: {}, turn_on: {}, turn_off: {} },
      button: { press: {} },
    },
    config: { location_name: 'Haus' },
    user: { name: 'Owner', is_admin: true },
  };
}

describe('HAP device titles and nameless characteristics in Hub compat view', () => {
  it('titles accessories by device.name and derives clean characteristic labels for empty endpoint names', () => {
    const devices = parseDevices({
      devices: [
        {
          id: 'ha:yeelight:lamp',
          name: 'Narnia Lamp',
          category: 'lighting',
          roomId: 'narnia',
          availability: 'online',
          connectivity: { protocol: 'virtual' },
          endpoints: [
            {
              id: 'light.yeelight_colora_0xe9f6873',
              name: '',
              capabilities: [
                { id: 'on_off', kind: 'binary', operations: ['turn_on', 'turn_off'] },
                { id: 'brightness', kind: 'numeric', operations: ['set'] },
                { id: 'color_temp', kind: 'numeric', operations: ['set'] },
              ],
            },
          ],
        },
        {
          id: 'ha:foxy:temp',
          name: 'Narnia Temperature',
          category: 'environmental_sensors',
          roomId: 'narnia',
          availability: 'online',
          connectivity: { protocol: 'virtual' },
          endpoints: [
            {
              id: 'sensor.foxymeter_humidity',
              name: '',
              capabilities: [{ id: 'humidity', kind: 'numeric', operations: [], unit: '%' }],
            },
            {
              id: 'sensor.foxymeter_temperature',
              name: '',
              capabilities: [{ id: 'temperature', kind: 'numeric', operations: [], unit: '°C' }],
            },
          ],
        },
        {
          id: 'hk_door',
          name: 'Living Room Entrance',
          category: 'environmental_sensors',
          roomId: 'living_room',
          availability: 'online',
          connectivity: { protocol: 'homekit' },
          endpoints: [
            {
              id: 'ep_hk_door',
              name: '',
              capabilities: [
                { id: 'contact', kind: 'contact', operations: [] },
                {
                  id: 'battery',
                  kind: 'numeric',
                  operations: [],
                  unit: '%',
                  entityCategory: 'diagnostic',
                },
              ],
            },
          ],
        },
        {
          id: 'ha:sensibo:ac',
          name: 'TV Place AC',
          category: 'climate',
          roomId: 'tv_place',
          availability: 'online',
          connectivity: { protocol: 'virtual' },
          endpoints: [
            {
              id: 'climate.tv_place_ac',
              name: '',
              capabilities: [
                {
                  id: 'climate',
                  kind: 'climate',
                  operations: ['set_hvac_mode', 'set_temperature'],
                },
                { id: 'on_off', kind: 'binary', operations: ['turn_on', 'turn_off'] },
              ],
            },
            {
              id: 'binary_sensor.tv_place_ac_filter_clean_required',
              name: 'Filter clean required',
              capabilities: [
                { id: 'problem', kind: 'binary', operations: [], deviceClass: 'problem' },
              ],
            },
          ],
        },
      ],
    });

    // parseEndpoint must preserve empty string "" rather than falling back to endpoint.id.
    expect(devices[0]?.endpoints[0]?.name).toBe('');
    expect(devices[1]?.endpoints.map((ep) => ep.name)).toEqual(['', '']);

    const states = parseStates({
      states: {
        'light.yeelight_colora_0xe9f6873': { on_off: true, brightness: 200 },
        'sensor.foxymeter_humidity': { humidity: 48 },
        'sensor.foxymeter_temperature': { temperature: 22.1 },
        ep_hk_door: { contact: true, battery: 95 },
        'climate.tv_place_ac': { hvac_mode: 'cool', temperature: 21, current_temperature: 23 },
        'binary_sensor.tv_place_ac_filter_clean_required': { problem: false },
      },
    });

    const view = buildView(devices, states, '2026-11-20T00:00:00Z');
    const home = normalizeHome(toSnapshot(view));

    const byDeviceId = new Map(home.accessories.map((acc) => [acc.deviceId, acc]));
    expect(byDeviceId.get('ha:yeelight:lamp')?.name).toBe('Narnia Lamp');
    expect(byDeviceId.get('ha:foxy:temp')?.name).toBe('Narnia Temperature');
    expect(byDeviceId.get('hk_door')?.name).toBe('Living Room Entrance');
    expect(byDeviceId.get('ha:sensibo:ac')?.name).toBe('TV Place AC');

    const ac = byDeviceId.get('ha:sensibo:ac');
    const filterSensor = ac?.secondaryEntities.find((item) =>
      item.entity_id.startsWith('binary_sensor.'),
    );
    expect(filterSensor?.attributes.friendly_name).toBe('TV Place AC Filter clean required');
    const door = byDeviceId.get('hk_door');
    expect(door?.batteryLevel).toBe(95);
    expect(door?.state.attributes.friendly_name).toBe('Living Room Entrance');
  });

  it('keeps Hue button and Xiaomi BLE dimmer triggers resolvable after HAP naming cleanup', () => {
    const devices = parseDevices({
      devices: [
        {
          id: 'ha:hue:wall',
          source: { instanceId: 'ha:hue', externalId: 'hue-wall-1' },
          name: 'Bedroom Wall Switch',
          category: 'generic',
          availability: 'online',
          connectivity: { protocol: 'virtual' },
          endpoints: [
            {
              id: 'event.bedroom_wall_switch_button_1',
              name: 'Button 1',
              capabilities: [
                { id: 'event', kind: 'event', operations: [], choices: ['initial_press'] },
              ],
            },
            {
              id: 'event.bedroom_wall_switch_button_2',
              name: 'Button 2',
              capabilities: [
                { id: 'event', kind: 'event', operations: [], choices: ['initial_press'] },
              ],
            },
            {
              id: 'sensor.bedroom_wall_switch_battery',
              name: '',
              capabilities: [
                { id: 'battery', kind: 'numeric', operations: [], entityCategory: 'diagnostic' },
              ],
            },
          ],
        },
        {
          id: 'ha:xiaomi:dimmer',
          source: { instanceId: 'ha:xiaomi', externalId: 'dimmer-1' },
          name: 'Living Room Dimmer Switch',
          category: 'generic',
          availability: 'online',
          connectivity: { protocol: 'virtual' },
          endpoints: [
            {
              id: 'event.living_room_dimmer_switch_dimmer',
              name: 'Dimmer',
              capabilities: [
                { id: 'event', kind: 'event', operations: [], choices: ['press', 'rotate_right'] },
              ],
            },
          ],
        },
      ],
    });

    const view = buildView(devices, {});
    expect(
      toHubDeviceTriggers(
        { device_id: 'hue-wall-1', domain: 'hue', type: 'initial_press', subtype: '2' },
        view,
      ),
    ).toEqual([
      {
        type: 'event',
        eventType: 'initial_press',
        endpointId: 'event.bedroom_wall_switch_button_2',
      },
    ]);
    expect(
      toHubDeviceTriggers(
        { device_id: 'dimmer-1', domain: 'xiaomi_ble', type: 'dimmer', subtype: 'rotate_right' },
        view,
      ),
    ).toEqual([
      {
        type: 'event',
        eventType: 'rotate_right',
        endpointId: 'event.living_room_dimmer_switch_dimmer',
      },
    ]);
  });

  it('projects a Hub power_strip device as one accessory with master vs individual outlet roles', () => {
    const devices = parseDevices({
      devices: [
        {
          id: 'ha:meross:strip',
          source: { instanceId: 'ha:meross', externalId: 'strip' },
          name: 'Desk Hub',
          category: 'power',
          deviceType: 'power_strip',
          roomId: 'bedroom',
          availability: 'online',
          connectivity: { protocol: 'ha' },
          opaqueMetadata: {
            presentation: {
              deviceType: 'power_strip',
              powerStrip: {
                masterEndpointId: 'switch.strip_power',
                outletEndpointIds: ['switch.strip_garland', 'switch.strip_usb'],
              },
            },
          },
          endpoints: [
            {
              id: 'switch.strip_power',
              name: 'Power',
              capabilities: [
                {
                  id: 'on_off',
                  kind: 'binary',
                  operations: ['set', 'turn_on', 'turn_off'],
                  deviceClass: 'outlet',
                },
              ],
            },
            {
              id: 'switch.strip_garland',
              name: 'Wall Garland',
              capabilities: [
                {
                  id: 'on_off',
                  kind: 'binary',
                  operations: ['set', 'turn_on', 'turn_off'],
                  deviceClass: 'outlet',
                },
              ],
            },
            {
              id: 'switch.strip_usb',
              name: 'USB',
              capabilities: [
                {
                  id: 'on_off',
                  kind: 'binary',
                  operations: ['set', 'turn_on', 'turn_off'],
                  deviceClass: 'outlet',
                },
              ],
            },
          ],
        },
      ],
    });
    const states = parseStates({
      states: {
        'switch.strip_power': { on_off: true },
        'switch.strip_garland': { on_off: true },
        'switch.strip_usb': { on_off: false },
      },
    });
    const view = buildView(devices, states, '2026-11-21T00:00:00Z');
    const home = normalizeHome(toSnapshot(view));

    const stripAccessories = home.accessories.filter((a) => a.deviceId === 'ha:meross:strip');
    expect(stripAccessories).toHaveLength(1);
    const strip = stripAccessories[0]!;
    expect(strip.powerStrip).toBe(true);
    expect(stripOutlets(strip)).toHaveLength(2);
    expect(stripMasterOutlet(strip)?.attributes.haus_outlet_role).toBe('master');
  });
});
