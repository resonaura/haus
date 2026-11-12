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

describe('Philips Hue Bridge, Lights & Scenes Acceptance & Actuation (P18.6.2.5)', () => {
  it('projects Hue lights, scenes, events, and battery sensors into Haus unified devices', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const lightDeviceId = 'hacs:hue:guinea_pigs_lamp_device';
    const sceneDeviceId = 'hacs:hue:bedroom_scenes_device';
    const switchDeviceId = 'hacs:hue:living_room_multi_switch_device';

    // 1. Guinea Pigs Lamp (Color & Ambiance bulb with dynamic effects)
    sidecar.addEntity({
      entityId: 'light.guinea_pigs_lamp',
      domain: 'light',
      name: 'Guinea Pigs Lamp',
      state: 'on',
      attributes: {
        min_color_temp_kelvin: 2000,
        max_color_temp_kelvin: 6535,
        supported_color_modes: ['color_temp', 'xy'],
        effect_list: [
          'off',
          'candle',
          'fire',
          'prism',
          'sparkle',
          'opal',
          'glisten',
          'underwater',
          'cosmos',
          'sunbeam',
          'enchant',
          'sunrise',
          'sunset',
        ],
        effect: 'candle',
        brightness: 204, // 80%
        color_temp_kelvin: 3000,
        hs_color: [30, 85],
      },
      deviceId: lightDeviceId,
      areaId: 'living_room',
    });

    // 2. Bedroom Hue Scene (Concentrate)
    sidecar.addEntity({
      entityId: 'scene.bedroom_hue_concentrate',
      domain: 'scene',
      name: 'Concentrate',
      state: 'available',
      attributes: {
        group_name: 'Bedroom',
        group_type: 'room',
        speed: 0.5,
        brightness: 254,
        is_dynamic: false,
        friendly_name: 'Bedroom Concentrate',
      },
      deviceId: sceneDeviceId,
      areaId: 'bedroom',
    });

    // 3. Living Room Multi Switch (Hue tap dial switch button 2)
    sidecar.addEntity({
      entityId: 'event.living_room_multi_switch_button_2',
      domain: 'event',
      name: 'Button 2',
      state: '2026-11-03T02:02:12.658Z',
      attributes: {
        event_types: ['initial_press', 'repeat', 'short_release', 'long_press', 'long_release'],
        event_type: 'initial_press',
        device_class: 'button',
      },
      deviceId: switchDeviceId,
      areaId: 'living_room',
    });

    // 4. Living Room Multi Switch Battery sensor
    sidecar.addEntity({
      entityId: 'sensor.living_room_multi_switch_battery',
      domain: 'sensor',
      name: 'Battery',
      state: 95,
      attributes: {
        device_class: 'battery',
        unit_of_measurement: '%',
      },
      deviceId: switchDeviceId,
      areaId: 'living_room',
    });

    const devices = virtualizer.getDevices();
    assert.equal(devices.length, 3, 'Expected 3 distinct physical devices');

    // Verify Guinea Pigs Lamp
    const lampDev = virtualizer.getDevice(lightDeviceId);
    assert.ok(lampDev);
    assert.equal(lampDev.category, 'lighting');
    assert.equal(lampDev.endpoints.length, 1);
    const lampEp = lampDev.endpoints[0]!;
    assert.equal(lampEp.readings.on_off?.value, true);
    assert.equal(lampEp.readings.brightness?.value, 80);
    assert.equal(lampEp.readings.color_temp?.value, 3000);
    assert.equal(lampEp.readings.effect?.value, 'candle');
    assert.deepEqual(lampEp.readings.color_hsv?.value, { hue: 30, saturation: 85, value: 80 });

    // Verify Scene device
    const sceneDev = virtualizer.getDevice(sceneDeviceId);
    assert.ok(sceneDev);
    const sceneEp = sceneDev.endpoints[0]!;
    assert.equal(sceneEp.id, 'scene.bedroom_hue_concentrate');
    assert.equal(sceneEp.readings.group_name?.value, 'Bedroom');
    assert.equal(sceneEp.readings.brightness?.value, 254);

    // Verify Multi Switch device (groups event + battery into same device)
    const switchDev = virtualizer.getDevice(switchDeviceId);
    assert.ok(switchDev);
    assert.equal(switchDev.endpoints.length, 2);
    const eventEp = switchDev.endpoints.find(
      (ep) => ep.id === 'event.living_room_multi_switch_button_2',
    );
    assert.ok(eventEp);
    assert.equal(eventEp.readings.event_type?.value, 'initial_press');
  });

  it('actuates Hue light brightness, color temperature, HSV, and dynamic effects', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const deviceId = 'hacs:hue:bedroom_desk_monitor_strip';
    sidecar.addEntity({
      entityId: 'light.bedroom_desk_monitor_strip',
      domain: 'light',
      name: 'Bedroom Desk Monitor Strip',
      state: 'on',
      attributes: {
        effect_list: ['off', 'candle', 'fire', 'prism'],
      },
      deviceId,
    });

    // 1. Set brightness
    await virtualizer.executeCommand(
      deviceId,
      'light.bedroom_desk_monitor_strip',
      'brightness',
      75,
    );
    assert.equal(sidecar.serviceCalls.length, 1);
    assert.deepEqual(sidecar.serviceCalls[0], {
      domain: 'light',
      service: 'turn_on',
      serviceData: { entity_id: 'light.bedroom_desk_monitor_strip', brightness: 191 },
    });

    // 2. Set color temperature in Kelvin
    await virtualizer.executeCommand(
      deviceId,
      'light.bedroom_desk_monitor_strip',
      'color_temp',
      4500,
    );
    assert.equal(sidecar.serviceCalls.length, 2);
    assert.deepEqual(sidecar.serviceCalls[1], {
      domain: 'light',
      service: 'turn_on',
      serviceData: { entity_id: 'light.bedroom_desk_monitor_strip', kelvin: 4500 },
    });

    // 3. Set color HSV
    await virtualizer.executeCommand(deviceId, 'light.bedroom_desk_monitor_strip', 'color_hsv', {
      hue: 200,
      saturation: 80,
    });
    assert.equal(sidecar.serviceCalls.length, 3);
    assert.deepEqual(sidecar.serviceCalls[2], {
      domain: 'light',
      service: 'turn_on',
      serviceData: { entity_id: 'light.bedroom_desk_monitor_strip', hs_color: [200, 80] },
    });

    // 4. Set dynamic effect (e.g. 'fire')
    await virtualizer.executeCommand(
      deviceId,
      'light.bedroom_desk_monitor_strip',
      'effect',
      'fire',
    );
    assert.equal(sidecar.serviceCalls.length, 4);
    assert.deepEqual(sidecar.serviceCalls[3], {
      domain: 'light',
      service: 'turn_on',
      serviceData: { entity_id: 'light.bedroom_desk_monitor_strip', effect: 'fire' },
    });

    // 5. Compound actuation (turn_on with brightness, color_temp, and effect simultaneously)
    await virtualizer.executeCommand({
      deviceId,
      endpointId: 'light.bedroom_desk_monitor_strip',
      capability: 'on_off',
      value: true,
      parameters: {
        brightness: 90,
        color_temp_kelvin: 2700,
        effect: 'candle',
      },
    });
    assert.equal(sidecar.serviceCalls.length, 5);
    assert.deepEqual(sidecar.serviceCalls[4], {
      domain: 'light',
      service: 'turn_on',
      serviceData: {
        entity_id: 'light.bedroom_desk_monitor_strip',
        brightness: 230,
        kelvin: 2700,
        effect: 'candle',
      },
    });

    // 6. Turn off
    await virtualizer.executeCommand(deviceId, 'light.bedroom_desk_monitor_strip', 'on_off', false);
    assert.equal(sidecar.serviceCalls.length, 6);
    assert.deepEqual(sidecar.serviceCalls[5], {
      domain: 'light',
      service: 'turn_off',
      serviceData: { entity_id: 'light.bedroom_desk_monitor_strip' },
    });
  });

  it('actuates Hue scenes and truthful capability rejections', async () => {
    const sidecar = new MockSidecar();
    const virtualizer = new HacsVirtualizer(sidecar as unknown as PythonSidecarHarness);
    await virtualizer.start();

    const deviceId = 'hacs:hue:bedroom_scenes';
    sidecar.addEntity({
      entityId: 'scene.bedroom_hue_energize',
      domain: 'scene',
      name: 'Energize',
      state: 'available',
      attributes: {
        group_name: 'Bedroom',
      },
      deviceId,
    });

    // Actuate scene
    await virtualizer.executeCommand(deviceId, 'scene.bedroom_hue_energize', 'scene', 'turn_on');
    assert.equal(sidecar.serviceCalls.length, 1);
    assert.deepEqual(sidecar.serviceCalls[0], {
      domain: 'scene',
      service: 'turn_on',
      serviceData: { entity_id: 'scene.bedroom_hue_energize' },
    });

    // Truthfully reject unsupported capabilities on scene
    await assert.rejects(
      async () => {
        await virtualizer.executeCommand(deviceId, 'scene.bedroom_hue_energize', 'climate', 'cool');
      },
      { message: 'kitsune_unsupported_capability:climate' },
    );
  });
});
