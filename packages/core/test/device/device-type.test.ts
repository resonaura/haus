/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  DeviceRegistry,
  DEVICE_TYPES,
  isDeviceType,
  type HausDevice,
  type HausEndpoint,
} from '../../src/device/index.js';

function outletEndpoint(id: string, name: string, deviceClass?: string): HausEndpoint {
  return {
    id,
    name,
    category: 'power',
    capabilities: [
      {
        id: 'on_off',
        kind: 'binary',
        readable: true,
        operations: ['set', 'turn_on', 'turn_off'],
        ...(deviceClass ? { deviceClass } : {}),
      },
    ],
    readings: {},
  };
}

describe('Canonical DeviceType & PowerStrip standard', () => {
  it('validates canonical DeviceType taxonomy beyond a single type', () => {
    expect(DEVICE_TYPES.length).toBeGreaterThan(10);
    for (const type of ['power_strip', 'outlet', 'light', 'light_strip', 'camera', 'kettle']) {
      expect(isDeviceType(type)).toBe(true);
    }
    expect(isDeviceType('unknown_widget')).toBe(false);
  });

  it('classifies a multi-outlet power strip with optional master switch into Outlet services', () => {
    const registry = new DeviceRegistry();
    const device: HausDevice = {
      id: 'ha:meross:strip',
      name: 'Bedroom Desk Surge Protector',
      category: 'power',
      manufacturer: 'Meross',
      model: 'mss425f-eu',
      availability: 'online',
      source: { instanceId: 'ha:meross', externalId: 'strip' },
      connectivity: { protocol: 'ha' },
      endpoints: [
        outletEndpoint(
          'switch.bedroom_desk_surge_protector_power',
          'Bedroom Desk Surge Protector Power',
          'outlet',
        ),
        outletEndpoint(
          'switch.bedroom_desk_surge_protector_socket_4',
          'Bedroom Desk Surge Protector Socket 4',
          'outlet',
        ),
        outletEndpoint(
          'switch.bedroom_desk_surge_protector_wall_garland',
          'Bedroom Desk Surge Protector Wall Garland',
          'outlet',
        ),
        outletEndpoint(
          'switch.bedroom_desk_surge_protector_usb',
          'Bedroom Desk Surge Protector USB',
          'outlet',
        ),
      ],
    };

    const registered = registry.registerDevice(device);
    expect(registered.deviceType).toBe('power_strip');
    const presentation = registered.opaqueMetadata?.['presentation'] as {
      deviceType?: string;
      powerStrip?: { masterEndpointId?: string; outletEndpointIds: string[] };
    };
    expect(presentation.deviceType).toBe('power_strip');
    expect(presentation.powerStrip?.masterEndpointId).toBe(
      'switch.bedroom_desk_surge_protector_power',
    );
    expect(presentation.powerStrip?.outletEndpointIds).toEqual([
      'switch.bedroom_desk_surge_protector_socket_4',
      'switch.bedroom_desk_surge_protector_wall_garland',
      'switch.bedroom_desk_surge_protector_usb',
    ]);

    const outlets = (registered.services ?? []).filter((svc) => svc.type === 'Outlet');
    expect(outlets).toHaveLength(4);
    expect(
      outlets.find((svc) => svc.subtype === 'switch.bedroom_desk_surge_protector_power')
        ?.opaqueMetadata?.['outletRole'],
    ).toBe('master');
    expect(
      outlets.find((svc) => svc.subtype === 'switch.bedroom_desk_surge_protector_wall_garland')
        ?.opaqueMetadata?.['outletRole'],
    ).toBe('outlet');
  });

  it('promotes a previously single-outlet device to power_strip when folded channels arrive', () => {
    const registry = new DeviceRegistry();
    const initial = registry.registerDevice({
      id: 'ha:meross:outdoor',
      name: 'Outdoor Main Power Hub',
      category: 'power',
      availability: 'online',
      source: { instanceId: 'ha:meross', externalId: 'outdoor' },
      connectivity: { protocol: 'ha' },
      endpoints: [outletEndpoint('switch.outdoor_power', 'Outdoor Main Power Hub Power', 'outlet')],
    });
    expect(initial.deviceType).toBe('outlet');

    const promoted = registry.registerDevice({
      ...initial,
      endpoints: [
        outletEndpoint('switch.outdoor_power', 'Outdoor Main Power Hub Power', 'outlet'),
        outletEndpoint(
          'switch.outdoor_veronika',
          'Outdoor Main Power Hub Veronika Power Strip',
          'outlet',
        ),
        outletEndpoint('switch.outdoor_flood', 'Outdoor Main Power Hub Side Flood Light', 'outlet'),
      ],
    });
    expect(promoted.deviceType).toBe('power_strip');
    const presentation = promoted.opaqueMetadata?.['presentation'] as {
      powerStrip?: { masterEndpointId?: string; outletEndpointIds: string[] };
    };
    expect(presentation.powerStrip?.masterEndpointId).toBe('switch.outdoor_power');
    expect(presentation.powerStrip?.outletEndpointIds).toEqual([
      'switch.outdoor_veronika',
      'switch.outdoor_flood',
    ]);
  });

  it('classifies Tuya multi-socket power strip without master switch as power_strip with Outlet services', () => {
    const registry = new DeviceRegistry();
    const registered = registry.registerDevice({
      id: 'tuya:sw023',
      name: 'Workspace',
      category: 'power',
      deviceType: 'power_strip',
      model: 'MERKURY SW023',
      availability: 'online',
      source: { instanceId: 'tuya', externalId: 'sw023' },
      connectivity: { protocol: 'local_ip' },
      endpoints: [
        outletEndpoint('ep_tuya_sw023_switch_1', 'Switch 1'),
        outletEndpoint('ep_tuya_sw023_switch_2', 'Switch 2'),
        outletEndpoint('ep_tuya_sw023_switch_3', 'Switch 3'),
        outletEndpoint('ep_tuya_sw023_switch_4', 'Switch 4'),
      ],
    });

    expect(registered.deviceType).toBe('power_strip');
    expect((registered.services ?? []).every((svc) => svc.type === 'Outlet')).toBe(true);
    const presentation = registered.opaqueMetadata?.['presentation'] as {
      powerStrip?: { masterEndpointId?: string; outletEndpointIds: string[] };
    };
    expect(presentation.powerStrip?.masterEndpointId).toBeUndefined();
    expect(presentation.powerStrip?.outletEndpointIds).toHaveLength(4);
  });

  it('resolves distinct DeviceTypes across standard smart-home archetypes', () => {
    const registry = new DeviceRegistry();
    const bulb = registry.registerDevice({
      id: 'hue:bulb',
      name: 'Hallway Bulb',
      category: 'lighting',
      availability: 'online',
      source: { instanceId: 'ha:hue', externalId: 'bulb' },
      connectivity: { protocol: 'ha' },
      endpoints: [
        {
          id: 'light.hallway',
          name: 'Hallway Bulb',
          category: 'lighting',
          capabilities: [
            { id: 'on_off', kind: 'binary', readable: true, operations: ['set'] },
            { id: 'brightness', kind: 'numeric', readable: true, operations: ['set'] },
          ],
          readings: {},
        },
      ],
    });
    expect(bulb.deviceType).toBe('light');

    const dial = registry.registerDevice({
      id: 'hue:dial',
      name: 'Bedroom Multi Switch',
      category: 'generic',
      availability: 'online',
      source: { instanceId: 'ha:hue', externalId: 'dial' },
      connectivity: { protocol: 'ha' },
      endpoints: [
        {
          id: 'event.dial_button_1',
          name: 'Button 1',
          capabilities: [{ id: 'event', kind: 'event', readable: true, operations: [] }],
          readings: {},
        },
      ],
    });
    expect(dial.deviceType).toBe('button_controller');

    const bridge = registry.registerDevice({
      id: 'hue:bridge',
      name: 'Hue Bridge',
      model: 'Hue Bridge',
      category: 'network',
      availability: 'online',
      source: { instanceId: 'ha:hue', externalId: 'bridge' },
      connectivity: { protocol: 'ha' },
      endpoints: [],
    });
    expect(bridge.deviceType).toBe('bridge');

    for (const type of ['network_switch', 'repeater', 'access_point', 'modem', 'firewall', 'nas']) {
      expect(isDeviceType(type)).toBe(true);
    }

    const netSwitch = registry.registerDevice({
      id: 'net:entry_1',
      name: 'Core Switch',
      category: 'network',
      deviceType: 'network_switch',
      availability: 'online',
      source: { instanceId: 'entry_1', externalId: 'http://192.168.4.2/' },
      connectivity: { protocol: 'local_ip', address: '192.168.4.2' },
      opaqueMetadata: { managementUrl: 'http://192.168.4.2/' },
      endpoints: [],
    });
    expect(netSwitch.deviceType).toBe('network_switch');
    expect(
      (netSwitch.opaqueMetadata?.['presentation'] as { managementUrl?: string } | undefined)
        ?.managementUrl,
    ).toBe('http://192.168.4.2/');

    const unsafeUrl = registry.registerDevice({
      id: 'net:entry_unsafe',
      name: 'Bad URL',
      category: 'network',
      deviceType: 'router',
      availability: 'online',
      source: { instanceId: 'entry_unsafe', externalId: 'bad' },
      connectivity: { protocol: 'local_ip' },
      opaqueMetadata: { managementUrl: 'http://admin:secret@192.168.4.1/' },
      endpoints: [],
    });
    expect(
      (unsafeUrl.opaqueMetadata?.['presentation'] as { managementUrl?: string } | undefined)
        ?.managementUrl,
    ).toBeUndefined();
  });

  it('ignores untyped legacy protocol service refs without throwing during presentation resolution', () => {
    const registry = new DeviceRegistry();
    const legacyPayload = JSON.parse(
      JSON.stringify({
        id: 'device-hallway-motion',
        name: 'Hallway Motion',
        category: 'sensor',
        availability: 'online',
        source: { instanceId: 'standalone', externalId: 'device-hallway-motion' },
        connectivity: { protocol: 'virtual' },
        endpoints: [],
        services: [{ protocol: 'zigbee', externalId: 'zb-motion-1' }],
      }),
    );
    const registered = registry.registerDevice(legacyPayload);
    expect(registered.id).toBe('device-hallway-motion');
    expect(registered.deviceType).toBe('generic');
  });
});
