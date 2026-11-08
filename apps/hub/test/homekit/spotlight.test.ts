/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { test, onTestFinished } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HomeKitCameras, type HomeKitCamerasOptions } from '@haus/hub/homekit';

const stubNode = {
  id: 'n',
  name: 'Node',
  url: 'http://127.0.0.1',
  key: 'k',
  enabled: true,
  roles: [] as string[],
};
const stubSessions: HomeKitCamerasOptions['sessions'] = {
  ensure: async () => ({ id: 'stub', node: stubNode }),
  ensureLive: async () => ({ id: 'stub', node: stubNode }),
  release: async () => {},
  advertiseHost: async () => '127.0.0.1',
};

test('camera motion and spotlight share one HAP accessory with truthful light controls and offline handling', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-hap-light-'));
  const camera = { id: 'camera.one', name: 'One', available: true },
    writes: unknown[][] = [];
  let light = {
    id: 'light.spotlight',
    available: true,
    on: false,
    brightness: 25,
    capabilities: { brightness: true, color: false },
  };
  const operating = {
    indicator: { id: 'switch.led', available: true, value: true },
    nightVision: { id: 'switch.ir', available: true, value: false },
  };
  const operatingWrites: unknown[][] = [];
  const homekit = await new HomeKitCameras({
    config: { data: root },
    store: {
      overrides: () => ({ 'camera.one': { homekit: { enabled: true, processor: 'auto' } } }),
    },
    registry: () => ({ cameras: [camera] }),
    cluster: { nodes: () => [], health: new Map() },
    sessions: stubSessions,
    activity: { status: () => ({ available: true, active: false }) },
    talkback: { available: async () => false, stream: async () => {} },
    spotlight: {
      read: () => light,
      write: async (...value) => {
        writes.push(value);
      },
    },
    operating: {
      read: () => operating,
      write: async (...value) => {
        operatingWrites.push(value);
      },
    },
  }).initialize();
  onTestFinished(async () => {
    await homekit.stop();
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
  const mode = entry.controller.recordingManagement.operatingModeService;
  assert.equal(
    await mode
      .getCharacteristic(hap.Characteristic.CameraOperatingModeIndicator)
      .handleGetRequest(),
    1,
  );
  assert.equal(
    await mode.getCharacteristic(hap.Characteristic.NightVision).handleGetRequest(),
    false,
  );
  await mode.getCharacteristic(hap.Characteristic.NightVision).handleSetRequest(true);
  assert.deepEqual(operatingWrites, [[camera.id, 'nightVision', 'switch.ir', true]]);
  operating.nightVision.available = false;
  await assert.rejects(
    mode.getCharacteristic(hap.Characteristic.NightVision).handleSetRequest(false),
  );
  assert.equal(operatingWrites.length, 1);
});
