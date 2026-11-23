/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StandaloneHomeService } from '../../../src/home/home.service.js';
import { StandaloneKitsuneService } from '../../../src/kitsune/kitsune.service.js';

describe('Homebridge & Scrypted ecosystem catalog + runtime supervisors', () => {
  it('syncs Homebridge and Scrypted libraries into the Hub marketplace catalog', () => {
    const home = new StandaloneHomeService();
    const kitsune = new StandaloneKitsuneService(home);

    const scryptedEntries = home.listMarketplace({ runtimeType: 'scrypted' });
    const homebridgeEntries = home.listMarketplace({ runtimeType: 'homebridge' });

    expect(scryptedEntries.length).toBeGreaterThanOrEqual(14);
    expect(homebridgeEntries.length).toBeGreaterThanOrEqual(16);
    expect(scryptedEntries.some((e) => e.id === 'scrypted-reolink' && e.packageName === '@scrypted/reolink')).toBe(true);
    expect(homebridgeEntries.some((e) => e.id === 'homebridge-hue' && e.packageName === 'homebridge-hue')).toBe(true);

    void kitsune.onModuleDestroy();
  });

  it('installs, starts, discovers devices, reads settings schema, configures, and actuates a Scrypted plugin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-scrypted-sup-'));
    const pluginDir = join(dir, 'test-scrypted-plugin');
    await mkdtemp(join(dir, 'data-'));
    try {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, 'package.json'),
        JSON.stringify({
          name: '@scrypted/reolink',
          version: '0.0.100',
          main: 'index.js',
          scrypted: {
            name: 'Reolink Camera Plugin',
            interfaces: ['DeviceProvider', 'Settings'],
          },
        }),
      );
      await writeFile(
        join(pluginDir, 'index.js'),
        `
const sdk = require('@scrypted/sdk');
const { ScryptedDeviceBase } = sdk;

class ReolinkChildCamera extends ScryptedDeviceBase {
  constructor(nativeId) {
    super(nativeId);
    this.on = false;
  }
  async turnOn() {
    this.on = true;
    console.log('child-turned-on');
  }
  async turnOff() {
    this.on = false;
  }
}

class ReolinkProvider extends ScryptedDeviceBase {
  constructor() {
    super();
    this.children = new Map();
    console.log('reolink-plugin-booted');
    setImmediate(async () => {
      await sdk.deviceManager.onDeviceDiscovered({
        nativeId: 'cam-1',
        name: 'Front Porch Reolink',
        interfaces: ['VideoCamera', 'MotionSensor', 'OnOff'],
        type: 'Camera',
      });
    });
  }
  async getSettings() {
    return [
      { key: 'host', title: 'Camera IP', type: 'string', value: this.storage.getItem('host') || '' },
      { key: 'password', title: 'Password', type: 'password', value: '' },
    ];
  }
  async putSetting(key, value) {
    this.storage.setItem(key, String(value));
    console.log('setting-updated:' + key);
  }
  async getDevice(nativeId) {
    if (!this.children.has(nativeId)) {
      this.children.set(nativeId, new ReolinkChildCamera(nativeId));
    }
    return this.children.get(nativeId);
  }
}

module.exports = ReolinkProvider;
`,
      );

      const home = new StandaloneHomeService();
      const kitsune = new StandaloneKitsuneService(home);
      await kitsune.scryptedRuntime.configure({ dataDirectory: dir });

      const catalogEntry = home.getAppCatalogEntry('scrypted-reolink');
      expect(catalogEntry).toBeDefined();

      const installed = await home.installApp('admin', catalogEntry!.manifest, [], {
        pluginPath: pluginDir,
        host: '192.168.1.50',
      });
      expect(installed.manifest.id).toBe('scrypted-reolink');
      expect(kitsune.scryptedRuntime.isRunning('scrypted-reolink')).toBe(true);

      // Native settings schema extracted from real plugin getSettings()
      const schema = kitsune.scryptedRuntime.getNativeConfigSchema('scrypted-reolink');
      expect(schema?.host?.title).toBe('Camera IP');
      expect(schema?.password?.secret).toBe(true);

      // Device discovered and projected into StandaloneHomeService
      const devices = home.listDevices();
      const camDevice = devices.find((d) => d.id === 'kitsune:scrypted-reolink:cam-1');
      expect(camDevice).toBeDefined();
      expect(camDevice?.name).toBe('Front Porch Reolink');

      // Execute command through StandaloneHomeService -> StandaloneKitsuneService -> ScryptedAppSupervisor
      const powerEp = camDevice?.endpoints.find((ep) => ep.id.endsWith(':power'));
      expect(powerEp).toBeDefined();
      await home.executeDeviceCommand(powerEp!.id, 'on_off', 'turn_on');

      const logs = kitsune.scryptedRuntime.getLogs('scrypted-reolink') ?? [];
      expect(logs.some((l) => l.includes('reolink-plugin-booted'))).toBe(true);
      expect(logs.some((l) => l.includes('setting-updated:host'))).toBe(true);

      await kitsune.onModuleDestroy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
