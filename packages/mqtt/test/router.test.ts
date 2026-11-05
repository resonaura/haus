/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import { topicMatches, MqttTopicRouter, MqttDiscoveryRegistry } from '../src/router.js';

describe('@haus/mqtt — Topic Matching and Discovery', () => {
  it('matches MQTT topics with standard wildcards', () => {
    expect(topicMatches('home/+/temperature', 'home/livingroom/temperature')).toBe(true);
    expect(topicMatches('home/+/temperature', 'home/kitchen/temperature')).toBe(true);
    expect(topicMatches('home/+/temperature', 'home/livingroom/humidity')).toBe(false);
    expect(topicMatches('home/#', 'home/livingroom/temperature/celsius')).toBe(true);
    expect(topicMatches('#', 'any/topic/path')).toBe(true);
    expect(topicMatches('exact/match', 'exact/match')).toBe(true);
    expect(topicMatches('exact/match', 'other/match')).toBe(false);
  });

  it('routes MQTT messages through MqttTopicRouter with unsubscribe support', async () => {
    const router = new MqttTopicRouter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const unsub1 = router.subscribe('device/+/state', handler1);
    router.subscribe('device/#', handler2);

    const count = await router.dispatch({ topic: 'device/lamp/state', payload: 'ON' });
    expect(count).toBe(2);
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);

    // Unsubscribe handler1
    unsub1();
    const count2 = await router.dispatch({ topic: 'device/lamp/state', payload: 'OFF' });
    expect(count2).toBe(1);
    expect(handler1).toHaveBeenCalledTimes(1); // Not called again
    expect(handler2).toHaveBeenCalledTimes(2);
  });

  it('parses generic MQTT discovery messages from user-installed apps', () => {
    const registry = new MqttDiscoveryRegistry();

    // Discovery published by a user-installed app (e.g. Zigbee2MQTT, Aqara, Tuya, Govee)
    const discoveryPayload = JSON.stringify({
      name: 'Ceiling Light',
      unique_id: 'light_ceiling_01',
      state_topic: 'light/ceiling/state',
      command_topic: 'light/ceiling/set',
      device: {
        identifiers: ['zb_light_01'],
        name: 'Smart Bulb',
        manufacturer: 'Philips',
      },
    });

    const discovered = registry.handleDiscoveryMessage(
      'homeassistant/light/living_room/ceiling/config',
      discoveryPayload,
    );

    expect(discovered).toBeDefined();
    expect(discovered?.kind).toBe('light');
    expect(discovered?.nodeId).toBe('living_room');
    expect(discovered?.objectId).toBe('ceiling');
    expect(discovered?.config.name).toBe('Ceiling Light');

    expect(registry.list()).toHaveLength(1);

    // Empty payload removes discovered entity
    registry.handleDiscoveryMessage('homeassistant/light/living_room/ceiling/config', '');
    expect(registry.list()).toHaveLength(0);
  });
});
