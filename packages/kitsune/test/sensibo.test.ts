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

describe('Sensibo Climate & AirQ HACS Acceptance & Actuation (P18.6.2.4)', () => {
  it('groups Sensibo AirQ AC and sensors into unified Haus climate device with multiple endpoints', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const deviceId = 'hacs:sensibo:a82026db121f55635fcaa727f58264cd';
    const areaId = 'tv_place';

    // 1. Primary climate entity
    sidecar.addEntity({
      entityId: 'climate.tv_place_ac',
      domain: 'climate',
      name: 'TV Place AC',
      state: 'cool',
      attributes: {
        hvac_modes: ['cool', 'heat', 'fan_only', 'dry', 'heat_cool', 'off'],
        min_temp: 10,
        max_temp: 30,
        target_temp_step: 1,
        fan_modes: ['quiet', 'low', 'medium_low', 'medium', 'medium_high', 'high', 'auto'],
        swing_modes: ['stopped', 'rangefull'],
        swing_horizontal_modes: ['stopped', 'rangefull'],
        current_temperature: 24.5,
        temperature: 22.0,
        fan_mode: 'auto',
        swing_mode: 'stopped',
        swing_horizontal_mode: 'stopped',
      },
      deviceId,
      areaId,
    });

    // 2. AirQ CO2 sensor
    sidecar.addEntity({
      entityId: 'sensor.tv_place_ac_airq_co2',
      domain: 'sensor',
      name: 'AirQ CO2',
      state: 650,
      attributes: {
        device_class: 'carbon_dioxide',
        unit_of_measurement: 'ppm',
      },
      deviceId,
      areaId,
    });

    // 3. AirQ TVOC sensor
    sidecar.addEntity({
      entityId: 'sensor.tv_place_ac_airq_tvoc',
      domain: 'sensor',
      name: 'AirQ TVOC',
      state: 120,
      attributes: {
        unit_of_measurement: 'ppb',
        friendly_name: 'AirQ TVOC',
      },
      deviceId,
      areaId,
    });

    // 4. Filter clean required binary sensor
    sidecar.addEntity({
      entityId: 'binary_sensor.tv_place_ac_filter_clean_required',
      domain: 'binary_sensor',
      name: 'Filter clean required',
      state: 'off',
      attributes: {
        device_class: 'problem',
      },
      deviceId,
      areaId,
    });

    // 5. Reset filter button
    sidecar.addEntity({
      entityId: 'button.tv_place_ac_reset_filter',
      domain: 'button',
      name: 'Reset filter',
      state: '2026-11-10T12:00:00Z',
      attributes: {},
      deviceId,
      areaId,
    });

    // 6. Timer switch
    sidecar.addEntity({
      entityId: 'switch.tv_place_ac_timer',
      domain: 'switch',
      name: 'Timer',
      state: 'off',
      attributes: {},
      deviceId,
      areaId,
    });

    // 7. Climate react switch
    sidecar.addEntity({
      entityId: 'switch.tv_place_ac_climate_react',
      domain: 'switch',
      name: 'Climate React',
      state: 'on',
      attributes: {},
      deviceId,
      areaId,
    });

    // 8. Timer end-time sensor
    sidecar.addEntity({
      entityId: 'sensor.tv_place_ac_timer_end_time',
      domain: 'sensor',
      name: 'Timer end time',
      state: '2026-11-12T00:00:00Z',
      attributes: {
        device_class: 'timestamp',
      },
      deviceId,
      areaId,
    });

    const devices = virtualizer.getDevices();
    assert.equal(devices.length, 1, 'Expected all Sensibo entities to group under 1 device');

    const dev = devices[0]!;
    assert.equal(dev.id, deviceId);
    assert.equal(dev.category, 'climate');
    assert.equal(dev.endpoints.length, 8);

    // Verify primary climate endpoint
    const climateEp = dev.endpoints.find((ep) => ep.id === 'climate.tv_place_ac');
    assert.ok(climateEp);
    assert.equal(climateEp.readings.hvac_mode?.value, 'cool');
    assert.equal(climateEp.readings.on_off?.value, true);
    assert.equal(climateEp.readings.current_temperature?.value, 24.5);
    assert.equal(climateEp.readings.target_temperature?.value, 22.0);
    assert.equal(climateEp.readings.fan_mode?.value, 'auto');
    assert.equal(climateEp.readings.swing_mode?.value, 'stopped');
    assert.equal(climateEp.readings.swing_horizontal_mode?.value, 'stopped');

    // Verify CO2 and TVOC readings
    const co2Ep = dev.endpoints.find((ep) => ep.id === 'sensor.tv_place_ac_airq_co2');
    assert.ok(co2Ep);
    assert.equal(co2Ep.readings.co2?.value, 650);

    const tvocEp = dev.endpoints.find((ep) => ep.id === 'sensor.tv_place_ac_airq_tvoc');
    assert.ok(tvocEp);
    assert.equal(tvocEp.readings.tvoc?.value, 120);

    // Verify filter problem binary sensor
    const filterEp = dev.endpoints.find(
      (ep) => ep.id === 'binary_sensor.tv_place_ac_filter_clean_required',
    );
    assert.ok(filterEp);
    assert.equal(filterEp.readings.problem?.value, false);
  });

  it('actuates Sensibo temperature, HVAC mode, fan mode, swing modes, and power', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const deviceId = 'hacs:sensibo:a82026db121f55635fcaa727f58264cd';
    sidecar.addEntity({
      entityId: 'climate.tv_place_ac',
      domain: 'climate',
      name: 'TV Place AC',
      state: 'cool',
      attributes: {
        hvac_modes: ['cool', 'heat', 'fan_only', 'dry', 'heat_cool', 'off'],
        min_temp: 10,
        max_temp: 30,
        target_temp_step: 1,
        fan_modes: ['quiet', 'low', 'medium_low', 'medium', 'medium_high', 'high', 'auto'],
        swing_modes: ['stopped', 'rangefull'],
        swing_horizontal_modes: ['stopped', 'rangefull'],
        current_temperature: 24.0,
        temperature: 22.0,
      },
      deviceId,
    });

    // 1. Set target temperature
    await virtualizer.executeCommand(deviceId, 'climate.tv_place_ac', 'target_temperature', 23);
    assert.equal(sidecar.serviceCalls.length, 1);
    assert.deepEqual(sidecar.serviceCalls[0], {
      domain: 'climate',
      service: 'set_temperature',
      serviceData: { entity_id: 'climate.tv_place_ac', temperature: 23 },
    });

    // 2. Set HVAC mode
    await virtualizer.executeCommand(deviceId, 'climate.tv_place_ac', 'hvac_mode', 'heat');
    assert.equal(sidecar.serviceCalls.length, 2);
    assert.deepEqual(sidecar.serviceCalls[1], {
      domain: 'climate',
      service: 'set_hvac_mode',
      serviceData: { entity_id: 'climate.tv_place_ac', hvac_mode: 'heat' },
    });

    // 3. Set fan mode
    await virtualizer.executeCommand(deviceId, 'climate.tv_place_ac', 'fan_mode', 'quiet');
    assert.equal(sidecar.serviceCalls.length, 3);
    assert.deepEqual(sidecar.serviceCalls[2], {
      domain: 'climate',
      service: 'set_fan_mode',
      serviceData: { entity_id: 'climate.tv_place_ac', fan_mode: 'quiet' },
    });

    // 4. Set vertical swing mode
    await virtualizer.executeCommand(deviceId, 'climate.tv_place_ac', 'swing_mode', 'rangefull');
    assert.equal(sidecar.serviceCalls.length, 4);
    assert.deepEqual(sidecar.serviceCalls[3], {
      domain: 'climate',
      service: 'set_swing_mode',
      serviceData: { entity_id: 'climate.tv_place_ac', swing_mode: 'rangefull' },
    });

    // 5. Set horizontal swing mode
    await virtualizer.executeCommand(
      deviceId,
      'climate.tv_place_ac',
      'swing_horizontal_mode',
      'stopped',
    );
    assert.equal(sidecar.serviceCalls.length, 5);
    assert.deepEqual(sidecar.serviceCalls[4], {
      domain: 'climate',
      service: 'set_swing_horizontal_mode',
      serviceData: { entity_id: 'climate.tv_place_ac', swing_horizontal_mode: 'stopped' },
    });

    // 6. Turn off
    await virtualizer.executeCommand(deviceId, 'climate.tv_place_ac', 'on_off', false);
    assert.equal(sidecar.serviceCalls.length, 6);
    assert.deepEqual(sidecar.serviceCalls[5], {
      domain: 'climate',
      service: 'turn_off',
      serviceData: { entity_id: 'climate.tv_place_ac' },
    });

    // 7. Compound climate actuation (target temp with hvac_mode and fan_mode)
    await virtualizer.executeCommand({
      deviceId,
      endpointId: 'climate.tv_place_ac',
      capability: 'target_temperature',
      value: 21,
      parameters: {
        hvac_mode: 'cool',
        fan_mode: 'high',
        swing_mode: 'rangefull',
      },
    });
    assert.equal(sidecar.serviceCalls.length, 7);
    assert.deepEqual(sidecar.serviceCalls[6], {
      domain: 'climate',
      service: 'set_temperature',
      serviceData: {
        entity_id: 'climate.tv_place_ac',
        temperature: 21,
        hvac_mode: 'cool',
        fan_mode: 'high',
        swing_mode: 'rangefull',
      },
    });
  });

  it('actuates reset filter button and timer switch', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const deviceId = 'hacs:sensibo:a82026db121f55635fcaa727f58264cd';
    sidecar.addEntity({
      entityId: 'button.tv_place_ac_reset_filter',
      domain: 'button',
      name: 'Reset filter',
      state: '2026-11-10T12:00:00Z',
      attributes: {},
      deviceId,
    });
    sidecar.addEntity({
      entityId: 'switch.tv_place_ac_timer',
      domain: 'switch',
      name: 'Timer',
      state: 'off',
      attributes: {},
      deviceId,
    });

    // Actuate button press
    await virtualizer.executeCommand(deviceId, 'button.tv_place_ac_reset_filter', 'press', true);
    assert.equal(sidecar.serviceCalls.length, 1);
    assert.deepEqual(sidecar.serviceCalls[0], {
      domain: 'button',
      service: 'press',
      serviceData: { entity_id: 'button.tv_place_ac_reset_filter' },
    });

    // Actuate switch
    await virtualizer.executeCommand(deviceId, 'switch.tv_place_ac_timer', 'on_off', true);
    assert.equal(sidecar.serviceCalls.length, 2);
    assert.deepEqual(sidecar.serviceCalls[1], {
      domain: 'switch',
      service: 'turn_on',
      serviceData: { entity_id: 'switch.tv_place_ac_timer' },
    });
  });

  it('updates telemetry dynamically and truthfully rejects unsupported capabilities', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const deviceId = 'hacs:sensibo:a82026db121f55635fcaa727f58264cd';
    sidecar.addEntity({
      entityId: 'climate.tv_place_ac',
      domain: 'climate',
      name: 'TV Place AC',
      state: 'cool',
      attributes: {
        current_temperature: 24.0,
        temperature: 22.0,
      },
      deviceId,
    });

    let stateChanges = 0;
    virtualizer.on('deviceStateChanged', () => {
      stateChanges++;
    });

    // State update from Sensibo cloud
    sidecar.updateEntity({
      entityId: 'climate.tv_place_ac',
      state: 'heat',
      attributes: {
        current_temperature: 21.5,
        temperature: 24.0,
        fan_mode: 'medium',
      },
    });

    assert.equal(stateChanges, 1);
    const dev = virtualizer.getDevice(deviceId);
    assert.ok(dev);
    const ep = dev.endpoints[0]!;
    assert.equal(ep.readings.hvac_mode?.value, 'heat');
    assert.equal(ep.readings.current_temperature?.value, 21.5);
    assert.equal(ep.readings.target_temperature?.value, 24.0);
    assert.equal(ep.readings.fan_mode?.value, 'medium');

    // Reject unsupported capability on climate (e.g. water_heater or siren)
    await assert.rejects(
      async () => {
        await virtualizer.executeCommand(deviceId, ep.id, 'siren', true);
      },
      { message: 'kitsune_unsupported_capability:siren' },
    );

    // Reject capability not supported by this specific endpoint (e.g. cover on climate)
    await assert.rejects(
      async () => {
        await virtualizer.executeCommand(deviceId, ep.id, 'cover', 50);
      },
      { message: 'kitsune_unsupported_capability:cover' },
    );
  });
});
