/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import {
  HomebridgeChildBridge,
  HomebridgeVirtualApi,
  PluginProcess,
  resolveHomebridgePluginEntrypoint,
} from '../dist/index.js';

test('Homebridge HAP base supports EventEmitter identify, legacy on(get/set) callbacks, CO2 UUID, and GarageDoorOpener', async () => {
  const api = new HomebridgeVirtualApi();
  assert.equal(
    api.hap.Characteristic.CarbonDioxideDetected.UUID,
    '00000092-0000-1000-8000-0026BB765291',
  );
  assert.equal(
    api.hap.Characteristic.CarbonMonoxideDetected.UUID,
    '00000069-0000-1000-8000-0026BB765291',
  );

  const acc = new api.platformAccessory('Garage', api.hap.uuid.generate('garage-1'));
  let identified = false;
  acc.on('identify', () => {
    identified = true;
  });
  acc.emit('identify');
  assert.equal(identified, true);

  const garage = acc.addService(api.hap.Service.GarageDoorOpener, 'Main Garage');
  garage.setPrimaryService(true).setHiddenService(false);
  assert.equal(garage.isPrimaryService, true);
  assert.equal(garage.testCharacteristic(api.hap.Characteristic.CurrentDoorState), true);
  assert.equal(garage.testCharacteristic(api.hap.Characteristic.TargetDoorState), true);

  const sw = acc.addService(api.hap.Service.Switch, 'Legacy Switch');
  const onChar = sw.getCharacteristic(api.hap.Characteristic.On);
  let state = false;
  onChar.on('get', (cb: (err: Error | null, val?: boolean) => void) => {
    setTimeout(() => cb(null, state), 5);
  });
  onChar.on('set', (val: boolean, cb: (err?: Error | null) => void) => {
    if (val === false && state === true) {
      setTimeout(() => cb(new Error('device_busy')), 5);
      return;
    }
    state = val;
    setTimeout(() => cb(null), 5);
  });

  await onChar.handleSet(true);
  assert.equal(await onChar.handleGet(), true);
  await assert.rejects(() => onChar.handleSet(false), /device_busy/);

  // Verify executeCommand dispatches legacy on('set') listeners + GarageDoorOpener TargetDoorState + SecuritySystemTargetState
  let garageTarget = 1;
  garage
    .getCharacteristic(api.hap.Characteristic.TargetDoorState)
    .on('set', (val: number, cb: (err?: Error | null) => void) => {
      garageTarget = val;
      garage.getCharacteristic(api.hap.Characteristic.CurrentDoorState).updateValue(val);
      cb(null);
    });
  const sec = acc.addService(api.hap.Service.SecuritySystem, 'Alarm');
  let alarmTarget = 3;
  sec
    .getCharacteristic(api.hap.Characteristic.SecuritySystemTargetState)
    .on('set', (val: number, cb: (err?: Error | null) => void) => {
      alarmTarget = val;
      sec.getCharacteristic(api.hap.Characteristic.SecuritySystemCurrentState).updateValue(val);
      cb(null);
    });
  const device = api.ingestAccessory('test-hb', acc);
  const initialGarageEp = device.endpoints.find((ep) =>
    ep.capabilities.some((c) => c.id === 'cover'),
  );
  const initialSecEp = device.endpoints.find((ep) => ep.capabilities.some((c) => c.id === 'lock'));
  assert.ok(initialGarageEp && initialSecEp);
  assert.equal(
    await api.executeCommand({
      deviceId: device.id,
      endpointId: initialGarageEp.id,
      capability: 'cover',
      value: 'open',
    }),
    true,
  );
  assert.equal(garageTarget, 0);
  assert.equal(
    await api.executeCommand({
      deviceId: device.id,
      endpointId: initialSecEp.id,
      capability: 'lock',
      value: 'locked',
    }),
    true,
  );
  assert.equal(alarmTarget, 1);
  const updated = api.getDevice(device.id);
  const garageEp = updated?.endpoints.find((ep) => ep.id === initialGarageEp.id);
  const secEp = updated?.endpoints.find((ep) => ep.id === initialSecEp.id);
  assert.equal(garageEp?.readings.cover?.value, 100);
  assert.equal(secEp?.readings.lock?.value, 'locked');
});

