/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { HausMqttClient } from '@haus/mqtt';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { MqttService } from '../../src/mqtt/service.js';

describe('Haus Native In-Process MQTT Broker & Discovery Integration', () => {
  it('discovers standard MQTT switch, synchronizes bidirectional state, and dispatches commands', async () => {
    const homeService = new StandaloneHomeService();
    const mqttService = new MqttService(homeService, {
      port: 0,
      host: '127.0.0.1',
      allowAnonymous: true,
    });

    await mqttService.onApplicationBootstrap();
    expect(mqttService.broker.listening).toBe(true);
    const port = mqttService.broker.port;

    const deviceClient = new HausMqttClient({
      host: '127.0.0.1',
      port,
      allowAnonymous: true,
    });

    await deviceClient.connect();
    expect(deviceClient.connected).toBe(true);

    const receivedCommands: string[] = [];
    await deviceClient.subscribe('kettle/power/set', (msg) => {
      receivedCommands.push(msg.payload);
    });

    const discoveryPayload = {
      unique_id: 'kitchen_kettle',
      name: 'Kitchen Smart Kettle',
      command_topic: 'kettle/power/set',
      state_topic: 'kettle/power/state',
      payload_on: 'ON',
      payload_off: 'OFF',
      device: {
        name: 'Smart Kettle',
        manufacturer: 'Tuya',
        model: 'WiFi-Kettle-V1',
        sw_version: '1.0.4',
      },
    };

    await deviceClient.publish({
      topic: 'homeassistant/switch/kettle/power/config',
      payload: JSON.stringify(discoveryPayload),
      qos: 1,
      retain: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 80));

    const device = homeService.getDevice('mqtt_kitchen_kettle');
    expect(device).toBeDefined();
    expect(device?.name).toBe('Kitchen Smart Kettle');
    expect(device?.manufacturer).toBe('Tuya');
    expect(device?.endpoints).toHaveLength(1);
    expect(device?.endpoints[0].id).toBe('ep_mqtt_kitchen_kettle');

    await deviceClient.publish({
      topic: 'kettle/power/state',
      payload: 'ON',
      qos: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    const state = homeService.getEndpointState('ep_mqtt_kitchen_kettle');
    expect(state.state).toBe('on');
    expect(state.on_off).toBe(true);

    await homeService.executeDeviceCommand('ep_mqtt_kitchen_kettle', 'power', 'turn_off');

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(receivedCommands).toContain('OFF');

    await deviceClient.close();
    await mqttService.onApplicationShutdown();
  });

  it('supports JSON-schema lights like Govee and Nixie clock', async () => {
    const homeService = new StandaloneHomeService();
    const mqttService = new MqttService(homeService, {
      port: 0,
      host: '127.0.0.1',
      allowAnonymous: true,
    });

    await mqttService.onApplicationBootstrap();
    const port = mqttService.broker.port;

    const goveeClient = new HausMqttClient({
      host: '127.0.0.1',
      port,
      allowAnonymous: true,
    });
    await goveeClient.connect();

    const commands: string[] = [];
    await goveeClient.subscribe('gv2mqtt/light/bedroom_strip/command', (msg) => {
      commands.push(msg.payload);
    });

    // Govee discovery announcement
    await goveeClient.publish({
      topic: 'homeassistant/light/gv2mqtt-bedroom_strip/config',
      payload: JSON.stringify({
        schema: 'json',
        name: 'Bedroom Strip',
        unique_id: 'gv2mqtt_bedroom_strip',
        command_topic: 'gv2mqtt/light/bedroom_strip/command',
        state_topic: 'gv2mqtt/light/bedroom_strip/state',
        brightness: true,
        color_mode: true,
        supported_color_modes: ['rgb'],
        device: {
          name: 'Bedroom Strip Light',
          manufacturer: 'Govee',
          model: 'H5083',
        },
      }),
      qos: 1,
      retain: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 80));

    const device = homeService.getDevice('mqtt_gv2mqtt_bedroom_strip');
    expect(device).toBeDefined();
    expect(device?.name).toBe('Bedroom Strip');
    expect(device?.category).toBe('lighting');
    expect(device?.endpoints[0].capabilities.map((c) => c.id)).toContain('on_off');
    expect(device?.endpoints[0].capabilities.map((c) => c.id)).toContain('brightness');

    // State update from Govee
    await goveeClient.publish({
      topic: 'gv2mqtt/light/bedroom_strip/state',
      payload: JSON.stringify({ state: 'ON', brightness: 75 }),
      qos: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    const state = homeService.getEndpointState('ep_mqtt_gv2mqtt_bedroom_strip');
    expect(state.state).toBe('on');
    expect(state.on_off).toBe(true);
    expect(state.brightness).toBe(75);

    // Command dispatch turn_off -> sends JSON {"state":"OFF"}
    await homeService.executeDeviceCommand('ep_mqtt_gv2mqtt_bedroom_strip', 'on_off', 'turn_off');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(commands.some((c) => JSON.parse(c).state === 'OFF')).toBe(true);

    // Command dispatch turn_on -> sends JSON {"state":"ON"}
    await homeService.executeDeviceCommand('ep_mqtt_gv2mqtt_bedroom_strip', 'on_off', 'turn_on');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(commands.some((c) => JSON.parse(c).state === 'ON')).toBe(true);

    await goveeClient.close();
    await mqttService.onApplicationShutdown();
  });

  it('supports bundled device discovery format like Xiaomi Kettle', async () => {
    const homeService = new StandaloneHomeService();
    const mqttService = new MqttService(homeService, {
      port: 0,
      host: '127.0.0.1',
      allowAnonymous: true,
    });

    await mqttService.onApplicationBootstrap();
    const port = mqttService.broker.port;

    const kettleClient = new HausMqttClient({
      host: '127.0.0.1',
      port,
      allowAnonymous: true,
    });
    await kettleClient.connect();

    const boilCommands: string[] = [];
    await kettleClient.subscribe('haus/kettle/873226972/set/boil', (msg) => {
      boilCommands.push(msg.payload);
    });

    // Xiaomi kettle bundled discovery announcement
    await kettleClient.publish({
      topic: 'homeassistant/device/haus_kettle_873226972/config',
      payload: JSON.stringify({
        device: {
          identifiers: ['haus_kettle_873226972'],
          name: 'Kitchen Kettle',
          manufacturer: 'Xiaomi',
          model: 'xiaomi.kettle.v21',
        },
        components: {
          current_temperature: {
            platform: 'sensor',
            unique_id: 'haus_kettle_873226972_current_temperature',
            name: 'Current temperature',
            state_topic: 'haus/kettle/873226972/state',
          },
          boil: {
            platform: 'button',
            unique_id: 'haus_kettle_873226972_boil',
            name: 'Boil',
            command_topic: 'haus/kettle/873226972/set/boil',
            payload_press: 'PRESS',
          },
        },
      }),
      qos: 1,
      retain: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 80));

    const device = homeService.getDevice('mqtt_haus_kettle_873226972');
    expect(device).toBeDefined();
    expect(device?.name).toBe('Kitchen Kettle');
    expect(device?.endpoints).toHaveLength(2);

    // State update for kettle
    await kettleClient.publish({
      topic: 'haus/kettle/873226972/state',
      payload: JSON.stringify({ current_temperature: 92 }),
      qos: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    const tempState = homeService.getEndpointState('ep_haus_kettle_873226972_current_temperature');
    expect(tempState.temperature).toBe(92);

    // Execute boil button press
    await homeService.executeDeviceCommand('ep_haus_kettle_873226972_boil', 'press', 'press');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(boilCommands).toContain('PRESS');

    await kettleClient.close();
    await mqttService.onApplicationShutdown();
  });
});
