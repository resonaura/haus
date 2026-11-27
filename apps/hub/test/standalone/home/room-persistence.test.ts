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
import { normalizeHaDevice, pruneSupersededHaDevices } from '../../../src/commissioning/ha-flow/projection.js';
import { isMqttGoveeOutletSuppressionActive } from '../../../src/mqtt/govee-hybrid.js';
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
        uniqueId: 'ha_kettle_1',
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

  it('keeps Homebridge devices and their room/name assignments intact across add-on restarts', async () => {
    const home = new StandaloneHomeService();
    await home.roomManager.createRoom({ id: 'bedroom', name: 'Bedroom' });

    const hbOutlet: HausDevice = {
      id: 'homebridge:homebridge-govee:BC3A31F1-446D-5F58-B972-6DF99153B8D9',
      source: {
        instanceId: 'homebridge:homebridge-govee',
        externalId: 'BC3A31F1-446D-5F58-B972-6DF99153B8D9',
      },
      name: 'H5080',
      model: 'H5080',
      manufacturer: 'Govee',
      category: 'power',
      availability: 'online',
      connectivity: { protocol: 'local_ip' },
      endpoints: [
        {
          id: 'outlet',
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
      devices: [hbOutlet],
    });
    await home.roomManager.updateDevice(
      hbOutlet.id,
      { roomId: 'bedroom', name: 'Bedroom Xbox Power' },
      ADMIN_ACTOR,
    );

    // Bridge stops during add-on restart -> devices temporarily empty
    syncKitsuneDevicesToHome({
      homeService: home,
      syncedDeviceIds: syncedIds,
      pendingAliases,
      devices: [],
    });
    const whileStopped = home.getDevice(hbOutlet.id);
    expect(whileStopped).toBeDefined();
    expect(whileStopped?.availability).toBe('offline');
    expect(whileStopped?.roomId).toBe('bedroom');
    expect(whileStopped?.name).toBe('Bedroom Xbox Power');

    // Bridge comes back up -> custom room and name remain intact
    syncKitsuneDevicesToHome({
      homeService: home,
      syncedDeviceIds: syncedIds,
      pendingAliases,
      devices: [{ ...hbOutlet, roomId: 'default', name: 'H5080' }],
    });
    const afterRestart = home.getDevice(hbOutlet.id);
    expect(afterRestart?.availability).toBe('online');
    expect(afterRestart?.roomId).toBe('bedroom');
    expect(afterRestart?.name).toBe('Bedroom Xbox Power');
  });

  it('prunes duplicate HA devices even when endpoint index pointed to stale duplicate, preserving user assignments', async () => {
    const home = new StandaloneHomeService();
    await home.roomManager.createRoom({ id: 'guinea_pigs', name: 'Guinea Pigs' });

    const activeId = 'ha:entry-yeelight:new-hash';
    const staleId = 'ha:entry-yeelight:old-hash';

    // Active device registered first with default raw name and unassigned room
    home.registerDevice({
      id: activeId,
      source: { instanceId: 'ha:entry-yeelight', externalId: 'new-hash' },
      name: 'Yeelight Ct Bulb 0x7f002ac',
      category: 'lighting',
      roomId: 'unassigned',
      availability: 'online',
      connectivity: { protocol: 'local_ip' },
      endpoints: [
        {
          id: 'light.yeelight_ct_bulb_0x7f002ac',
          name: 'Light',
          capabilities: [{ id: 'on_off', kind: 'binary', readable: true, operations: ['set'] }],
          readings: {},
        },
      ],
    });

    // Stale duplicate registered later (e.g. from cluster sync), hijacking byEndpointId, carrying user customization
    home.registerDevice({
      id: staleId,
      source: { instanceId: 'ha:entry-yeelight', externalId: 'old-hash' },
      name: 'Yeelight Ct Bulb 0x7f002ac',
      category: 'lighting',
      roomId: 'unassigned',
      availability: 'offline',
      connectivity: { protocol: 'local_ip' },
      endpoints: [
        {
          id: 'light.yeelight_ct_bulb_0x7f002ac',
          name: 'Light',
          capabilities: [{ id: 'on_off', kind: 'binary', readable: true, operations: ['set'] }],
          readings: {},
        },
      ],
    });
    await home.roomManager.updateDevice(
      staleId,
      { roomId: 'guinea_pigs', name: 'Guinea Pigs Stairs Lamp' },
      ADMIN_ACTOR,
    );
    expect(home.devices.getDeviceByEndpointId('light.yeelight_ct_bulb_0x7f002ac')?.id).toBe(
      staleId,
    );

    const pruned = pruneSupersededHaDevices(
      home,
      new Set(['entry-yeelight']),
      new Set([activeId]),
      new Set(),
    );
    expect(pruned).toBe(1);
    expect(home.getDevice(staleId)).toBeUndefined();
    const survivor = home.getDevice(activeId);
    expect(survivor?.roomId).toBe('guinea_pigs');
    expect(survivor?.name).toBe('Guinea Pigs Stairs Lamp');
    expect(home.devices.getDeviceByEndpointId('light.yeelight_ct_bulb_0x7f002ac')?.id).toBe(
      activeId,
    );
  });

  it('does not suppress govee2mqtt outlets when homebridge-govee app is stopped', () => {
    const home = new StandaloneHomeService();
    // Stale offline homebridge-govee device row still present in DB
    home.registerDevice({
      id: 'homebridge:homebridge-govee:93C23C05',
      source: { instanceId: 'homebridge:homebridge-govee', externalId: '93C23C05' },
      name: 'Narnia Garland',
      model: 'H5083',
      manufacturer: 'Govee',
      category: 'power',
      availability: 'offline',
      connectivity: { protocol: 'local_ip' },
      endpoints: [],
    });
    expect(isMqttGoveeOutletSuppressionActive(home)).toBe(false);
  });
});
