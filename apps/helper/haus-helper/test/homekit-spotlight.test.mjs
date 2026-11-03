/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HomeKitCameras } from '../lib/homekit.mjs';

test('camera motion and spotlight share one HAP accessory with truthful light controls and offline handling', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-hap-light-')),
    db = new DatabaseSync(':memory:');
  const camera = { id: 'camera.one', name: 'One', available: true },
    writes = [];
  let light = {
    id: 'light.spotlight',
    available: true,
    on: false,
    brightness: 25,
    capabilities: { brightness: true, color: false },
  };
  const homekit = await new HomeKitCameras({
    config: { data: root },
    store: {
      db,
      overrides: () => ({ 'camera.one': { homekit: { enabled: true, processor: 'auto' } } }),
    },
    registry: () => ({ cameras: [camera] }),
    cluster: { nodes: () => [] },
    sessions: {},
    activity: { status: () => ({ available: true, active: false }) },
    talkback: { available: async () => false },
    spotlight: { read: () => light, write: async (...value) => writes.push(value) },
  }).initialize();
  t.after(async () => {
    await homekit.stop();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  const entry = await homekit.create(camera),
    hap = homekit.hap;
  const service = entry.accessory.getService(hap.Service.Lightbulb);
  assert.ok(service);
  assert.equal(
    entry.accessory.services.filter((service) => service.UUID === hap.Service.MotionSensor.UUID)
      .length,
    1,
  );
  assert.equal(
    entry.accessory.services.filter((service) => service.UUID === hap.Service.Lightbulb.UUID)
      .length,
    1,
  );
  assert.equal(service.testCharacteristic(hap.Characteristic.Hue), false);
  assert.equal(service.testCharacteristic(hap.Characteristic.ColorTemperature), false);
  assert.equal(await service.getCharacteristic(hap.Characteristic.On).handleGetRequest(), false);
  await service.getCharacteristic(hap.Characteristic.Brightness).handleSetRequest(65);
  assert.deepEqual(writes, [[camera.id, 'light.spotlight', { brightness: 65 }]]);
  light = { ...light, available: false };
  await homekit.tick();
  assert.equal(service.getCharacteristic(hap.Characteristic.StatusFault).value, 1);
  await assert.rejects(service.getCharacteristic(hap.Characteristic.On).handleSetRequest(true));
  assert.equal(writes.length, 1);
});