test('Homebridge child bridge intercepts homebridge/hap-nodejs imports and exits cleanly on load errors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'haus-hb-edge-'));
  try {
    const goodDir = join(root, 'hb-good');
    mkdirSync(join(goodDir, 'dist'), { recursive: true });
    writeFileSync(
      join(goodDir, 'package.json'),
      JSON.stringify({
        name: 'homebridge-esm-shim-test',
        type: 'module',
        exports: { '.': { node: { import: './dist/main.mjs' } } },
      }),
    );
    writeFileSync(
      join(goodDir, 'dist', 'main.mjs'),
      [
        "import { APIEvent, HAPStatus, Categories } from 'homebridge';",
        "import { Service, Characteristic } from 'hap-nodejs';",
        'export default function(api) {',
        '  if (APIEvent.DID_FINISH_LAUNCHING !== "didFinishLaunching") throw new Error("bad_api_event");',
        '  if (HAPStatus.SUCCESS !== 0) throw new Error("bad_hap_status");',
        '  api.registerPlatform("homebridge-esm-shim-test", "ShimPlat", class {',
        '    constructor(_log, _cfg, a) {',
        '      a.on(APIEvent.DID_FINISH_LAUNCHING, () => {',
        '        const acc = new a.platformAccessory("Shimmed Light", a.hap.uuid.generate("shim-1"), Categories.LIGHTBULB);',
        '        acc.addService(Service.Lightbulb, "Shimmed Light").getCharacteristic(Characteristic.On).updateValue(true);',
        '        a.registerPlatformAccessories("homebridge-esm-shim-test", "ShimPlat", [acc]);',
        '      });',
        '    }',
        '  });',
        '}',
      ].join('\n'),
    );
    assert.ok(resolveHomebridgePluginEntrypoint(goodDir).endsWith('/dist/main.mjs'));

    const bridge = new HomebridgeChildBridge({
      pluginName: 'homebridge-esm-shim-test',
      pluginPath: goodDir,
      storagePath: join(root, 'storage-good'),
      config: { name: 'ShimPlat', platform: 'ShimPlat' },
    });
    const devicesPromise = new Promise<unknown[]>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout_waiting_for_hb_devices')), 15_000);
      bridge.on('error', (err) => {
        clearTimeout(t);
        reject(err);
      });
      bridge.on('devicesChanged', (devs: unknown[]) => {
        if (devs.length > 0) {
          clearTimeout(t);
          resolve(devs);
        }
      });
    });
    await bridge.start();
    const devices = await devicesPromise;
    assert.equal(devices.length, 1);
    await bridge.stop();

    // Broken plugin must emit loadError and exit non-zero instead of lingering as a zombie
    const brokenDir = join(root, 'hb-broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(
      join(brokenDir, 'package.json'),
      JSON.stringify({ name: 'hb-broken', main: 'index.js' }),
    );
    writeFileSync(
      join(brokenDir, 'index.js'),
      'module.exports = () => { throw new Error("broken_boot"); };',
    );
    const broken = new HomebridgeChildBridge({
      pluginName: 'hb-broken',
      pluginPath: brokenDir,
      storagePath: join(root, 'storage-broken'),
      config: { name: 'Broken', platform: 'Broken' },
    });
    const exitInfo = new Promise<{ code: number | null }>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('zombie_child_bridge_detected')), 10_000);
      broken.on('error', () => {});
      broken.on('exit', (info: { code: number | null }) => {
        clearTimeout(t);
        resolve(info);
      });
    });
    await broken.start();
    const res = await exitInfo;
    assert.equal(res.code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Scrypted child process loads ESM plugin via @scrypted/sdk hook and survives unhandledRejection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'haus-scrypted-edge-'));
  try {
    const entry = join(root, 'plugin.mjs');
    writeFileSync(
      entry,
      [
        "import sdk, { ScryptedDeviceBase, ScryptedInterface } from '@scrypted/sdk';",
        'export default class EsmCameraPlugin extends ScryptedDeviceBase {',
        '  constructor() {',
        '    super();',
        '    void sdk.deviceManager.onDeviceDiscovered({',
        '      nativeId: "cam-1",',
        '      name: "ESM Test Cam",',
        '      interfaces: [ScryptedInterface.Camera, ScryptedInterface.OnOff],',
        '    });',
        '  }',
        '  async getSettings() {',
        '    void Promise.reject(new Error("transient_background_blip"));',
        '    return [{ key: "host", title: "Host", value: "10.0.0.5" }];',
        '  }',
        '  async getDevice(nativeId) {',
        '    return { nativeId, async takePicture() { return await sdk.mediaManager.createMediaObjectFromUrl("http://10.0.0.5/snap.jpg"); } };',
        '  }',
        '}',
      ].join('\n'),
    );
    const diagnostics: string[] = [];
    const proc = new PluginProcess(
      {
        name: 'test-esm-scrypted',
        version: '1.0.0',
        directory: root,
        entry: 'plugin.mjs',
        integrity: 'sha512-test',
        license: 'MIT',
        pluginDependencies: [],
        rootDevice: { name: 'ESM Plugin', interfaces: ['DeviceProvider', 'Settings'] },
      },
      {
        dataDirectory: join(root, 'data'),
        endpointBase: 'http://127.0.0.1:8790/webhook',
        ffmpegPath: '/usr/bin/ffmpeg',
        diagnostic: (d) => {
          if (d?.event) diagnostics.push(d.event);
        },
        emit: () => {},
      },
    );
    await proc.start();
    const settings = await proc.call<Array<{ key: string }>>('getSettings');
    assert.equal(settings[0]?.key, 'host');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(proc.isRunning, true);
    assert.ok(diagnostics.includes('plugin_unhandled_rejection'));
    await proc.stop();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
