/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, expect, it, vi } from 'vitest';
import type { MqttMessage } from '@haus/mqtt';
import { mqttFixture } from './fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

it('imports MQTT Event discovery and dispatches only allowed non-retained events', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  await fixture.publish('homeassistant/event/remote/config', {
    uniq_id: 'remote-events',
    name: 'Remote events',
    stat_t: 'remote/events',
    evt_typ: ['single_press', 'double_press'],
    val_tpl: '{{ value_json.event }}',
    dev: { ids: ['remote-1'], name: 'Remote' },
  });

  await vi.waitFor(() => expect(fixture.home.listDevices()[0]?.endpoints).toHaveLength(1));
  const device = fixture.home.listDevices()[0];
  const endpoint = device?.endpoints[0];
  if (!endpoint) throw Error('missing_mqtt_event_endpoint');
  expect(endpoint.capabilities).toContainEqual(
    expect.objectContaining({ id: 'event', kind: 'event', choices: ['single_press', 'double_press'] }),
  );

  const dispatch = vi.spyOn(fixture.home, 'dispatchAutomationEvent');
  await fixture.client.publish({
    topic: 'remote/events',
    payload: JSON.stringify({ event: { event_type: 'single_press', button: 1 } }),
    qos: 1,
  });
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
  expect(dispatch).toHaveBeenLastCalledWith({
    type: 'event',
    endpointId: endpoint.id,
    eventType: 'single_press',
    data: { button: 1 },
  });
  expect(fixture.home.getEndpointState(endpoint.id)).toMatchObject({
    state: 'single_press',
    event_type: 'single_press',
    event: {
      eventType: 'single_press',
      sequence: 1,
      metadata: { button: 1 },
    },
  });

  const duplicateMessage = {
    topic: 'remote/events',
    payload: JSON.stringify({ event: { event_type: 'single_press', button: 1 } }),
    qos: 1,
    duplicate: true,
  } satisfies MqttMessage;
  fixture.service.broker.emit('message', duplicateMessage);
  await fixture.service.drain();
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(fixture.home.getEndpointState(endpoint.id)).toMatchObject({ event: { sequence: 1 } });

  await fixture.client.publish({
    topic: 'remote/events',
    payload: JSON.stringify({ event: { event_type: 'single_press', button: 1 } }),
    qos: 1,
  });
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
  expect(fixture.home.getEndpointState(endpoint.id)).toMatchObject({ event: { sequence: 2 } });

  await fixture.client.publish({
    topic: 'remote/events',
    payload: JSON.stringify({ event: { event_type: 'long_press', button: 1 } }),
    qos: 1,
  });
  await fixture.client.publish({
    topic: 'remote/events',
    payload: JSON.stringify({ event: { event_type: 'double_press', button: 1 } }),
    qos: 1,
    retain: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(dispatch).toHaveBeenCalledTimes(2);
  expect(fixture.home.getEndpointState(endpoint.id).event_type).toBe('single_press');
  expect(fixture.home.getEndpointState(endpoint.id)).toMatchObject({ event: { sequence: 2 } });
});

it('rejects invalid event discovery profiles', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  await fixture.publish('homeassistant/event/invalid/config', {
    uniq_id: 'invalid-events',
    stat_t: 'invalid/events',
    event_types: ['press', 'press'],
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(fixture.home.listDevices()).toHaveLength(0);
});

it('ignores malformed payloads and unsupported event templates', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  await fixture.publish('homeassistant/event/plain/config', {
    uniq_id: 'plain-events',
    name: 'Plain events',
    stat_t: 'remote/plain',
    event_types: ['press'],
    dev: { ids: ['remote-plain'], name: 'Plain remote' },
  });
  await fixture.publish('homeassistant/event/templated/config', {
    uniq_id: 'templated-events',
    name: 'Templated events',
    stat_t: 'remote/templated',
    event_types: ['press'],
    val_tpl: '{{ value_json | tojson }}',
    dev: { ids: ['remote-templated'], name: 'Templated remote' },
  });
  await vi.waitFor(() => expect(fixture.home.listDevices()).toHaveLength(2));
  const dispatch = vi.spyOn(fixture.home, 'dispatchAutomationEvent');

  await fixture.client.publish({ topic: 'remote/plain', payload: '{broken', qos: 1 });
  await fixture.client.publish({
    topic: 'remote/templated',
    payload: JSON.stringify({ event_type: 'press' }),
    qos: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(dispatch).not.toHaveBeenCalled();
});
