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

describe('Xiaomi MIoT & BLE Sensors Acceptance (P18.6.2.7)', () => {
  it('projects Xiaomi MIoT smart plug with power outlet, LED, temp sensor, and info button', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const plugDeviceId = 'hacs:xiaomi_miot:narnia_pedalboard';
    add(
      sidecar,
      'switch.narnia_pedalboard_power',
      'switch',
      'Power',
      'on',
      { device_class: 'outlet' },
      plugDeviceId,
      'narnia',
    );
    add(
      sidecar,
      'light.narnia_pedalboard_indicator_light',
      'light',
      'Indicator LED',
      'on',
      {},
      plugDeviceId,
      'narnia',
    );
    add(
      sidecar,
      'sensor.narnia_pedalboard_temperature',
      'sensor',
      'Temperature',
      34.5,
      {
        device_class: 'temperature',
        unit_of_measurement: '°C',
      },
      plugDeviceId,
      'narnia',
    );
    add(
      sidecar,
      'button.narnia_pedalboard_info',
      'button',
      'Info',
      'unknown',
      { device_class: 'update' },
      plugDeviceId,
      'narnia',
    );

    const device = virtualizer.getDevice(plugDeviceId);
    assert.ok(device, 'Plug device should be registered');
    assert.equal(device.category, 'power', 'Device category should resolve to power');
    assert.equal(device.endpoints.length, 4, 'Should have 4 endpoints');

    // Endpoints inspection
    const switchEp = device.endpoints.find((ep) => ep.id === 'switch.narnia_pedalboard_power');
    assert.ok(switchEp);
    assert.equal(switchEp.readings.on_off?.value, true);

    const lightEp = device.endpoints.find(
      (ep) => ep.id === 'light.narnia_pedalboard_indicator_light',
    );
    assert.ok(lightEp);
    assert.equal(lightEp.readings.on_off?.value, true);

    const tempEp = device.endpoints.find((ep) => ep.id === 'sensor.narnia_pedalboard_temperature');
    assert.ok(tempEp);
    assert.equal(tempEp.readings.temperature?.value, 34.5);

    const buttonEp = device.endpoints.find((ep) => ep.id === 'button.narnia_pedalboard_info');
    assert.ok(buttonEp);
    assert.equal(buttonEp.capabilities[0].id, 'button');

    await virtualizer.stop();
  });

  it('actuates plug power, indicator light, and info button commands', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const plugDeviceId = 'hacs:xiaomi_miot:narnia_pedalboard';
    add(
      sidecar,
      'switch.narnia_pedalboard_power',
      'switch',
      'Power',
      'on',
      { device_class: 'outlet' },
      plugDeviceId,
    );
    add(
      sidecar,
      'light.narnia_pedalboard_indicator_light',
      'light',
      'Indicator LED',
      'on',
      {},
      plugDeviceId,
    );
    add(sidecar, 'button.narnia_pedalboard_info', 'button', 'Info', 'unknown', {}, plugDeviceId);

    // 1. Actuate outlet power off
    await virtualizer.executeCommand(
      plugDeviceId,
      'switch.narnia_pedalboard_power',
      'on_off',
      false,
    );
    assert.equal(sidecar.serviceCalls.length, 1);
    assert.deepEqual(sidecar.serviceCalls[0], {
      domain: 'switch',
      service: 'turn_off',
      serviceData: { entity_id: 'switch.narnia_pedalboard_power' },
    });

    // 2. Actuate indicator light toggle
    await virtualizer.executeCommand(
      plugDeviceId,
      'light.narnia_pedalboard_indicator_light',
      'on_off',
      false,
    );
    assert.equal(sidecar.serviceCalls.length, 2);
    assert.deepEqual(sidecar.serviceCalls[1], {
      domain: 'light',
      service: 'turn_off',
      serviceData: { entity_id: 'light.narnia_pedalboard_indicator_light' },
    });

    // 3. Actuate info button press
    await virtualizer.executeCommand(plugDeviceId, 'button.narnia_pedalboard_info', 'press', null);
    assert.equal(sidecar.serviceCalls.length, 3);
    assert.deepEqual(sidecar.serviceCalls[2], {
      domain: 'button',
      service: 'press',
      serviceData: { entity_id: 'button.narnia_pedalboard_info' },
    });

    // 4. Reject unsupported vacuum command
    await assert.rejects(async () => {
      await virtualizer.executeCommand(
        plugDeviceId,
        'switch.narnia_pedalboard_power',
        'vacuum',
        true,
      );
    }, /kitsune_unsupported_capability:vacuum/);

    await virtualizer.stop();
  });

  it('projects Xiaomi BLE Bathroom Scale with weight, impedance, and signal strength', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const scaleDeviceId = 'hacs:xiaomi_ble:bathroom_scale';
    add(
      sidecar,
      'sensor.bathroom_scale_weight',
      'sensor',
      'Weight',
      74.2,
      {
        device_class: 'weight',
        unit_of_measurement: 'kg',
      },
      scaleDeviceId,
      'bathroom',
    );
    add(
      sidecar,
      'sensor.bathroom_scale_weight_non_stabilized',
      'sensor',
      'Non-stabilized Weight',
      74.5,
      {
        device_class: 'weight',
        unit_of_measurement: 'kg',
      },
      scaleDeviceId,
      'bathroom',
    );
    add(
      sidecar,
      'sensor.bathroom_scale_impedance',
      'sensor',
      'Impedance',
      485,
      {
        unit_of_measurement: 'Ω',
      },
      scaleDeviceId,
      'bathroom',
    );
    add(
      sidecar,
      'sensor.bathroom_scale_signal_strength',
      'sensor',
      'RSSI',
      -65,
      {
        device_class: 'signal_strength',
        unit_of_measurement: 'dBm',
      },
      scaleDeviceId,
      'bathroom',
    );

    const device = virtualizer.getDevice(scaleDeviceId);
    assert.ok(device);
    assert.equal(device.endpoints.length, 4);

    const weightEp = device.endpoints.find((ep) => ep.id === 'sensor.bathroom_scale_weight');
    assert.ok(weightEp);
    assert.equal(weightEp.readings.weight?.value, 74.2);
    assert.equal(weightEp.readings.value?.value, 74.2);

    const impedanceEp = device.endpoints.find((ep) => ep.id === 'sensor.bathroom_scale_impedance');
    assert.ok(impedanceEp);
    assert.equal(impedanceEp.readings.impedance?.value, 485);

    const rssiEp = device.endpoints.find((ep) => ep.id === 'sensor.bathroom_scale_signal_strength');
    assert.ok(rssiEp);
    assert.equal(rssiEp.readings.signal_strength?.value, -65);

    // Update weight reading dynamically
    sidecar.updateEntity({
      entityId: 'sensor.bathroom_scale_weight',
      state: 73.8,
      attributes: { device_class: 'weight', unit_of_measurement: 'kg' },
    });

    const updated = virtualizer.getDevice(scaleDeviceId);
    assert.ok(updated);
    const updatedWeightEp = updated.endpoints.find(
      (ep) => ep.id === 'sensor.bathroom_scale_weight',
    );
    assert.equal(updatedWeightEp?.readings.weight?.value, 73.8);

    await virtualizer.stop();
  });

  it('projects Xiaomi BLE wireless dimmer switch events and RSSI telemetry', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const switchDeviceId = 'hacs:xiaomi_ble:living_room_dimmer_switch';
    const eventChoices = ['press', 'double_press', 'hold', 'rotate_left', 'rotate_right'];
    add(
      sidecar,
      'event.living_room_dimmer_switch_dimmer',
      'event',
      'Dimmer Action',
      'press',
      {
        event_types: eventChoices,
        event_type: 'rotate_right',
      },
      switchDeviceId,
      'living_room',
    );
    add(
      sidecar,
      'sensor.living_room_dimmer_switch_signal_strength',
      'sensor',
      'RSSI',
      -58,
      {
        device_class: 'signal_strength',
        unit_of_measurement: 'dBm',
      },
      switchDeviceId,
      'living_room',
    );

    const device = virtualizer.getDevice(switchDeviceId);
    assert.ok(device);
    assert.equal(device.endpoints.length, 2);

    const eventEp = device.endpoints.find(
      (ep) => ep.id === 'event.living_room_dimmer_switch_dimmer',
    );
    assert.ok(eventEp);
    assert.equal(eventEp.capabilities[0].id, 'event');
    assert.deepEqual(eventEp.capabilities[0].choices, eventChoices);
    assert.equal(eventEp.readings.event?.value, 'press');
    assert.equal(eventEp.readings.event_type?.value, 'rotate_right');

    // Update event on rotary knob turn
    sidecar.updateEntity({
      entityId: 'event.living_room_dimmer_switch_dimmer',
      state: 'rotate_left',
      attributes: { event_type: 'rotate_left' },
    });

    const updated = virtualizer.getDevice(switchDeviceId);
    assert.ok(updated);
    const updatedEp = updated.endpoints.find(
      (ep) => ep.id === 'event.living_room_dimmer_switch_dimmer',
    );
    assert.equal(updatedEp?.readings.event?.value, 'rotate_left');
    assert.equal(updatedEp?.readings.event_type?.value, 'rotate_left');

    await virtualizer.stop();
  });
});
