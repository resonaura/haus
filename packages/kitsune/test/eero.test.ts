/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'vitest';
import { HacsVirtualizer } from '../src/hacs/virtualizer.js';
import type { PythonSidecarHarness } from '../src/hacs/sidecar.js';
import type { HacsEntityPayload, HacsEntityUpdatePayload } from '../src/hacs/types.js';

class MockSidecar extends EventEmitter {
  readonly serviceCalls: Array<{
    domain: string;
    service: string;
    serviceData: Record<string, unknown>;
  }> = [];
  isStarted = false;
  async start(): Promise<void> {
    this.isStarted = true;
  }
  async stop(): Promise<void> {
    this.isStarted = false;
  }
  async setupEntry(): Promise<void> {}
  async callService(call: {
    domain: string;
    service: string;
    serviceData: Record<string, unknown>;
  }): Promise<void> {
    this.serviceCalls.push(call);
  }
  addEntity(payload: HacsEntityPayload): void {
    this.emit('entity_added', payload);
  }
  updateEntity(payload: HacsEntityUpdatePayload): void {
    this.emit('entity_updated', payload);
  }
}

function add(
  sidecar: MockSidecar,
  entityId: string,
  domain: string,
  name: string,
  state: string | number | boolean,
  attributes: Record<string, unknown> = {},
  deviceId?: string,
  areaId?: string,
) {
  sidecar.addEntity({ entityId, domain, name, state, attributes, deviceId, areaId });
}

