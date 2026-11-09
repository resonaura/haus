/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { inspectScryptedDevice, type DeviceRecord } from '../dist/index.js';

test('Scrypted discovery leaves unreported readings and availability unknown', () => {
  const record: DeviceRecord = {
    id: 'sparse-device',
    name: 'Sparse device',
    interfaces: [
      'VideoCamera',
      'MotionSensor',
      'BinarySensor',
      'Intercom',
      'OnOff',
      'Brightness',
      'Lock',
      'Entry',
      'Thermometer',
    ],
    state: {},
  };

  const { device } = inspectScryptedDevice(record, 'scrypted-test');

  assert.equal(device.availability, 'unknown');
  assert.equal(device.endpoints.length, 8);
  for (const endpoint of device.endpoints) {
    assert.equal(endpoint.availability, 'unknown');
    assert.deepEqual(endpoint.readings, {});
  }
});

test('Scrypted projection preserves explicit false and zero values', () => {
  const record: DeviceRecord = {
    id: 'observed-device',
    name: 'Observed device',
    interfaces: [
      'VideoCamera',
      'MotionSensor',
      'ContactSensor',
      'Intercom',
      'OnOff',
      'Brightness',
      'Lock',
      'Entry',
      'Thermometer',
    ],
    state: {
      online: false,
      motionDetected: false,
      contact: false,
      intercomActive: false,
      on: false,
      brightness: 0,
      locked: false,
      entryOpen: false,
      temperature: 0,
    },
  };

  const { device } = inspectScryptedDevice(record, 'scrypted-test');

  assert.equal(device.availability, 'offline');
  assert.equal(
    device.endpoints.find((endpoint) => endpoint.id === 'camera')?.readings.camera_status?.value,
    'offline',
  );
  assert.equal(
    device.endpoints.find((endpoint) => endpoint.id === 'motion')?.readings.motion?.value,
    false,
  );
  assert.equal(
    device.endpoints.find((endpoint) => endpoint.id === 'contact')?.readings.contact?.value,
    false,
  );
  assert.equal(
    device.endpoints.find((endpoint) => endpoint.id === 'intercom')?.readings.intercom_active
      ?.value,
    false,
  );
  const power = device.endpoints.find((endpoint) => endpoint.id === 'power');
  assert.equal(power?.readings.on_off?.value, false);
  assert.equal(power?.readings.brightness?.value, 0);
  assert.equal(
    device.endpoints.find((endpoint) => endpoint.id === 'lock')?.readings.lock?.value,
    'unlocked',
  );
  assert.equal(
    device.endpoints.find((endpoint) => endpoint.id === 'cover')?.readings.cover?.value,
    0,
  );
  assert.equal(
    device.endpoints.find((endpoint) => endpoint.id === 'temperature')?.readings.temperature?.value,
    0,
  );
});

test('Scrypted projection omits non-finite measurements', () => {
  const record: DeviceRecord = {
    id: 'invalid-measurement',
    name: 'Invalid measurement',
    interfaces: ['Brightness', 'Thermometer'],
    state: { brightness: Number.NaN, temperature: Number.POSITIVE_INFINITY },
  };

  const { device } = inspectScryptedDevice(record, 'scrypted-test');
  const power = device.endpoints.find((endpoint) => endpoint.id === 'power');
  const temperature = device.endpoints.find((endpoint) => endpoint.id === 'temperature');

  assert.equal(power?.readings.brightness, undefined);
  assert.equal(temperature?.readings.temperature, undefined);
});
