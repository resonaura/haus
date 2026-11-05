/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import { DeviceCategory, Protocol } from '@haus/core/device';
import { parseAddress } from '@haus/core/identity';
import {
  buildCanonicalAddress,
  extractReadOnlyHaInventory,
  HaDeviceMigrator,
  InMemoryDeviceRegistry,
  inferProtocolFromIdentifiers,
  normalizeHaInventory,
  slugifySegment,
  type LegacyHaArea,
  type LegacyHaDevice,
  type LegacyHaEntityEntry,
  type LegacyHaInventory,
  type LegacyHaState,
} from '../src/index.js';

describe('P6.3: Optional Legacy HA Import & Device Migration', () => {
  const sampleAreas: LegacyHaArea[] = [
    { area_id: 'living_room', name: 'Living Room', icon: 'mdi:sofa' },
    { area_id: 'kitchen', name: 'Kitchen', icon: 'mdi:silverware' },
    { area_id: 'hallway', name: 'Front Hallway' },
  ];

  const sampleDevices: LegacyHaDevice[] = [
    {
      id: 'dev_philips_hue_living',
      name: 'Living Room Chandelier',
      area_id: 'living_room',
      manufacturer: 'Signify Netherlands B.V.',
      model: 'LCT015',
      sw_version: '1.108.7',
      identifiers: [['zigbee', '00:17:88:01:04:ae:12:34']],
    },
    {
      id: 'dev_multi_gang_relay',
      name: 'Kitchen Multi-Gang Relay',
      area_id: 'kitchen',
      manufacturer: 'Aqara',
      model: 'LLKZMK11LM',
      sw_version: '2.0.1',
      identifiers: [['zigbee', '00:15:8d:00:03:ab:cd:ef']],
    },
    {
      id: 'dev_nest_thermostat',
      name: 'Hallway Climate',
      area_id: 'hallway',
      manufacturer: 'Google Nest',
      model: 'Learning Thermostat',
      identifiers: [['matter', 'node_42']],
    },
  ];

  const sampleEntities: LegacyHaEntityEntry[] = [
    {
      entity_id: 'light.living_chandelier',
      device_id: 'dev_philips_hue_living',
      area_id: 'living_room',
      name: 'Living Room Chandelier Light',
      platform: 'zha',
    },
    {
      entity_id: 'switch.kitchen_relay_1',
      device_id: 'dev_multi_gang_relay',
      area_id: 'kitchen',
      name: 'Kitchen Island Lights',
      platform: 'zha',
    },
    {
      entity_id: 'switch.kitchen_relay_2',
      device_id: 'dev_multi_gang_relay',
      area_id: 'kitchen',
      name: 'Kitchen Exhaust Fan',
      platform: 'zha',
    },
    {
      entity_id: 'climate.hallway_thermostat',
      device_id: 'dev_nest_thermostat',
      area_id: 'hallway',
      name: 'Hallway Thermostat',
      platform: 'matter',
    },
    // Standalone entity without device_id
    {
      entity_id: 'binary_sensor.front_door_motion',
      area_id: 'hallway',
      name: 'Front Door Motion',
      platform: 'shelly',
    },
    // Internal HA entities that must be excluded from device registry
    {
      entity_id: 'automation.night_mode',
      area_id: 'living_room',
      name: 'Night Mode Automation',
    },
  ];

  const sampleStates: LegacyHaState[] = [
    {
      entity_id: 'light.living_chandelier',
      state: 'on',
      attributes: {
        friendly_name: 'Living Room Chandelier Light',
        brightness: 204, // 80%
        color_temp: 370, // 370 Mireds ~= 2703K
        hs_color: [30, 85],
      },
    },
    {
      entity_id: 'switch.kitchen_relay_1',
      state: 'on',
      attributes: { friendly_name: 'Kitchen Island Lights' },
    },
    {
      entity_id: 'switch.kitchen_relay_2',
      state: 'off',
      attributes: { friendly_name: 'Kitchen Exhaust Fan' },
    },
    {
      entity_id: 'climate.hallway_thermostat',
      state: 'heat',
      attributes: {
        friendly_name: 'Hallway Thermostat',
        current_temperature: 20.5,
        temperature: 22.0,
      },
    },
    {
      entity_id: 'binary_sensor.front_door_motion',
      state: 'on',
      attributes: {
        friendly_name: 'Front Door Motion',
        device_class: 'motion',
      },
    },
    {
      entity_id: 'automation.night_mode',
      state: 'on',
      attributes: { friendly_name: 'Night Mode Automation' },
    },
  ];

  const sampleInventory: LegacyHaInventory = {
    areas: sampleAreas,
    devices: sampleDevices,
    entities: sampleEntities,
    states: sampleStates,
  };

  it('slugifySegment normalizes strings to valid hyphen-separated segments', () => {
    expect(slugifySegment('Living Room')).toBe('living-room');
    expect(slugifySegment('Kitchen_Multi-Gang_Relay #1')).toBe('kitchen-multi-gang-relay-1');
    expect(slugifySegment('---special$$$chars---')).toBe('special-chars');
    expect(slugifySegment('', 'fallback')).toBe('fallback');
  });

  it('buildCanonicalAddress formats canonical identity addresses', () => {
    const addr = buildCanonicalAddress({
      type: 'lighting',
      area: 'living-room',
      device: 'chandelier',
      entity: 'spot-1',
    });
    expect(addr).toBe('lighting::living-room:chandelier:spot-1');
    expect(parseAddress(addr)).toEqual({
      type: 'lighting',
      area: 'living-room',
      device: 'chandelier',
      entity: 'spot-1',
    });
  });

  it('inferProtocolFromIdentifiers identifies native communication protocols', () => {
    expect(inferProtocolFromIdentifiers([], [['zigbee', '00:17:88']])).toBe(Protocol.Zigbee);
    expect(inferProtocolFromIdentifiers([], [['matter', 'node_1']])).toBe(Protocol.Matter);
    expect(inferProtocolFromIdentifiers([], [['thread', 'pant_1']])).toBe(Protocol.Thread);
    expect(inferProtocolFromIdentifiers([], [['homekit_controller', '123']])).toBe(
      Protocol.HomeKit,
    );
    expect(inferProtocolFromIdentifiers([['mac', '00:11:22:33:44:55']], [])).toBe(
      Protocol.LocalIp,
    );
    expect(inferProtocolFromIdentifiers([], [['shelly', '123']])).toBe(Protocol.LocalIp);
    expect(inferProtocolFromIdentifiers([], [['virtual', 'test']])).toBe(Protocol.Virtual);
    expect(inferProtocolFromIdentifiers([], [])).toBe(Protocol.Ha);
  });

  it('extractReadOnlyHaInventory queries only read-only endpoints without mutating source', async () => {
    const sentRequests: string[] = [];
    const mockTransport = {
      request: vi.fn(async ({ type }: { type: string }) => {
        sentRequests.push(type);
        if (type === 'get_states') return sampleStates;
        if (type === 'config/area_registry/list') return sampleAreas;
        if (type === 'config/device_registry/list') return sampleDevices;
        if (type === 'config/entity_registry/list') return sampleEntities;
        return [];
      }),
    };

    const inventory = await extractReadOnlyHaInventory(mockTransport);

    // Verify all 4 required read queries were made
    expect(sentRequests).toContain('get_states');
    expect(sentRequests).toContain('config/area_registry/list');
    expect(sentRequests).toContain('config/device_registry/list');
    expect(sentRequests).toContain('config/entity_registry/list');

    // Invariant: zero mutating calls made (e.g., call_service or entity updates)
    expect(sentRequests.some((t) => t.includes('call_service'))).toBe(false);
    expect(sentRequests.some((t) => t.includes('update'))).toBe(false);

    expect(inventory.states).toHaveLength(sampleStates.length);
    expect(inventory.devices).toHaveLength(sampleDevices.length);
    expect(inventory.areas).toHaveLength(sampleAreas.length);
    expect(inventory.entities).toHaveLength(sampleEntities.length);
  });

  it('normalizeHaInventory converts HA inventory into canonical Haus devices and endpoints', () => {
    const diff = normalizeHaInventory(sampleInventory, { instanceId: 'test-ha' });

    expect(diff.totalEntities).toBe(sampleStates.length);
    // 3 registry devices + 1 standalone binary_sensor (automation.* excluded) = 4 devices
    expect(diff.importedDevicesCount).toBe(4);
    expect(diff.importedEndpointsCount).toBe(5);
    expect(diff.unsupported).toHaveLength(0);

    // 1. Philips Hue Chandelier (Light)
    const hueItem = diff.readyToImport.find((i) => i.device.source.externalId === 'dev_philips_hue_living');
    expect(hueItem).toBeDefined();
    const hueDevice = hueItem!.device;
    expect(hueDevice.category).toBe(DeviceCategory.Lighting);
    expect(hueDevice.connectivity.protocol).toBe(Protocol.Zigbee);
    expect(hueDevice.availability).toBe('online');
    expect(hueDevice.endpoints).toHaveLength(1);

    const hueEndpoint = hueDevice.endpoints[0]!;
    expect(hueEndpoint.id).toBe('light.living_chandelier');
    expect(hueEndpoint.category).toBe(DeviceCategory.Lighting);
    // Brightness 204/255 = 80%
    expect(hueEndpoint.readings['brightness']?.value).toBe(80);
    // Mireds 370 -> Kelvin 2703
    expect(hueEndpoint.readings['color_temp']?.value).toBe(2703);
    // Canonical address validation
    expect(parseAddress(hueEndpoint.address!)).toBeDefined();

    // 2. Multi-Gang Relay (Switch)
    const relayItem = diff.readyToImport.find((i) => i.device.source.externalId === 'dev_multi_gang_relay');
    expect(relayItem).toBeDefined();
    const relayDevice = relayItem!.device;
    expect(relayDevice.category).toBe(DeviceCategory.Power);
    expect(relayDevice.endpoints).toHaveLength(2);
    expect(relayDevice.endpoints[0]?.id).toBe('switch.kitchen_relay_1');
    expect(relayDevice.endpoints[0]?.readings['on_off']?.value).toBe(true);
    expect(relayDevice.endpoints[1]?.id).toBe('switch.kitchen_relay_2');
    expect(relayDevice.endpoints[1]?.readings['on_off']?.value).toBe(false);

    // 3. Nest Thermostat (Climate)
    const nestItem = diff.readyToImport.find((i) => i.device.source.externalId === 'dev_nest_thermostat');
    expect(nestItem).toBeDefined();
    const nestDevice = nestItem!.device;
    expect(nestDevice.category).toBe(DeviceCategory.Climate);
    expect(nestDevice.connectivity.protocol).toBe(Protocol.Matter);
    expect(nestDevice.endpoints[0]?.readings['current_temperature']?.value).toBe(20.5);
    expect(nestDevice.endpoints[0]?.readings['target_temperature']?.value).toBe(22.0);

    // 4. Standalone Motion Sensor
    const motionItem = diff.readyToImport.find((i) => i.device.source.externalId === 'binary_sensor.front_door_motion');
    expect(motionItem).toBeDefined();
    const motionDevice = motionItem!.device;
    expect(motionDevice.category).toBe(DeviceCategory.OccupancySensors);
    expect(motionDevice.endpoints[0]?.readings['motion']?.value).toBe(true);
  });

  it('HaDeviceMigrator applies import to local registry and executes clean rollback without side effects on source', async () => {
    const migrator = new HaDeviceMigrator();
    const registry = new InMemoryDeviceRegistry();

    // Generate diff
    const diff = migrator.createImportDiff(sampleInventory, { instanceId: 'live-test' });
    expect(diff.importedDevicesCount).toBe(4);

    // Apply import
    const snapshot = await migrator.applyImport(diff, registry);
    expect(snapshot.createdDeviceIds).toHaveLength(4);
    expect(snapshot.createdEndpointIds).toHaveLength(5);

    // Verify devices exist in local registry
    const allDevicesAfterImport = registry.getAllDevices();
    expect(allDevicesAfterImport).toHaveLength(4);
    const livingChandelier = registry.getDevice('device_live-test_dev-philips-hue-living');
    expect(livingChandelier).toBeDefined();
    expect(livingChandelier?.name).toBe('Living Room Chandelier');

    // Execute non-destructive rollback
    await migrator.rollback(snapshot, registry);

    // Invariant: local registry is completely restored to empty state
    const allDevicesAfterRollback = registry.getAllDevices();
    expect(allDevicesAfterRollback).toHaveLength(0);
    expect(registry.getDevice('device_live-test_dev-philips-hue-living')).toBeUndefined();

    // Invariant: sample HA inventory records remain completely untouched
    expect(sampleInventory.devices).toHaveLength(3);
    expect(sampleInventory.states).toHaveLength(6);
    expect(sampleInventory.states[0]?.state).toBe('on');
  });

  it('safely records unsupported entities when entity states are missing', () => {
    const brokenInventory: LegacyHaInventory = {
      areas: [],
      devices: [
        {
          id: 'dev_broken',
          name: 'Broken Device',
        },
      ],
      entities: [
        {
          entity_id: 'light.non_existent_state',
          device_id: 'dev_broken',
        },
      ],
      states: [], // missing state
    };

    const diff = normalizeHaInventory(brokenInventory);
    expect(diff.importedDevicesCount).toBe(0);
    expect(diff.unsupported).toHaveLength(1);
    expect(diff.unsupported[0]?.entityId).toBe('light.non_existent_state');
    expect(diff.unsupported[0]?.reason).toBe('entity_state_missing');
  });
});
