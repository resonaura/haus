/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityMqtt } from '@haus/ha/node/activity-mqtt';
test('native Activity ownership withdraws discovery once and survives HA reconnect without duplicate publishing', async () => {
  const requests = [];
  let owned = true;
  const mqtt = new ActivityMqtt({
    nativeOwned: () => owned,
    ha: {
      connected: true,
      request: async (value) => {
        requests.push(value);
        return value.type === 'get_services' ? { mqtt: { publish: {} } } : {};
      },
    },
    activity: { status: () => ({ available: true, active: false }) },
    registry: () => ({ cameras: [{ id: 'camera.one', name: 'One' }] }),
  });
  await mqtt.tick();
  await mqtt.tick();
  assert.equal(requests.filter((r) => r.type === 'call_service').length, 1);
  assert.equal(requests.at(-1).service_data.payload, '');
  assert.equal(requests.at(-1).service_data.retain, true);
  mqtt.reset();
  await mqtt.tick();
  assert.equal(
    requests.filter((r) => r.type === 'call_service').every((r) => r.service_data.payload === ''),
    true,
  );
  owned = false;
  await mqtt.tick();
  assert.ok(
    requests.some((r) => r.type === 'call_service' && r.service_data.payload.includes('unique_id')),
  );
  await mqtt.stop();
});

test('one retained discovery per camera; expiring, unretained state and exact source identity', async () => {
  let now = 100000,
    active = false;
  const requests = [],
    camera = { id: 'camera.front', name: 'Front', areaId: 'entry' };
  const mqtt = new ActivityMqtt({
    now: () => now,
    ha: {
      connected: true,
      request: async (value) => {
        requests.push(value);
        return value.type === 'get_services' ? { mqtt: { publish: {} } } : {};
      },
    },
    activity: {
      status: () => ({
        available: true,
        active,
        source: 'assisted',
        sources: ['binary_sensor.front_motion'],
      }),
    },
    registry: () => ({
      cameras: [camera],
      areas: [{ area_id: 'entry', name: 'Entry' }],
    }),
  });
  await mqtt.tick();
  const published = requests
    .filter((r) => r.type === 'call_service')
    .map((r) => ({
      ...r.service_data,
      payload: JSON.parse(r.service_data.payload),
    }));
  assert.equal(published.length, 2);
  assert.equal(published[0].retain, true);
  assert.equal(published[0].payload.device.suggested_area, 'Entry');
  assert.ok(published[0].payload.device.identifiers.includes('haus_camera:camera.front'));
  assert.equal(published[0].payload.expire_after, 45);
  assert.equal(published[1].retain, false);
  assert.equal(published[1].payload.attributes.haus_camera, camera.id);
  await mqtt.tick();
  assert.equal(requests.length, 3);
  now += 16000;
  await mqtt.tick();
  assert.equal(requests.length, 4);
  active = true;
  await mqtt.tick();
  assert.equal(JSON.parse(requests.at(-1).service_data.payload).state, 'ON');
  mqtt.reset();
  await mqtt.tick();
  assert.equal(requests.filter((r) => r.service_data?.retain).length, 2);
});
test('missing MQTT does not claim HA exposure or write raw entities', async () => {
  const requests = [];
  const mqtt = new ActivityMqtt({
    ha: {
      connected: true,
      request: async (r) => {
        requests.push(r);
        return {};
      },
    },
    activity: {},
    registry: () => ({ cameras: [{ id: 'camera.front' }] }),
  });
  await mqtt.tick();
  assert.equal(mqtt.supported, false);
  assert.deepEqual(requests, [{ type: 'get_services' }]);
});

test('shutdown orders offline after an in-flight online observation and never restarts publishing', async () => {
  const published = [];
  let release;
  const mqtt = new ActivityMqtt({
    ha: {
      connected: true,
      request: async (r) => {
        if (r.type === 'get_services') return { mqtt: { publish: {} } };
        const payload = JSON.parse(r.service_data.payload);
        published.push(payload);
        if (payload.availability === 'online')
          await new Promise((resolve) => {
            release = resolve;
          });
        return {};
      },
    },
    activity: { status: () => ({ available: true, active: true }) },
    registry: () => ({ cameras: [{ id: 'camera.front', name: 'Front' }] }),
  });
  const tick = mqtt.tick();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const stop = mqtt.stop();
  await mqtt.tick();
  assert.equal(published.filter((p) => p.availability === 'offline').length, 0);
  release();
  await Promise.all([stop, tick]);
  assert.equal(published.at(-1).availability, 'offline');
  const count = published.length;
  mqtt.reset();
  await mqtt.tick();
  assert.equal(published.length, count);
});

test('an unresponsive MQTT publisher cannot delay recorder shutdown', async () => {
  const mqtt = new ActivityMqtt({
    shutdownTimeoutMs: 20,
    ha: { connected: true, request: () => new Promise(() => {}) },
    activity: {},
    registry: () => ({ cameras: [{ id: 'camera.front' }] }),
  });
  void mqtt.tick();
  await mqtt.stop();
  assert.equal(mqtt.stopped, true);
});
