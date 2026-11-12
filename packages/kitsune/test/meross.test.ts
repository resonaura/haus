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

describe('Meross LAN HACS Acceptance & Actuation (P18.6.2.2)', () => {
  it('groups multi-socket surge protector (mss425f) into single Haus device with multiple endpoints', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const deviceId = 'hacs:meross_lan:mss425f_bedroom_desk';
    const areaId = 'bedroom';

    // 1. Master power switch
    sidecar.addEntity({
      entityId: 'switch.bedroom_desk_surge_protector_power',
      domain: 'switch',
      name: 'Bedroom Desk Surge Protector Power',
      state: 'on',
      attributes: {},
      deviceId,
      areaId,
    });

    // 2. Desk socket
    sidecar.addEntity({
      entityId: 'switch.bedroom_desk_surge_protector_desk',
      domain: 'switch',
      name: 'Bedroom Desk Surge Protector Desk',
      state: 'on',
      attributes: {},
      deviceId,
      areaId,
    });

    // 3. USB port
    sidecar.addEntity({
      entityId: 'switch.bedroom_desk_surge_protector_usb',
      domain: 'switch',
      name: 'Bedroom Desk Surge Protector USB',
      state: 'off',
      attributes: {},
      deviceId,
      areaId,
    });

    // 4. Socket 2
    sidecar.addEntity({
      entityId: 'switch.bedroom_desk_surge_protector_socket_2',
      domain: 'switch',
      name: 'Bedroom Desk Surge Protector Socket 2',
      state: 'on',
      attributes: {},
      deviceId,
      areaId,
    });

    // 5. Socket 4
    sidecar.addEntity({
      entityId: 'switch.bedroom_desk_surge_protector_socket_4',
      domain: 'switch',
      name: 'Bedroom Desk Surge Protector Socket 4',
      state: 'off',
      attributes: {},
      deviceId,
      areaId,
    });

    // 6. Wall Garland socket
    sidecar.addEntity({
      entityId: 'switch.bedroom_desk_surge_protector_wall_garland',
      domain: 'switch',
      name: 'Bedroom Desk Surge Protector Wall Garland',
      state: 'on',
      attributes: {},
      deviceId,
      areaId,
    });

    const devices = virtualizer.getDevices();
    assert.equal(devices.length, 1, 'Expected all sockets to group under 1 physical device');

    const dev = devices[0]!;
    assert.equal(dev.id, deviceId);
    assert.equal(dev.category, 'power');
    assert.equal(dev.connectivity.protocol, 'virtual');
    assert.equal(dev.sourceRefs?.[0]?.protocol, 'virtual');
    assert.equal(dev.endpoints.length, 6, 'Expected 6 distinct socket endpoints');

    // Verify endpoint readings
    const usbEp = dev.endpoints.find((ep) => ep.id === 'switch.bedroom_desk_surge_protector_usb');
    assert.ok(usbEp);
    assert.equal(usbEp.readings.on_off?.value, false);

    const deskEp = dev.endpoints.find((ep) => ep.id === 'switch.bedroom_desk_surge_protector_desk');
    assert.ok(deskEp);
    assert.equal(deskEp.readings.on_off?.value, true);

    // Verify individual socket actuation
    await virtualizer.executeCommand(dev.id, usbEp.id, 'on_off', true);
    assert.equal(sidecar.serviceCalls.length, 1);
    assert.deepEqual(sidecar.serviceCalls[0], {
      domain: 'switch',
      service: 'turn_on',
      serviceData: { entity_id: 'switch.bedroom_desk_surge_protector_usb' },
    });

    await virtualizer.executeCommand(dev.id, deskEp.id, 'on_off', false);
    assert.equal(sidecar.serviceCalls.length, 2);
    assert.deepEqual(sidecar.serviceCalls[1], {
      domain: 'switch',
      service: 'turn_off',
      serviceData: { entity_id: 'switch.bedroom_desk_surge_protector_desk' },
    });
  });

  it('translates Narnia RGB light strip (msl320cpr) with brightness, color temperature, and color HSV', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const deviceId = 'hacs:meross_lan:msl320cpr_narnia_rgb';

    sidecar.addEntity({
      entityId: 'light.narnia_rgb',
      domain: 'light',
      name: 'Narnia RGB',
      state: 'on',
      attributes: {
        brightness: 204, // 80%
        color_temp_kelvin: 3500,
        hs_color: [240, 75],
      },
      deviceId,
      areaId: 'narnia',
    });

    const dev = virtualizer.getDevice(deviceId);
    assert.ok(dev);
    assert.equal(dev.category, 'lighting');
    assert.equal(dev.endpoints.length, 1);

    const ep = dev.endpoints[0]!;
    assert.equal(ep.readings.on_off?.value, true);
    assert.equal(ep.readings.brightness?.value, 80);
    assert.equal(ep.readings.color_temp?.value, 3500);
    assert.deepEqual(ep.readings.color_hsv?.value, { hue: 240, saturation: 75, value: 80 });

    // Actuate brightness
    await virtualizer.executeCommand(dev.id, ep.id, 'brightness', 50);
    assert.equal(sidecar.serviceCalls.length, 1);
    assert.deepEqual(sidecar.serviceCalls[0], {
      domain: 'light',
      service: 'turn_on',
      serviceData: { entity_id: 'light.narnia_rgb', brightness: 128 },
    });

    // Actuate color temperature in Kelvin
    await virtualizer.executeCommand(dev.id, ep.id, 'color_temp', 4000);
    assert.equal(sidecar.serviceCalls.length, 2);
    assert.deepEqual(sidecar.serviceCalls[1], {
      domain: 'light',
      service: 'turn_on',
      serviceData: { entity_id: 'light.narnia_rgb', kelvin: 4000 },
    });

    // Actuate color HSV
    await virtualizer.executeCommand(dev.id, ep.id, 'color_hsv', { hue: 120, saturation: 90 });
    assert.equal(sidecar.serviceCalls.length, 3);
    assert.deepEqual(sidecar.serviceCalls[2], {
      domain: 'light',
      service: 'turn_on',
      serviceData: { entity_id: 'light.narnia_rgb', hs_color: [120, 90] },
    });

    // Compound actuation (turn_on with brightness and color_temp)
    await virtualizer.executeCommand({
      deviceId: dev.id,
      endpointId: ep.id,
      capability: 'on_off',
      value: true,
      parameters: { brightness: 90, color_temp: 2700 },
    });
    assert.equal(sidecar.serviceCalls.length, 4);
    assert.deepEqual(sidecar.serviceCalls[3], {
      domain: 'light',
      service: 'turn_on',
      serviceData: {
        entity_id: 'light.narnia_rgb',
        brightness: 230,
        kelvin: 2700,
      },
    });
  });

  it('updates state dynamically and propagates availability', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const deviceId = 'hacs:meross_lan:mss620_outdoor_hub';

    sidecar.addEntity({
      entityId: 'switch.outdoor_main_power_hub_flood_light',
      domain: 'switch',
      name: 'Outdoor Flood Light',
      state: 'off',
      attributes: {},
      deviceId,
      areaId: 'outdoor',
    });

    let stateChangedCount = 0;
    virtualizer.on('deviceStateChanged', () => {
      stateChangedCount++;
    });

    let availabilityChanged: string | undefined;
    virtualizer.on('deviceAvailabilityChanged', (_devId, avail) => {
      availabilityChanged = avail;
    });

    // Receive state update from device
    sidecar.updateEntity({
      entityId: 'switch.outdoor_main_power_hub_flood_light',
      state: 'on',
      attributes: {},
    });

    const dev = virtualizer.getDevice(deviceId);
    assert.ok(dev);
    assert.equal(dev.endpoints[0]?.readings.on_off?.value, true);
    assert.equal(stateChangedCount, 1);

    // Device goes offline / unavailable
    sidecar.updateEntity({
      entityId: 'switch.outdoor_main_power_hub_flood_light',
      state: 'unavailable',
      attributes: {},
    });

    const updatedDev = virtualizer.getDevice(deviceId);
    assert.equal(updatedDev?.availability, 'offline');
    assert.equal(availabilityChanged, 'offline');
  });

  it('truthfully rejects unsupported capabilities with diagnostics', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const deviceId = 'hacs:meross_lan:mss425f_test';
    sidecar.addEntity({
      entityId: 'switch.test_switch',
      domain: 'switch',
      name: 'Test Switch',
      state: 'on',
      attributes: {},
      deviceId,
    });

    await assert.rejects(
      async () => {
        await virtualizer.executeCommand(deviceId, 'switch.test_switch', 'siren', true);
      },
      { message: 'kitsune_unsupported_capability:siren' },
    );

    const unsupported = virtualizer.getUnsupportedCapabilities();
    assert.equal(unsupported.length, 1);
    assert.equal(unsupported[0]?.capability, 'siren');
    assert.equal(unsupported[0]?.reason, 'unsupported_ha_capability_command');
  });
});