describe('Eero Network Topology, Profiles & Diagnostics Acceptance (P18.6.2.6)', () => {
  it('projects Crawford network router with telemetry, switches, buttons, and select', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const devId = 'hacs:eero:1c73b77e842e00953717402e00d84939';
    add(
      sidecar,
      'button.crawford_reboot',
      'button',
      'Reboot',
      'unknown',
      { device_class: 'restart' },
      devId,
      'system',
    );
    add(
      sidecar,
      'button.crawford_run_speed_test',
      'button',
      'Speed Test',
      'unknown',
      {},
      devId,
      'system',
    );
    add(
      sidecar,
      'select.crawford_preferred_update_time',
      'select',
      'Update Time',
      'night',
      {
        options: ['morning', 'afternoon', 'night'],
      },
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.crawford_download_speed',
      'sensor',
      'Download',
      850.5,
      {
        device_class: 'data_rate',
        unit_of_measurement: 'Mbit/s',
      },
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.crawford_upload_speed',
      'sensor',
      'Upload',
      120.2,
      {
        device_class: 'data_rate',
        unit_of_measurement: 'Mbit/s',
      },
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.crawford_connected_clients',
      'sensor',
      'Clients',
      42,
      { unit_of_measurement: 'clients' },
      devId,
      'system',
    );
    add(
      sidecar,
      'sensor.crawford_gateway_ip',
      'sensor',
      'Gateway IP',
      '192.168.4.1',
      { mac_address: '00:11:22:33:44:55' },
      devId,
      'system',
    );
    add(
      sidecar,
      'switch.crawford_guest_network',
      'switch',
      'Guest',
      'off',
      { guest_network_name: 'Guest' },
      devId,
      'system',
    );
    add(sidecar, 'switch.crawford_ad_blocking', 'switch', 'AdBlock', 'on', {}, devId, 'system');

    const device = virtualizer.getDevice(devId);
    assert.ok(device, 'Crawford network device should be registered');
    assert.equal(device.category, 'network', 'Device category should be network');
    assert.equal(device.endpoints.length, 9, 'Should have 9 endpoints for Crawford');

    const rebootEp = device.endpoints.find((ep) => ep.id === 'button.crawford_reboot');
    assert.ok(rebootEp);
    assert.equal(rebootEp.capabilities[0].id, 'button');

    const selectEp = device.endpoints.find(
      (ep) => ep.id === 'select.crawford_preferred_update_time',
    );
    assert.ok(selectEp);
    assert.equal(selectEp.capabilities[0].id, 'select');
    assert.deepEqual(selectEp.capabilities[0].choices, ['morning', 'afternoon', 'night']);
    assert.equal(selectEp.readings.select?.value, 'night');

    const downEp = device.endpoints.find((ep) => ep.id === 'sensor.crawford_download_speed');
    assert.ok(downEp);
    assert.equal(downEp.readings.value?.value, 850.5);

    const guestSwitchEp = device.endpoints.find((ep) => ep.id === 'switch.crawford_guest_network');
    assert.ok(guestSwitchEp);
    assert.equal(guestSwitchEp.readings.on_off?.value, false);

    const adSwitchEp = device.endpoints.find((ep) => ep.id === 'switch.crawford_ad_blocking');
    assert.ok(adSwitchEp);
    assert.equal(adSwitchEp.readings.on_off?.value, true);

    await virtualizer.stop();
  });

  it('projects user profile with presence tracking, connectivity, and pause switches', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const profileDeviceId = 'hacs:eero:41cece587f931f73a3c792ca568cd9e9';
    add(
      sidecar,
      'device_tracker.andrii',
      'device_tracker',
      'Andrii',
      'home',
      { source_type: 'router' },
      profileDeviceId,
      'system',
    );
    add(sidecar, 'switch.andrii_paused', 'switch', 'Paused', 'off', {}, profileDeviceId, 'system');
    add(
      sidecar,
      'switch.andrii_adult_content_filter',
      'switch',
      'Adult Filter',
      'on',
      {},
      profileDeviceId,
      'system',
    );
    add(
      sidecar,
      'binary_sensor.andrii_connected',
      'binary_sensor',
      'Connected',
      'on',
      { device_class: 'connectivity' },
      profileDeviceId,
      'system',
    );
    add(
      sidecar,
      'sensor.andrii_connected_clients',
      'sensor',
      'Clients',
      4,
      { unit_of_measurement: 'clients' },
      profileDeviceId,
      'system',
    );

    const device = virtualizer.getDevice(profileDeviceId);
    assert.ok(device);
    assert.equal(device.category, 'network', 'Profile device category should resolve to network');
    assert.equal(device.endpoints.length, 5);

    const trackerEp = device.endpoints.find((ep) => ep.id === 'device_tracker.andrii');
    assert.ok(trackerEp);
    assert.equal(trackerEp.readings.presence?.value, 'home');
    assert.equal(trackerEp.readings.contact?.value, true);

    const pauseEp = device.endpoints.find((ep) => ep.id === 'switch.andrii_paused');
    assert.ok(pauseEp);
    assert.equal(pauseEp.readings.on_off?.value, false);

    const connEp = device.endpoints.find((ep) => ep.id === 'binary_sensor.andrii_connected');
    assert.ok(connEp);
    assert.equal(connEp.readings.motion?.value, true);

    await virtualizer.stop();
  });

  it('projects mesh nodes with firmware updates, status lights, and reboot buttons', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const nodeDeviceId = 'hacs:eero:7de07f7c33570473912ca683010dead9';
    add(
      sidecar,
      'update.tv_place_eero_firmware',
      'update',
      'Firmware',
      'off',
      {
        installed_version: 'v6.16.0-1234',
        latest_version: 'v6.16.0-1234',
        title: 'eeroOS',
        auto_update: true,
        in_progress: false,
      },
      nodeDeviceId,
      'tv_place',
    );
    add(
      sidecar,
      'button.tv_place_tv_place_reboot',
      'button',
      'Reboot',
      'unknown',
      { device_class: 'restart' },
      nodeDeviceId,
      'tv_place',
    );
    add(
      sidecar,
      'light.tv_place_status_lights',
      'light',
      'LED',
      'on',
      { brightness: 128 },
      nodeDeviceId,
      'tv_place',
    );
    add(
      sidecar,
      'sensor.tv_place_tv_place_connected_clients',
      'sensor',
      'Clients',
      16,
      { unit_of_measurement: 'clients' },
      nodeDeviceId,
      'tv_place',
    );

    const device = virtualizer.getDevice(nodeDeviceId);
    assert.ok(device);
    assert.equal(device.category, 'network', 'Mesh node device category should be network');
    assert.equal(device.endpoints.length, 4);

    const updateEp = device.endpoints.find((ep) => ep.id === 'update.tv_place_eero_firmware');
    assert.ok(updateEp);
    assert.equal(updateEp.capabilities[0].id, 'update');
    assert.equal(updateEp.readings.update?.value, false);
    assert.equal(updateEp.readings.installed_version?.value, 'v6.16.0-1234');
    assert.equal(updateEp.readings.title?.value, 'eeroOS');

    const lightEp = device.endpoints.find((ep) => ep.id === 'light.tv_place_status_lights');
    assert.ok(lightEp);
    assert.equal(lightEp.readings.on_off?.value, true);
    assert.equal(lightEp.readings.brightness?.value, 50);

    await virtualizer.stop();
  });

  it('actuates bidirectional commands for switches, buttons, select, and update', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const devId = 'hacs:eero:crawford_router';
    add(sidecar, 'switch.crawford_guest_network', 'switch', 'Guest', 'off', {}, devId);
    add(sidecar, 'button.crawford_reboot', 'button', 'Reboot', 'unknown', {}, devId);
    add(
      sidecar,
      'select.crawford_preferred_update_time',
      'select',
      'Update Time',
      'night',
      { options: ['morning', 'afternoon', 'night'] },
      devId,
    );
    add(
      sidecar,
      'update.crawford_firmware',
      'update',
      'Firmware',
      'on',
      { installed_version: 'v1.0', latest_version: 'v1.1' },
      devId,
    );

    // 1. Switch turn on
    await virtualizer.executeCommand(devId, 'switch.crawford_guest_network', 'on_off', true);
    assert.equal(sidecar.serviceCalls.length, 1);
    assert.deepEqual(sidecar.serviceCalls[0], {
      domain: 'switch',
      service: 'turn_on',
      serviceData: { entity_id: 'switch.crawford_guest_network' },
    });

    // 2. Switch turn off
    await virtualizer.executeCommand(devId, 'switch.crawford_guest_network', 'on_off', false);
    assert.equal(sidecar.serviceCalls.length, 2);
    assert.deepEqual(sidecar.serviceCalls[1], {
      domain: 'switch',
      service: 'turn_off',
      serviceData: { entity_id: 'switch.crawford_guest_network' },
    });

    // 3. Button press
    await virtualizer.executeCommand(devId, 'button.crawford_reboot', 'press', null);
    assert.equal(sidecar.serviceCalls.length, 3);
    assert.deepEqual(sidecar.serviceCalls[2], {
      domain: 'button',
      service: 'press',
      serviceData: { entity_id: 'button.crawford_reboot' },
    });

    // 4. Select option
    await virtualizer.executeCommand(
      devId,
      'select.crawford_preferred_update_time',
      'select_option',
      'morning',
    );
    assert.equal(sidecar.serviceCalls.length, 4);
    assert.deepEqual(sidecar.serviceCalls[3], {
      domain: 'select',
      service: 'select_option',
      serviceData: { entity_id: 'select.crawford_preferred_update_time', option: 'morning' },
    });

    // 5. Update install
    await virtualizer.executeCommand(devId, 'update.crawford_firmware', 'install', null);
    assert.equal(sidecar.serviceCalls.length, 5);
    assert.deepEqual(sidecar.serviceCalls[4], {
      domain: 'update',
      service: 'install',
      serviceData: { entity_id: 'update.crawford_firmware' },
    });

    // 6. Unsupported capability rejection
    await assert.rejects(async () => {
      await virtualizer.executeCommand(devId, 'switch.crawford_guest_network', 'siren', true);
    }, /kitsune_unsupported_capability:siren/);

    const unsupp = virtualizer.getUnsupportedCapabilities();
    assert.ok(unsupp.some((u) => u.capability === 'siren'));

    await virtualizer.stop();
  });

  it('updates readings reactively and propagates availability', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const devId = 'hacs:eero:narnia_mesh';
    add(
      sidecar,
      'sensor.narnia_download_speed',
      'sensor',
      'Speed',
      500.0,
      { device_class: 'data_rate', unit_of_measurement: 'Mbit/s' },
      devId,
    );
    add(
      sidecar,
      'update.narnia_firmware',
      'update',
      'Firmware',
      'off',
      { installed_version: 'v6.16.0', latest_version: 'v6.16.0' },
      devId,
    );

    let dev = virtualizer.getDevice(devId);
    assert.ok(dev);
    assert.equal(dev.availability, 'online');
    assert.equal(dev.endpoints[0].readings.value?.value, 500.0);
    assert.equal(dev.endpoints[1].readings.update?.value, false);

    // Update speed reading
    sidecar.updateEntity({ entityId: 'sensor.narnia_download_speed', state: 920.5 });

    // Update firmware available
    sidecar.updateEntity({
      entityId: 'update.narnia_firmware',
      state: 'on',
      attributes: { installed_version: 'v6.16.0', latest_version: 'v6.17.0' },
    });

    dev = virtualizer.getDevice(devId);
    assert.ok(dev);
    assert.equal(dev.endpoints[0].readings.value?.value, 920.5);
    assert.equal(dev.endpoints[1].readings.update?.value, true);
    assert.equal(dev.endpoints[1].readings.latest_version?.value, 'v6.17.0');

    // Make unavailable
    sidecar.updateEntity({ entityId: 'update.narnia_firmware', state: 'unavailable' });

    dev = virtualizer.getDevice(devId);
    assert.ok(dev);
    assert.equal(dev.availability, 'offline');

    await virtualizer.stop();
  });
});
