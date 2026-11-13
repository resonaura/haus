/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { INestApplication } from '@nestjs/common';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppCatalog } from '@haus/apps';
import { resetActiveGoveeOutletCatalog } from '@haus/kitsune';
import { HausMqttClient } from '@haus/mqtt';
import { createNestApp } from '../../../src/nest.js';
import {
  STANDALONE_HOME_SERVICE,
  type StandaloneHomeService,
} from '../../../src/home/home.service.js';
import { StandaloneKitsuneService } from '../../../src/kitsune/kitsune.service.js';
import { MqttService } from '../../../src/mqtt/service.js';

async function waitFor<T>(
  check: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 8000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const val = await check();
    if (val !== undefined) return val;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function createFixtureGoveePlugin(dir: string, commandLogPath: string): Promise<void> {
  await mkdir(join(dir, 'lib', 'utils'), { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: '@homebridge-plugins/homebridge-govee',
      version: '11.39.99',
      type: 'module',
      main: 'lib/index.js',
    }),
  );

  await writeFile(
    join(dir, 'lib', 'utils', 'constants.js'),
    `export default {
  models: {
    switchSingle: ['H5080', 'H5083', 'H5099'],
    switchDouble: ['H5082'],
    switchTriple: ['H5160'],
  },
};
`,
  );

  await writeFile(
    join(dir, 'lib', 'index.js'),
    `import { appendFileSync } from 'node:fs';

class FixtureGoveePlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.log('Fixture password probe:', String(config.password ?? ''));
    api.on('didFinishLaunching', () => this.publishDevices());
  }

  configureAccessory() {}

  publishDevices() {
    const { AccessoryInformation, Outlet, Switch, Lightbulb } = this.api.hap.Service;
    const { On, Name, Manufacturer, Model, SerialNumber } = this.api.hap.Characteristic;
    const logCmd = (entry) => appendFileSync(${JSON.stringify(commandLogPath)}, JSON.stringify(entry) + '\\n');

    const mkAcc = (name, id, cat, model, serial, configure) => {
      const uuid = this.api.hap.uuid.generate(id);
      const acc = new this.api.platformAccessory(name, uuid, cat);
      acc.context = { gvDeviceId: serial, gvModel: model };
      const info = acc.getService(AccessoryInformation) ?? acc.addService(AccessoryInformation);
      info.updateCharacteristic(Manufacturer, 'Govee');
      info.updateCharacteristic(Model, model);
      info.updateCharacteristic(SerialNumber, serial);
      configure(acc);
      return acc;
    };

    const h5083 = mkAcc('Strip Plug', 'govee-h5083', 7, 'H5083', '1E:C8:DC:6E:01:C6:42:2A', (acc) => {
      let state = false;
      const svc = acc.addService(Outlet, 'Strip Plug', 'outlet');
      svc.getCharacteristic(On)
        .onGet(() => state)
        .onSet(async (val) => {
          state = Boolean(val);
          logCmd({ device: 'H5083', channel: 0, on: state });
          svc.updateCharacteristic(On, state);
        });
    });

    const h5099 = mkAcc('Xmas Garland', 'govee-h5099', 7, 'H5099', 'AA:BB:CC:DD:EE:01', (acc) => {
      let state = false;
      const svc = acc.addService(Outlet, 'Xmas Garland', 'outlet');
      svc.getCharacteristic(On)
        .onGet(() => state)
        .onSet(async (val) => {
          state = Boolean(val);
          logCmd({ device: 'H5099', channel: 0, on: state });
          svc.updateCharacteristic(On, state);
        });
    });

    const h5082 = mkAcc('Dual Plug', 'govee-h5082', 7, 'H5082', 'AA:BB:CC:DD:EE:02', (acc) => {
      let s1 = false;
      let s2 = false;
      const svc1 = acc.addService(Switch, 'Switch 1', 'switch1');
      svc1.updateCharacteristic(Name, 'Outlet 1');
      svc1.getCharacteristic(On)
        .onGet(() => s1)
        .onSet(async (val) => {
          s1 = Boolean(val);
          logCmd({ device: 'H5082', channel: 1, on: s1 });
          svc1.updateCharacteristic(On, s1);
        });
      const svc2 = acc.addService(Switch, 'Switch 2', 'switch2');
      svc2.updateCharacteristic(Name, 'Outlet 2');
      svc2.getCharacteristic(On)
        .onGet(() => s2)
        .onSet(async (val) => {
          s2 = Boolean(val);
          logCmd({ device: 'H5082', channel: 2, on: s2 });
          svc2.updateCharacteristic(On, s2);
        });
    });

    const h6006 = mkAcc('RGBWW Bulb', 'govee-h6006', 5, 'H6006', '22:33:44:55:66:77:88:99', (acc) => {
      const svc = acc.addService(Lightbulb, 'RGBWW Bulb', 'light');
      svc.getCharacteristic(On).onSet(async () => {});
    });

    const h6022 = mkAcc('Bed Lamp', 'govee-h6022', 5, 'H6022', '44:55:66:77:88:99:00:11', (acc) => {
      const svc = acc.addService(Lightbulb, 'Bed Lamp', 'light');
      svc.getCharacteristic(On).onSet(async () => {});
    });

    this.api.registerPlatformAccessories('govee', 'Govee', [h5083, h5099, h5082, h6006, h6022]);
  }
}

export default (api) => {
  api.registerPlatform('Govee', FixtureGoveePlatform);
};
`,
  );
}

