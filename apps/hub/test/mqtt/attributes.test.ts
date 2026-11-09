/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mqttFixture } from './fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

function config(attributesTopic: string, template?: string) {
  return {
    unique_id: 'attributes_sensor',
    state_topic: 'fixture/attributes/state',
    json_attributes_topic: attributesTopic,
    ...(template ? { json_attributes_template: template } : {}),
    device: { identifiers: ['attributes-device'], name: 'Attributes device' },
  };
}

const endpointId = 'ep_mqtt_attributes_sensor';

it('combines matching state and JSON attributes and preserves valid attributes on bad payloads', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  await fixture.publish('homeassistant/sensor/attributes/config', config('fixture/attributes/extra'));
  await fixture.publish('fixture/attributes/state', '21.5');
  await fixture.publish('fixture/attributes/extra', '{"rssi":-48,"link":"good"}');
  await fixture.service.drain();

  expect(fixture.home.getEndpointState(endpointId)).toMatchObject({
    value: 21.5,
    attributes: { rssi: -48, link: 'good' },
  });

  await fixture.publish('fixture/attributes/extra', '[]');
  await fixture.service.drain();
  expect(fixture.home.getEndpointState(endpointId).attributes).toEqual({ rssi: -48, link: 'good' });
});

it('routes same-topic state and attributes once and drops replaced attribute topics', async () => {
  const fixture = await mqttFixture();
  cleanups.push(() => fixture.close());
  const stateAndAttributes = {
    ...config('fixture/combined'),
    state_topic: 'fixture/combined',
    value_template: '{{ value_json.state }}',
  };
  await fixture.publish('homeassistant/sensor/combined/config', stateAndAttributes);
  await fixture.publish('fixture/combined', '{"state":"ready","metadata":{"zone":2}}');
  await fixture.service.drain();
  expect(fixture.home.getEndpointState(endpointId)).toMatchObject({
    value: 'ready',
    attributes: { state: 'ready', metadata: { zone: 2 } },
  });

  await fixture.publish('homeassistant/sensor/combined/config', config('fixture/new-attributes'));
  await fixture.publish('fixture/combined', '{"rssi":-20}');
  await fixture.service.drain();
  expect(fixture.home.getEndpointState(endpointId).attributes).toEqual({
    state: 'ready',
    metadata: { zone: 2 },
  });

  await fixture.publish('fixture/new-attributes', '{"rssi":-55}');
  await fixture.service.drain();
  expect(fixture.home.getEndpointState(endpointId).attributes).toEqual({ rssi: -55 });

  const { json_attributes_topic, ...withoutAttributes } = config('fixture/new-attributes');
  expect(json_attributes_topic).toBe('fixture/new-attributes');
  await fixture.publish('homeassistant/sensor/combined/config', withoutAttributes);
  await fixture.publish('fixture/new-attributes', '{"rssi":-10}');
  await fixture.service.drain();
  expect(fixture.home.getEndpointState(endpointId).attributes).toEqual({ rssi: -55 });
});

it('restores retained attributes after discovery bindings on a cold restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-mqtt-attributes-'));
  const database = join(directory, 'catalog.sqlite');
  cleanups.push(async () => rm(directory, { recursive: true, force: true }));
  const first = await mqttFixture(database);
  cleanups.push(() => first.close());
  await first.publish('homeassistant/sensor/retained-attributes/config', config('fixture/retained-attributes'));
  await first.publish('fixture/retained-attributes', '{"firmware":"1.2.3"}');
  await first.service.drain();
  await first.close();

  const second = await mqttFixture(database);
  cleanups.push(() => second.close());
  expect(second.home.getEndpointState(endpointId).attributes).toEqual({ firmware: '1.2.3' });
});
