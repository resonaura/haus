/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNestApp } from '../../../src/nest.js';
import { StandaloneKitsuneService } from '../../../src/kitsune/kitsune.service.js';
import {
  STANDALONE_HOME_SERVICE,
  type StandaloneHomeService,
} from '../../../src/home/home.service.js';
import {
  HomebridgeVirtualApi,
  MockAccessory,
  HAPServices,
  HAPCharacteristics,
} from '@haus/kitsune';
import { kelvinToMireds } from '@haus/core/device';

describe('Real Homebridge Govee Acceptance & Bidirectional Actuation (P18.5.2)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let kitsuneService: StandaloneKitsuneService;
  let homeService: StandaloneHomeService;
  let api: HomebridgeVirtualApi;
  let accessory: MockAccessory;

  let lastOnSet: boolean | undefined;
  let lastBrightnessSet: number | undefined;
  let lastColorTempSet: number | undefined;
  let lastHueSet: number | undefined;
  let lastSatSet: number | undefined;

  let rateLimitActive = false;
  let unauthorizedActive = false;

  const token = 'govee-acceptance-token';
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  const deviceUUID = '11223344-5566-7788-99aa-bbccddeeff00';
  const pluginName = 'homebridge-govee';

  beforeAll(async () => {
    app = await createNestApp({ apiToken: token });
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 8798;
    baseUrl = `http://127.0.0.1:${port}`;

    kitsuneService = app.get(StandaloneKitsuneService);
    homeService = app.get(STANDALONE_HOME_SERVICE);

    // Build realistic Homebridge Govee Lyra Floor Lamp (H6072) accessory
    api = new HomebridgeVirtualApi();
    accessory = new MockAccessory('Living Room Lyra Lamp', deviceUUID, 5); // 5 = Lightbulb category

    const infoService = accessory.addService(
      new HAPServices.AccessoryInformation('Info', 'info-uuid'),
    );
    infoService.getCharacteristic('Manufacturer').setValue('Govee');
    infoService.getCharacteristic('Model').setValue('H6072');
    infoService.getCharacteristic('SerialNumber').setValue('GV-H6072-1234');

    const lightService = accessory.addService(
      new HAPServices.Lightbulb('Living Room Lyra Lamp', 'light-uuid'),
    );
    const onChar = lightService.getCharacteristic('On');
    const briChar = lightService.getCharacteristic('Brightness');

    lightService.addCharacteristic(new HAPCharacteristics.ColorTemperature());
    const ctChar = lightService.getCharacteristic('ColorTemperature');

    lightService.addCharacteristic(new HAPCharacteristics.Hue());
    const hueChar = lightService.getCharacteristic('Hue');

    lightService.addCharacteristic(new HAPCharacteristics.Saturation());
    const satChar = lightService.getCharacteristic('Saturation');

    // Register realistic async onSet and onGet handlers
    onChar.onSet(async (val) => {
      if (rateLimitActive) throw new Error('govee_rate_limited: 429 Too Many Requests');
      if (unauthorizedActive) throw new Error('govee_unauthorized: 401 Invalid API Key');
      lastOnSet = Boolean(val);
    });
    onChar.onGet(() => Boolean(lastOnSet));

    briChar.onSet(async (val) => {
      if (rateLimitActive) throw new Error('govee_rate_limited: 429 Too Many Requests');
      lastBrightnessSet = Number(val);
    });
    briChar.onGet(() => lastBrightnessSet ?? 100);

    ctChar.onSet(async (val) => {
      if (rateLimitActive) throw new Error('govee_rate_limited: 429 Too Many Requests');
      lastColorTempSet = Number(val);
    });

    hueChar.onSet(async (val) => {
      lastHueSet = Number(val);
    });

    satChar.onSet(async (val) => {
      lastSatSet = Number(val);
    });

    // Ingest into Homebridge virtual API
    api.registerPlatformAccessories(pluginName, 'GoveePlatform', [accessory]);

    // Attach to Kitsune compatibility engine in StandaloneKitsuneService
    kitsuneService.attachHomebridgeApi(pluginName, 'haus-hub-standalone', 1, api);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('translates Homebridge Govee accessory to Haus device with category lighting and full capabilities', () => {
    const devices = homeService.listDevices();
    const expectedDeviceId = `homebridge:${pluginName}:${deviceUUID}`;
    const device = devices.find((d) => d.id === expectedDeviceId);

    expect(device).toBeDefined();
    expect(device?.name).toBe('Living Room Lyra Lamp');
    expect(device?.category).toBe('lighting');
    expect(device?.connectivity.protocol).toBe('virtual');
    expect(device?.sourceRefs?.[0]?.protocol).toBe('virtual');
    expect(device?.endpoints.length).toBeGreaterThan(0);

    const mainEndpoint = device?.endpoints[0];
    expect(mainEndpoint).toBeDefined();
    const capIds = mainEndpoint?.capabilities.map((c) => c.id);
    expect(capIds).toContain('on_off');
    expect(capIds).toContain('brightness');
    expect(capIds).toContain('color_temp');
    expect(capIds).toContain('color_hsv');
  });

  it('propagates external characteristic change to Haus device readings and endpoint states', () => {
    const lightService = accessory.getServiceById(HAPServices.Lightbulb.UUID);
    expect(lightService).toBeDefined();

    // External change (e.g. physical switch or BLE update)
    lightService?.getCharacteristic('On').setValue(true);
    lightService?.getCharacteristic('Brightness').setValue(88);
    lightService?.getCharacteristic('ColorTemperature').setValue(250); // 250 mireds = 4000K

    const expectedDeviceId = `homebridge:${pluginName}:${deviceUUID}`;
    const device = homeService.getDevice(expectedDeviceId);
    expect(device).toBeDefined();

    const ep = device?.endpoints[0];
    expect(ep?.readings.on_off?.value).toBe(true);
    expect(ep?.readings.brightness?.value).toBe(88);
    expect(ep?.readings.color_temp_mireds?.value).toBe(250);
    expect(ep?.readings.color_temp?.value).toBe(4000);

    // Verify endpoint state in homeService matches
    const epState = homeService.getEndpointState(ep!.id);
    expect(epState?.on_off).toBe(true);
    expect(epState?.brightness).toBe(88);
  });

  it('executes turn_off and turn_on commands via POST /api/devices/:id/command and sets HAP characteristics', async () => {
    const expectedDeviceId = `homebridge:${pluginName}:${deviceUUID}`;
    const device = homeService.getDevice(expectedDeviceId);
    const epId = device!.endpoints[0]!.id;

    // Execute turn_off
    const offRes = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent(expectedDeviceId)}/command`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpointId: epId,
          capability: 'on_off',
          command: 'turn_off',
        }),
      },
    );
    expect(offRes.status).toBe(200);
    const offBody = await offRes.json();
    expect(offBody.status).toBe('accepted');
    expect(lastOnSet).toBe(false);
    expect(accessory.getServiceById(HAPServices.Lightbulb.UUID)?.getCharacteristic('On').value).toBe(
      false,
    );

    // Execute turn_on
    const onRes = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent(expectedDeviceId)}/command`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpointId: epId,
          capability: 'on_off',
          command: 'turn_on',
        }),
      },
    );
    expect(onRes.status).toBe(200);
    expect(lastOnSet).toBe(true);
    expect(accessory.getServiceById(HAPServices.Lightbulb.UUID)?.getCharacteristic('On').value).toBe(
      true,
    );
  });

  it('actuates brightness, color temperature (Kelvin to Mireds), and color HSV', async () => {
    const expectedDeviceId = `homebridge:${pluginName}:${deviceUUID}`;
    const device = homeService.getDevice(expectedDeviceId);
    const epId = device!.endpoints[0]!.id;

    // Set brightness to 70%
    const briRes = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent(expectedDeviceId)}/command`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpointId: epId,
          capability: 'brightness',
          command: 'set',
          parameters: { value: 70 },
        }),
      },
    );
    expect(briRes.status).toBe(200);
    expect(lastBrightnessSet).toBe(70);

    // Set color temperature to 2700K (warm white -> ~370 mireds)
    const ctRes = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent(expectedDeviceId)}/command`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpointId: epId,
          capability: 'color_temp',
          command: 'set',
          parameters: { value: 2700 },
        }),
      },
    );
    expect(ctRes.status).toBe(200);
    expect(lastColorTempSet).toBe(kelvinToMireds(2700));

    // Set color HSV (Hue 210, Saturation 85)
    const colorRes = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent(expectedDeviceId)}/command`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpointId: epId,
          capability: 'color_hsv',
          command: 'set',
          parameters: { value: { hue: 210, saturation: 85 } },
        }),
      },
    );
    expect(colorRes.status).toBe(200);
    expect(lastHueSet).toBe(210);
    expect(lastSatSet).toBe(85);
  });

  it('actuates turn_on with compound parameters (brightness + color_temp)', async () => {
    const expectedDeviceId = `homebridge:${pluginName}:${deviceUUID}`;
    const device = homeService.getDevice(expectedDeviceId);
    const epId = device!.endpoints[0]!.id;

    // Turn on with brightness 92% and 3500K color temp
    const cmdRes = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent(expectedDeviceId)}/command`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpointId: epId,
          capability: 'on_off',
          command: 'turn_on',
          parameters: { brightness: 92, color_temp_kelvin: 3500 },
        }),
      },
    );
    expect(cmdRes.status).toBe(200);
    expect(lastOnSet).toBe(true);
    expect(lastBrightnessSet).toBe(92);
    expect(lastColorTempSet).toBe(kelvinToMireds(3500));
  });

  it('rejects truthfully on Govee API rate limit (429) without claiming success', async () => {
    const expectedDeviceId = `homebridge:${pluginName}:${deviceUUID}`;
    const device = homeService.getDevice(expectedDeviceId);
    const epId = device!.endpoints[0]!.id;

    rateLimitActive = true;
    try {
      await expect(
        homeService.executeDeviceCommand(epId, 'on_off', 'turn_on'),
      ).rejects.toThrow('govee_rate_limited');
    } finally {
      rateLimitActive = false;
    }
  });

  it('rejects truthfully on Govee API authorization failure (401) without claiming success', async () => {
    const expectedDeviceId = `homebridge:${pluginName}:${deviceUUID}`;
    const device = homeService.getDevice(expectedDeviceId);
    const epId = device!.endpoints[0]!.id;

    unauthorizedActive = true;
    try {
      await expect(
        homeService.executeDeviceCommand(epId, 'on_off', 'turn_on'),
      ).rejects.toThrow('govee_unauthorized');
    } finally {
      unauthorizedActive = false;
    }
  });

  it('enforces session epoch fencing when restarting plugin session', async () => {
    const expectedDeviceId = `homebridge:${pluginName}:${deviceUUID}`;
    const device = homeService.getDevice(expectedDeviceId);
    const epId = device!.endpoints[0]!.id;

    // Restart session for homebridge-govee -> epoch increments from 1 to 2
    const restartedLease = kitsuneService.restartSession(
      'homebridge',
      pluginName,
      'haus-hub-standalone',
    );
    expect(restartedLease.epoch).toBe(2);

    // Attempting a command with stale epoch 1 must fail with kitsune_stale_session_epoch
    await expect(
      kitsuneService.engine.executeCommand('homebridge', pluginName, 'haus-hub-standalone', 1, {
        deviceId: expectedDeviceId,
        endpointId: epId,
        capability: 'on_off',
        value: true,
      }),
    ).rejects.toThrow('kitsune_stale_session_epoch');

    // Executing with active epoch 2 succeeds
    await expect(
      kitsuneService.engine.executeCommand('homebridge', pluginName, 'haus-hub-standalone', 2, {
        deviceId: expectedDeviceId,
        endpointId: epId,
        capability: 'on_off',
        value: false,
      }),
    ).resolves.toEqual({ ok: true });
    expect(lastOnSet).toBe(false);
  });

  it('rejects unsupported capabilities and records them in diagnostics and unsupported matrix', async () => {
    const expectedDeviceId = `homebridge:${pluginName}:${deviceUUID}`;
    const device = homeService.getDevice(expectedDeviceId);
    const epId = device!.endpoints[0]!.id;

    await expect(
      kitsuneService.handleDeviceCommand(epId, 'siren', 'set', { value: true }),
    ).rejects.toThrow('kitsune_unsupported_capability:siren');

    const compat = kitsuneService.compatibility();
    const unsupportedSiren = compat.unsupportedCapabilities.find(
      (u) => u.capability === 'siren' && u.pluginId === pluginName,
    );
    expect(unsupportedSiren).toBeDefined();
    expect(unsupportedSiren?.reason).toBe('unsupported_hap_capability_command');

    const diagnostic = compat.diagnostics.find(
      (d) => d.pluginId === pluginName && d.event === 'unsupported_capability',
    );
    expect(diagnostic).toBeDefined();
  });

  it('resolves replacement alias to canonical Homebridge device for backward-compatible command routing', async () => {
    const expectedDeviceId = `homebridge:${pluginName}:${deviceUUID}`;
    const legacyAliasId = 'mqtt_gv2mqtt-0AA36074F4EEEF30';

    await homeService.registerAlias(legacyAliasId, expectedDeviceId);

    // Looking up the device via the legacy alias resolves to the canonical device
    const resolvedDevice = homeService.getDevice(legacyAliasId);
    expect(resolvedDevice).toBeDefined();
    expect(resolvedDevice?.id).toBe(expectedDeviceId);

    // Executing command via POST /api/devices/:id/command with legacy alias acts on the Homebridge accessory
    const epId = resolvedDevice!.endpoints[0]!.id;
    const res = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent(legacyAliasId)}/command`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpointId: epId,
          capability: 'on_off',
          command: 'turn_on',
          parameters: { brightness: 80 },
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('accepted');
    expect(lastOnSet).toBe(true);
    expect(lastBrightnessSet).toBe(80);
  });

  it('reuses cached plugin directory on install and forces fresh PluginInstaller download on updateApp', async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { vi } = await import('vitest');
    const { HOMEBRIDGE_GOVEE_PACKAGE, PluginInstaller } = await import('@haus/kitsune');
    const { HomebridgeAppSupervisor } = await import('../../../src/kitsune/homebridge-runtime.js');

    const rootDir = await mkdtemp(join(tmpdir(), 'haus-govee-update-'));
    try {
      const writeMockPlugin = async (pluginDir: string, version: string) => {
        await mkdir(join(pluginDir, 'lib', 'utils'), { recursive: true });
        await writeFile(
          join(pluginDir, 'package.json'),
          JSON.stringify({ name: HOMEBRIDGE_GOVEE_PACKAGE, version, main: 'index.js', type: 'module' }),
        );
        await writeFile(
          join(pluginDir, 'lib', 'utils', 'constants.js'),
          `export default { models: { switchSingle: ['H5080'], switchDouble: ['H5082'], switchTriple: ['H5160'] } };`,
        );
        await writeFile(
          join(pluginDir, 'index.js'),
          `export default (api) => { api.registerPlatform('Govee', class { configureAccessory() {} }); };`,
        );
      };

      const cachedDir = join(rootDir, 'kitsune', 'plugins', 'cached-v1');
      const updatedDir = join(rootDir, 'kitsune', 'plugins', 'updated-v2');
      await writeMockPlugin(cachedDir, '11.39.0');
      await writeMockPlugin(updatedDir, '11.40.0');

      const supervisor = new HomebridgeAppSupervisor(kitsuneService.engine, homeService);
      await supervisor.configure({ dataDirectory: rootDir });

      const installSpy = vi.spyOn(PluginInstaller.prototype, 'install').mockResolvedValue({
        name: HOMEBRIDGE_GOVEE_PACKAGE,
        version: '11.40.0',
        directory: updatedDir,
        entry: 'index.js',
        integrity: 'sha512-updated',
        license: 'MIT',
        pluginDependencies: [],
      });

      const manifest = {
        id: 'govee',
        name: 'Govee',
        version: '11.39.1',
        image: 'node:22-bookworm-slim',
        architectures: ['amd64', 'arm64'] as const,
      };
      const config = { bleDisable: true, awsDisable: true, lanDisable: true };

      try {
        await supervisor.install({ manifest, config });
        expect(installSpy).not.toHaveBeenCalled();

        await supervisor.updateApp(
          { manifest, state: 'running', logs: [], config },
          { ...manifest, version: '11.40.0' },
        );
        expect(installSpy).toHaveBeenCalledTimes(1);
        expect(installSpy).toHaveBeenCalledWith(HOMEBRIDGE_GOVEE_PACKAGE, 'latest');
      } finally {
        installSpy.mockRestore();
        await supervisor.removeApp({ manifest, state: 'stopped', logs: [], config });
        await supervisor.close();
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