describe('Hybrid Govee Pseudo-Integration E2E (Homebridge Outlets + govee2mqtt Lights)', () => {
  let tempDir: string;
  let pluginDir: string;
  let cmdLogPath: string;
  let app: INestApplication;
  let baseUrl: string;
  let homeService: StandaloneHomeService;
  let kitsuneService: StandaloneKitsuneService;
  let mqttService: MqttService;
  let mqttClient: HausMqttClient;

  const token = 'govee-hybrid-test-token';
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  beforeAll(async () => {
    resetActiveGoveeOutletCatalog();
    tempDir = await mkdtemp(join(tmpdir(), 'haus-govee-hybrid-'));
    pluginDir = join(tempDir, 'fixture-hb-govee');
    cmdLogPath = join(tempDir, 'commands.jsonl');
    await createFixtureGoveePlugin(pluginDir, cmdLogPath);

    app = await createNestApp({ dataDirectory: tempDir, apiToken: token });
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 8799;
    baseUrl = `http://127.0.0.1:${port}`;

    homeService = app.get(STANDALONE_HOME_SERVICE);
    kitsuneService = app.get(StandaloneKitsuneService);
    mqttService = app.get(MqttService);

    mqttClient = new HausMqttClient({
      host: '127.0.0.1',
      port: mqttService.broker.port,
      allowAnonymous: true,
    });
    await mqttClient.connect();
  });

  afterAll(async () => {
    resetActiveGoveeOutletCatalog();
    await mqttClient?.close().catch(() => undefined);
    await app?.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('publishes pre-existing govee2mqtt devices (outlets as power + lights as lighting), then cleanly hands over outlets on Govee app install', async () => {
    // 1. Pre-existing govee2mqtt devices before installing unified "govee" app:
    // H5083 plug named "Strip Plug" must classify as 'power' (never 'lighting'),
    // and lights H6006, H615D, H6022 classify as 'lighting'.
    const publishMqttDiscovery = async (
      component: 'light' | 'switch',
      rawId: string,
      name: string,
      model: string,
    ) => {
      await mqttClient.publish({
        topic: `homeassistant/${component}/${rawId}/config`,
        payload: JSON.stringify({
          unique_id: rawId,
          name: null,
          schema: component === 'light' ? 'json' : undefined,
          state_topic: `gv2mqtt/${component}/${rawId}/state`,
          command_topic: `gv2mqtt/${component}/${rawId}/command`,
          payload_on: component === 'switch' ? 'ON' : undefined,
          payload_off: component === 'switch' ? 'OFF' : undefined,
          device: {
            identifiers: [rawId],
            name,
            manufacturer: 'Govee',
            model,
          },
          origin: {
            name: 'govee2mqtt',
            url: 'https://github.com/wez/govee2mqtt',
          },
        }),
        qos: 1,
        retain: true,
      });
    };

    await publishMqttDiscovery('light', 'gv2mqtt-1EC8DC6E01C6422A', 'Strip Plug', 'H5083');
    await publishMqttDiscovery('light', 'gv2mqtt-2233445566778899', 'RGBWW Bulb', 'H6006');
    await publishMqttDiscovery('light', 'gv2mqtt-3344556677889900', 'LED Strip', 'H615D');
    await publishMqttDiscovery('light', 'gv2mqtt-4455667788990011', 'Bed Lamp', 'H6022');

    const mqttPlug = await waitFor(() => homeService.getDevice('mqtt_gv2mqtt-1EC8DC6E01C6422A'));
    expect(mqttPlug.category).toBe('power');
    await homeService.moveDeviceRoom({
      actor: { actorId: 'test-admin', role: 'admin' },
      deviceId: mqttPlug.id,
      targetRoomId: 'living_room',
    });
    expect(homeService.getDevice(mqttPlug.id)?.roomId).toBe('living_room');

    // 2. Install & start unified "govee" pseudo-integration pointing to fixture Homebridge plugin
    const goveeEntry = AppCatalog.createDefaultCatalog().get('govee');
    expect(goveeEntry).toBeDefined();

    await homeService.installApp('test-admin', goveeEntry!.manifest, [], {
      pluginPath: pluginDir,
      username: 'owner@example.com',
      password: 'super-secret-govee-password',
    });

    // Wait for child bridge accessories H5083, H5099, H5082 to project into Home
    const hbH5083 = await waitFor(() =>
      homeService
        .listDevices()
        .find((d) => d.source.instanceId === 'homebridge:govee' && d.model === 'H5083'),
    );
    const hbH5099 = await waitFor(() =>
      homeService
        .listDevices()
        .find((d) => d.source.instanceId === 'homebridge:govee' && d.model === 'H5099'),
    );
    const hbH5082 = await waitFor(() =>
      homeService
        .listDevices()
        .find((d) => d.source.instanceId === 'homebridge:govee' && d.model === 'H5082'),
    );

    expect(hbH5083.category).toBe('power');
    expect(hbH5099.category).toBe('power');
    expect(hbH5082.category).toBe('power');
    expect(hbH5082.endpoints).toHaveLength(2);

    // Homebridge Govee lights H6006 & H6022 must be suppressed in unified hybrid mode
    const homebridgeLights = homeService
      .listDevices()
      .filter((d) => d.source.instanceId === 'homebridge:govee' && d.category === 'lighting');
    expect(homebridgeLights).toHaveLength(0);

    // MQTT Govee lights H6006, H615D, H6022 remain owned by govee2mqtt
    expect(homeService.getDevice('mqtt_gv2mqtt-2233445566778899')?.source.instanceId).toBe('haus-mqtt');
    expect(homeService.getDevice('mqtt_gv2mqtt-3344556677889900')?.source.instanceId).toBe('haus-mqtt');
    expect(homeService.getDevice('mqtt_gv2mqtt-4455667788990011')?.source.instanceId).toBe('haus-mqtt');

    // Handover: room preserved and legacy MQTT ID aliased to canonical Homebridge H5083 device
    await kitsuneService.flushPendingReconciliations();
    expect(homeService.getDevice(hbH5083.id)?.roomId).toBe('living_room');
    expect(homeService.getDevice('mqtt_gv2mqtt-1EC8DC6E01C6422A')?.id).toBe(hbH5083.id);

    // Secrets redacted and BLE + catalog info reported in app logs/inspect
    const inspectRes = await homeService.inspectApp('test-admin', 'govee');
    expect(inspectRes.status).toBe('ok');
    if (inspectRes.status === 'ok') {
      expect(inspectRes.data?.description).toContain('Hybrid Govee');
    }
    const logsRes = await homeService.operateApp('test-admin', 'govee', 'logs');
    expect(logsRes.status).toBe('ok');
    if (logsRes.status === 'ok') {
      const joined = (logsRes.data as { lines: string[] }).lines.join('\n');
      expect(joined).toContain('BLE transport mode:');
      expect(joined).toContain('installed-plugin');
      expect(joined).not.toContain('super-secret-govee-password');
    }

    // 3. Re-publishing MQTT discoveries for outlets H5083 or dynamic H5099 while unified Govee is active must be suppressed
    await publishMqttDiscovery('light', 'gv2mqtt-1EC8DC6E01C6422A', 'Strip Plug', 'H5083');
    await publishMqttDiscovery('light', 'gv2mqtt-AABBCCDDEE01', 'Xmas Garland', 'H5099');
    await mqttService.drain();

    const rawMqttPlugDuplicates = homeService
      .listDevices()
      .filter((d) => d.source.instanceId === 'haus-mqtt' && (d.model === 'H5083' || d.model === 'H5099'));
    expect(rawMqttPlugDuplicates).toHaveLength(0);

    // 4. Actuate H5083 via legacy MQTT alias and H5082 outlet 2 independently via HTTP API
    const legacyCmdRes = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent('mqtt_gv2mqtt-1EC8DC6E01C6422A')}/command`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpointId: hbH5083.endpoints[0]!.id,
          capability: 'on_off',
          command: 'turn_on',
        }),
      },
    );
    expect(legacyCmdRes.status).toBe(200);

    const ep2 = hbH5082.endpoints[1]!;
    const dualCmdRes = await fetch(`${baseUrl}/api/devices/${encodeURIComponent(hbH5082.id)}/command`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        endpointId: ep2.id,
        capability: 'on_off',
        command: 'turn_on',
      }),
    });
    expect(dualCmdRes.status).toBe(200);

    const commands = await waitFor(async () => {
      const content = await readFile(cmdLogPath, 'utf8').catch(() => '');
      const parsed = content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { device: string; channel: number; on: boolean });
      return parsed.length >= 2 ? parsed : undefined;
    });
    expect(commands).toContainEqual({ device: 'H5083', channel: 0, on: true });
    expect(commands).toContainEqual({ device: 'H5082', channel: 2, on: true });
    expect(commands.some((c) => c.device === 'H5082' && c.channel === 1)).toBe(false);

    await waitFor(() => {
      const updated = homeService.getDevice(hbH5082.id);
      return updated?.endpoints[1]?.readings?.on_off?.value === true ? updated : undefined;
    });
  }, 20000);

  it('restores persisted running Govee child bridge across Hub restart and supports clean stop/remove', async () => {
    await mqttClient.close().catch(() => undefined);
    await app.close();

    // Boot fresh Nest app against the same dataDirectory
    app = await createNestApp({ dataDirectory: tempDir, apiToken: token });
    await app.listen(0);
    homeService = app.get(STANDALONE_HOME_SERVICE);
    kitsuneService = app.get(StandaloneKitsuneService);
    mqttService = app.get(MqttService);

    mqttClient = new HausMqttClient({
      host: '127.0.0.1',
      port: mqttService.broker.port,
      allowAnonymous: true,
    });
    await mqttClient.connect();

    const restoredPlug = await waitFor(() =>
      homeService
        .listDevices()
        .find((d) => d.source.instanceId === 'homebridge:govee' && d.model === 'H5083'),
    );
    expect(restoredPlug.category).toBe('power');

    // Stop clears Homebridge devices from Home; remove uninstalls cleanly
    await homeService.executeApp('test-admin', 'govee', 'stop');
    await waitFor(() =>
      homeService.listDevices().some((d) => d.source.instanceId === 'homebridge:govee')
        ? undefined
        : true,
    );

    const removeResult = await homeService.operateApp('test-admin', 'govee', 'remove');
    expect(removeResult.status).toBe('ok');
  }, 20000);

  it('keeps legacy Docker govee (govee2mqtt) isolated and pairs homebridge-govee cleanly in hybrid mode', async () => {
    const legacyManifest = {
      id: 'govee',
      name: 'Govee to MQTT',
      version: '2026.03.25',
      image: 'ghcr.io/wez/govee2mqtt:2026.03.25-ab9deb66',
      architectures: ['amd64'] as const,
      network: { mode: 'host' as const },
    };
    await homeService.getPersistence().save('app', 'govee', {
      manifest: legacyManifest,
      state: 'running',
      logs: [],
      config: {},
      containerId: 'c'.repeat(64),
    });

    await mqttClient.close().catch(() => undefined);
    await app.close();
    app = await createNestApp({ dataDirectory: tempDir, apiToken: token });
    await app.listen(0);
    homeService = app.get(STANDALONE_HOME_SERVICE);
    kitsuneService = app.get(StandaloneKitsuneService);
    mqttService = app.get(MqttService);
    mqttClient = new HausMqttClient({
      host: '127.0.0.1',
      port: mqttService.broker.port,
      allowAnonymous: true,
    });
    await mqttClient.connect();

    const catalogGovee = AppCatalog.createDefaultCatalog().get('govee');
    expect(kitsuneService.homebridgeRuntime.supports(legacyManifest, catalogGovee)).toBe(false);
    const inv = await homeService.listApps('test-admin');
    expect(inv.apps.some((a) => a.source.externalId === 'govee')).toBe(true);

    // Pre-existing legacy Docker govee alone must not suppress govee2mqtt outlets yet
    await mqttClient.publish({
      topic: 'homeassistant/light/gv2mqtt-BBCCDDEE0011/config',
      payload: JSON.stringify({
        unique_id: 'gv2mqtt-BBCCDDEE0011',
        name: null,
        schema: 'json',
        state_topic: 'gv2mqtt/light/gv2mqtt-BBCCDDEE0011/state',
        command_topic: 'gv2mqtt/light/gv2mqtt-BBCCDDEE0011/command',
        device: { identifiers: ['gv2mqtt-BBCCDDEE0011'], name: 'Narnia Bulb', manufacturer: 'Govee', model: 'H6006' },
        origin: { name: 'govee2mqtt' },
      }),
      qos: 1,
      retain: true,
    });
    await waitFor(() => homeService.getDevice('mqtt_gv2mqtt-BBCCDDEE0011'));

    // Install homebridge-govee alongside legacy Docker 'govee'
    const hbEntry = AppCatalog.createDefaultCatalog().get('homebridge-govee');
    expect(hbEntry).toBeDefined();
    await homeService.installApp('test-admin', hbEntry!.manifest, [], {
      pluginPath: pluginDir,
      username: 'owner@example.com',
      password: 'super-secret-govee-password',
      hybridSplit: true,
      outletsOnly: true,
      bleDisable: false,
      awsDisable: false,
      lanDisable: false,
    });

    const hbPlug = await waitFor(() =>
      homeService.listDevices().find((d) => d.source.instanceId === 'homebridge:homebridge-govee' && d.model === 'H5083'),
    );
    expect(hbPlug.category).toBe('power');
    expect(homeService.getDevice('mqtt_gv2mqtt-BBCCDDEE0011')?.source.instanceId).toBe('haus-mqtt');
    expect(
      homeService.listDevices().some((d) => d.source.instanceId === 'homebridge:homebridge-govee' && d.category === 'lighting'),
    ).toBe(false);

    expect((await homeService.operateApp('test-admin', 'homebridge-govee', 'remove')).status).toBe('ok');
  }, 20000);
});
