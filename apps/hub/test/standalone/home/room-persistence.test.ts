/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import type { HausDevice } from '@haus/core';
import { DiscoveryTopics } from '@haus/mqtt';
import { StandaloneHomeService } from '../../../src/home/home.service.js';
import { mapTuyaDeviceToHaus } from '../../../src/commissioning/tuya/mapper.js';
import { syncMappedTuyaDevice } from '../../../src/commissioning/tuya/cameras.js';
import { syncKitsuneDevicesToHome } from '../../../src/kitsune/homebridge-runtime.js';
import { normalizeHaDevice } from '../../../src/commissioning/ha-flow/projection.js';
import { MqttDiscovery } from '../../../src/mqtt/discovery.js';
import { DiscoveryBindings } from '../../../src/mqtt/bindings.js';
import { MemoryMqttIdentities, MqttIdentities } from '../../../src/mqtt/identity.js';

const ADMIN_ACTOR = { actorId: 'test-admin', role: 'admin' as const };

describe('Device room assignment persistence across periodic re-registrations', () => {
  it('preserves user room & rename across Tuya periodic polls, Matter reconnects, Homebridge syncs, HA refreshes, and legacy rows', async () => {
    const home = new StandaloneHomeService();
    await home.roomManager.createRoom({ id: 'bedroom', name: 'Bedroom' });
    await home.roomManager.createRoom({ id: 'office', name: 'Office' });
    await home.roomManager.createRoom({ id: 'living_room', name: 'Living Room' });
    await home.roomManager.createRoom({ id: 'kitchen', name: 'Kitchen' });

    // 1. Tuya periodic poll (every 15s emits roomId: undefined, areaId: undefined, cloud name)
    const cloudDevice = {
      id: 'tuya_plug_1',
      name: 'Cloud Smart Plug',
      category: 'cz',
      product_name: 'Smart Plug',
      online: true,
      status: [{ code: 'switch_1', value: true }],
    };
    const observed = new Set<string>();
    await syncMappedTuyaDevice({
      homeService: home,
      mapped: mapTuyaDeviceToHaus(cloudDevice, 'entry-tuya-1'),
      observedEndpoints: observed,
      isStale: () => false,
    });
    await home.roomManager.updateDevice(
      'tuya:tuya_plug_1',
      { roomId: 'bedroom', name: 'Bedside Plug' },
      ADMIN_ACTOR,
    );

    const saveSpy = vi.spyOn(home.getPersistence(), 'save');
    await syncMappedTuyaDevice({
      homeService: home,
      mapped: mapTuyaDeviceToHaus(cloudDevice, 'entry-tuya-1'),
      observedEndpoints: observed,
      isStale: () => false,
    });
    const tuyaAfterPoll = home.getDevice('tuya:tuya_plug_1');
    expect(tuyaAfterPoll?.roomId).toBe('bedroom');
    expect(tuyaAfterPoll?.areaId).toBe('bedroom');
    expect(tuyaAfterPoll?.name).toBe('Bedside Plug');
    expect(saveSpy.mock.calls.filter(([kind]) => kind === 'device')).toHaveLength(0);
    saveSpy.mockRestore();

    // 2. Matter node re-discovery (passes roomId: 'unassigned')
    const matterBase: HausDevice = {
      id: 'matter_node_2_ep_1',
      source: { instanceId: 'haus-matter', externalId: 'sn-matter-1' },
      name: 'Matter Contact',
      category: 'security',
      roomId: 'unassigned',
      availability: 'online',
      connectivity: { protocol: 'matter' },
      endpoints: [
        {
          id: 'ep_matter_node_2_ep_1',
          name: 'Matter Contact',
          capabilities: [{ id: 'contact', kind: 'binary', readable: true, operations: [] }],
          readings: {},
        },
      ],
    };
    home.registerDevice(matterBase);
    await home.roomManager.updateDevice('matter_node_2_ep_1', { roomId: 'office' }, ADMIN_ACTOR);
    home.registerDevice({ ...matterBase, roomId: 'unassigned', name: 'Matter Contact' });
    expect(home.getDevice('matter_node_2_ep_1')?.roomId).toBe('office');
    expect(home.getDevice('matter_node_2_ep_1')?.areaId).toBe('office');

    // 3. Homebridge / Kitsune sync with roomId undefined, 'default', and 'unassigned'
    const hbBase: HausDevice = {
      id: 'hb:plug-1',
      source: { instanceId: 'homebridge:test-plugin', externalId: 'plug-1' },
      name: 'HB Outlet',
      category: 'power',
      availability: 'online',
      connectivity: { protocol: 'local_ip' },
      endpoints: [
        {
          id: 'hb:plug-1:ep1',
          name: 'Outlet',
          capabilities: [{ id: 'on_off', kind: 'binary', readable: true, operations: ['set'] }],
          readings: {},
        },
      ],
    };
    const syncedIds = new Set<string>();
    const pendingAliases = new Set<Promise<void>>();
    syncKitsuneDevicesToHome({
      homeService: home,
      syncedDeviceIds: syncedIds,
      pendingAliases,
      devices: [hbBase],
    });
    await home.roomManager.updateDevice('hb:plug-1', { roomId: 'living_room' }, ADMIN_ACTOR);

    for (const incomingRoom of [undefined, 'default', 'unassigned'] as const) {
      syncKitsuneDevicesToHome({
        homeService: home,
        syncedDeviceIds: syncedIds,
        pendingAliases,
        devices: [{ ...hbBase, ...(incomingRoom !== undefined ? { roomId: incomingRoom } : {}) }],
      });
      expect(home.getDevice('hb:plug-1')?.roomId).toBe('living_room');
    }

    // 4. HA integration entity normalization preserves explicit roomId and areaId
    const haDevice: HausDevice = {
      id: 'ha:entry-1:dev-1',
      source: { instanceId: 'ha:entry-1', externalId: 'dev-1' },
      name: 'HA Kettle',
      category: 'appliances',
      roomId: 'living_room',
      availability: 'online',
      connectivity: { protocol: 'local_ip' },
      endpoints: [
        {
          id: 'switch.ha_kettle',
          name: 'HA Kettle',
          capabilities: [{ id: 'on_off', kind: 'binary', readable: true, operations: ['set'] }],
          readings: {},
        },
      ],
    };
    home.registerDevice(haDevice);
    await home.roomManager.updateDevice('ha:entry-1:dev-1', { roomId: 'kitchen' }, ADMIN_ACTOR);
    const normalizedHa = normalizeHaDevice({
      device: { ...haDevice, roomId: undefined, areaId: undefined },
      existing: home.devices.getDevice('ha:entry-1:dev-1'),
      entity: {
        entryId: 'entry-1',
        integration: 'xiaomi',
        deviceId: 'dev-1',
        deviceName: 'HA Kettle',
        entityId: 'switch.ha_kettle',
        domain: 'switch',
        name: 'HA Kettle',
        state: 'on',
        areaName: 'Living Room',
        attributes: {},
      },
      deviceEntities: [],
      source: { protocol: 'vendor', externalId: 'entry-1', domain: 'xiaomi' },
      roomId: 'living_room',
    });
    expect(normalizedHa.roomId).toBe('kitchen');
    expect(normalizedHa.areaId).toBe('kitchen');

    // 5. Legacy pre-upgrade device (real roomId, no explicit roomAssignment) survives unassigned re-register
    home.registerDevice({
      id: 'legacy_dev_1',
      source: { instanceId: 'legacy', externalId: '1' },
      name: 'Legacy Lamp',
      category: 'lighting',
      roomId: 'office',
      areaId: 'office',
      availability: 'online',
      connectivity: { protocol: 'local_ip' },
      endpoints: [],
    });
    home.registerDevice({
      id: 'legacy_dev_1',
      source: { instanceId: 'legacy', externalId: '1' },
      name: 'Legacy Lamp',
      category: 'lighting',
      roomId: 'unassigned',
      availability: 'online',
      connectivity: { protocol: 'local_ip' },
      endpoints: [],
    });
    expect(home.getDevice('legacy_dev_1')?.roomId).toBe('office');

    // 6. Moving two identically named devices into the same room disambiguates instead of failing
    for (const id of ['dup_1', 'dup_2']) {
      home.registerDevice({
        id,
        source: { instanceId: 'test', externalId: id },
        name: 'Smart Plug',
        category: 'power',
        roomId: 'unassigned',
        availability: 'online',
        connectivity: { protocol: 'local_ip' },
        endpoints: [
          {
            id: `ep_${id}`,
            name: 'Smart Plug',
            capabilities: [{ id: 'on_off', kind: 'binary', readable: true, operations: ['set'] }],
            readings: {},
          },
        ],
      });
      await home.roomManager.updateDevice(id, { roomId: 'office' }, ADMIN_ACTOR);
    }
    expect(home.getDevice('dup_1')?.roomId).toBe('office');
    expect(home.getDevice('dup_2')?.roomId).toBe('office');
  });

  it('prevents MQTT retained discovery replays from snapping moved or explicitly unassigned devices back to heuristic rooms', async () => {
    const home = new StandaloneHomeService();
    await home.roomManager.createRoom({ id: 'bedroom', name: 'Bedroom' });
    await home.roomManager.createRoom({ id: 'office', name: 'Office' });

    const identities = new MqttIdentities(new MemoryMqttIdentities(), 'home-1', () =>
      home.listDevices(),
    );
    const discovery = new MqttDiscovery(
      home,
      new DiscoveryBindings(),
      new DiscoveryTopics(['homeassistant']),
      { log: () => {}, warn: () => {} },
      identities,
    );

    const discoveryMsg = {
      topic: 'homeassistant/light/bedroom_lamp/config',
      payload: JSON.stringify({
        unique_id: 'bedroom_lamp_1',
        name: 'Bedroom Bed Lamp',
        command_topic: 'zigbee2mqtt/bedroom_lamp/set',
        state_topic: 'zigbee2mqtt/bedroom_lamp/state',
        device: {
          identifiers: ['bedroom_lamp_dev'],
          name: 'Bedroom Bed Lamp',
          suggested_area: 'Bedroom',
        },
      }),
      retained: true,
    };

    // Initial discovery infers 'bedroom' from suggested_area / label
    await discovery.handle(discoveryMsg);
    const device = home.listDevices()[0];
    expect(device?.roomId).toBe('bedroom');

    // User moves device to 'office' -> MQTT replay must keep 'office'
    await home.roomManager.updateDevice(device!.id, { roomId: 'office' }, ADMIN_ACTOR);
    await discovery.handle(discoveryMsg);
    expect(home.getDevice(device!.id)?.roomId).toBe('office');

    // User explicitly unassigns device (roomId: null) -> MQTT replay must keep 'unassigned'
    await home.roomManager.updateDevice(device!.id, { roomId: null }, ADMIN_ACTOR);
    expect(home.getDevice(device!.id)?.roomId).toBe('unassigned');
    await discovery.handle(discoveryMsg);
    expect(home.getDevice(device!.id)?.roomId).toBe('unassigned');
  });
});
