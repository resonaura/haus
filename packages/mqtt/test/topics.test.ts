/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import {
  DiscoveryTopics,
  parseDiscoveryPayload,
  mergeDiscoverySnapshot,
  MqttDiscoveryRegistry,
  hausDiscoveryNodeId,
  isHausDiscoveryTopic,
} from '../src/index.js';

it('parses both exact discovery shapes and literal multi-level namespaces', () => {
  const topics = new DiscoveryTopics(['house/mqtt', 'homeassistant']);
  expect(topics.parse('house/mqtt/light/node-1/lamp_2/config')).toEqual({
    prefix: 'house/mqtt',
    component: 'light',
    nodeId: 'node-1',
    objectId: 'lamp_2',
  });
  expect(topics.parse('homeassistant/device/panel/config')?.component).toBe('device');
  for (const invalid of [
    'house/mqttish/light/a/config',
    'haus/light/a/config',
    'house/mqtt/state/config',
    'house/mqtt/light/a/extra/part/config',
    'house/mqtt/light//config',
    'house/mqtt/light/a/config/extra',
    'house/mqtt/light/a.b/config',
    'house/mqtt/light/+/config',
  ])
    expect(topics.parse(invalid)).toBeUndefined();
});

it('rejects invalid, duplicate or overlapping prefixes without starting a broker', () => {
  for (const prefixes of [
    [],
    [''],
    ['house/'],
    ['/house'],
    ['house/#'],
    ['house/+'],
    ['house\0'],
    ['house', 'house'],
    ['house', 'house/mqtt'],
  ])
    expect(() => new DiscoveryTopics(prefixes)).toThrow(
      /mqtt_discovery_prefix_(?:invalid|conflict)/,
    );
});

it('identifies only this home’s stable Haus discovery node', () => {
  const topics = new DiscoveryTopics();
  const nodeId = hausDiscoveryNodeId('home one');
  expect(nodeId).toMatch(/^haus_[a-f0-9]{24}$/);
  expect(hausDiscoveryNodeId('home one')).toBe(nodeId);
  expect(hausDiscoveryNodeId('home two')).not.toBe(nodeId);
  expect(
    isHausDiscoveryTopic(topics.parse(`homeassistant/switch/${nodeId}/lamp/config`), nodeId),
  ).toBe(true);
  expect(isHausDiscoveryTopic(topics.parse('homeassistant/switch/other/lamp/config'), nodeId)).toBe(
    false,
  );
  expect(isHausDiscoveryTopic(topics.parse('homeassistant/switch/lamp/config'), nodeId)).toBe(
    false,
  );
  expect(() => hausDiscoveryNodeId('  ')).toThrow('mqtt_home_id_invalid');
});

it('validates platforms identically for live ingestion and the cumulative restart projection', () => {
  const before = JSON.stringify({ unique_id: 'relay', state_topic: 'fixture/good' });
  const mismatch = JSON.stringify({
    unique_id: 'relay',
    platform: 'light',
    state_topic: 'fixture/wrong',
  });
  expect(() => parseDiscoveryPayload('switch', mismatch)).toThrow('mqtt_discovery_invalid');
  expect(mergeDiscoverySnapshot('switch', before, mismatch)).toBeUndefined();
  expect(() => parseDiscoveryPayload('vacuum', '{}')).toThrow(
    'mqtt_discovery_unsupported_platform',
  );
  expect(() => parseDiscoveryPayload('switch', '{"components":{}}')).toThrow(
    'mqtt_discovery_invalid',
  );
  expect(() => parseDiscoveryPayload('device', '{"unique_id":"relay"}')).toThrow(
    'mqtt_discovery_invalid',
  );
  expect(() =>
    parseDiscoveryPayload('device', '{"components":{"relay":{"p":"vacuum","unique_id":"relay"}}}'),
  ).toThrow('mqtt_discovery_unsupported_platform');
});

it('keeps the standalone discovery registry consistent with the shared topic/payload parser', () => {
  const registry = new MqttDiscoveryRegistry(['house/discovery']);
  const topic = 'house/discovery/switch/node/relay/config';
  expect(
    registry.handleDiscoveryMessage(topic, '{"uniq_id":"relay","stat_t":"fixture/state"}')?.config
      .unique_id,
  ).toBe('relay');
  expect(registry.handleDiscoveryMessage(`${topic}/extra`, '{}')).toBeUndefined();
  expect(
    registry.handleDiscoveryMessage('unselected/switch/node/relay/config', '{}'),
  ).toBeUndefined();
  registry.handleDiscoveryMessage(topic, ' ');
  expect(registry.list()).toHaveLength(1);
  registry.handleDiscoveryMessage(topic, '');
  expect(registry.list()).toHaveLength(0);
});
