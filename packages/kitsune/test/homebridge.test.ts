/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import {
  generateHapUuid,
  HAP_NAMESPACE,
  HomebridgeAccessoryCache,
  loadHomebridgePlatform,
  HomebridgeVirtualApi,
  MockAccessory,
  HAPServices,
  HAPCharacteristics,
  type PlatformConstructor,
} from '../src/index.js';

test('generateHapUuid creates deterministic RFC 4122 v5 UUIDs from HAP namespace', () => {
  const uuid1 = generateHapUuid('govee-device-1');
  const uuid2 = generateHapUuid('govee-device-1');
  const uuid3 = generateHapUuid('govee-device-2');

  assert.equal(uuid1, uuid2);
  assert.notEqual(uuid1, uuid3);
  assert.match(uuid1, /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  assert.equal(HAP_NAMESPACE, '00000000-0000-1000-8000-0026BB765291');
});

test('MockCharacteristic supports onGet, onSet, and setProps', async () => {
  const char = new HAPCharacteristics.Brightness();
  char.setProps({ minValue: 0, maxValue: 100, minStep: 1 });
  assert.equal(char.props?.minValue, 0);
  assert.equal(char.props?.maxValue, 100);

  let currentBrightness = 40;
  char.onGet(() => currentBrightness);
  assert.equal(char.getValue(), 40);

  let setCalls: number[] = [];
  char.onSet(async (val) => {
    currentBrightness = Number(val);
    setCalls.push(currentBrightness);
  });

  char.setValue(85);
  assert.equal(currentBrightness, 85);
  assert.deepEqual(setCalls, [85]);
  assert.equal(char.getValue(), 85);
});

test('MockService and MockAccessory support category, getServiceById, and removal', () => {
  const acc = new MockAccessory('Living Room Lamp', 'uuid-lamp-1', 5);
  assert.equal(acc.category, 5);

  const light = new HAPServices.Lightbulb('Ceiling Light', 'sub-1');
  acc.addService(light);

  assert.equal(acc.getServiceById(HAPServices.Lightbulb.UUID, 'sub-1'), light);
  assert.equal(acc.getServiceById(HAPServices.Lightbulb.UUID, 'non-existent'), undefined);

  light.updateCharacteristic(HAPCharacteristics.On, true);
  assert.equal(light.getCharacteristic(HAPCharacteristics.On).getValue(), true);

  acc.removeService(light);
  assert.equal(acc.getService(HAPServices.Lightbulb.UUID), undefined);
});

test('HomebridgeAccessoryCache serializes, saves, loads, and deletes accessories durably', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hb-cache-test-'));
  try {
    const acc = new MockAccessory('Bedroom RGB', 'uuid-rgb-1', 5);
    acc.context = { deviceId: '6A:CC:D0:C9:07:04:B7:A8', model: 'H6008' };
    const service = acc.addService(new HAPServices.Lightbulb('RGB Strip'));
    service.getCharacteristic(HAPCharacteristics.On).setValue(true);
    service.getCharacteristic(HAPCharacteristics.Brightness).setValue(70);
    service
      .getCharacteristic(HAPCharacteristics.Brightness)
      .setProps({ minValue: 1, maxValue: 100 });

    await HomebridgeAccessoryCache.save(dir, '@homebridge-plugins/homebridge-govee', 'Govee', [
      acc,
    ]);

    const restored = await HomebridgeAccessoryCache.load(
      dir,
      '@homebridge-plugins/homebridge-govee',
    );
    assert.equal(restored.length, 1);
    const first = restored[0]!;
    assert.equal(first.displayName, 'Bedroom RGB');
    assert.equal(first.UUID, 'uuid-rgb-1');
    assert.equal(first.category, 5);
    assert.deepEqual(first.context, { deviceId: '6A:CC:D0:C9:07:04:B7:A8', model: 'H6008' });

    const restoredService = first.getService(HAPServices.Lightbulb.UUID);
    assert.ok(restoredService);
    assert.equal(restoredService.getCharacteristic(HAPCharacteristics.On).getValue(), true);
    assert.equal(restoredService.getCharacteristic(HAPCharacteristics.Brightness).getValue(), 70);
    assert.equal(
      restoredService.getCharacteristic(HAPCharacteristics.Brightness).props?.minValue,
      1,
    );

    await HomebridgeAccessoryCache.remove(dir, 'uuid-rgb-1');
    const empty = await HomebridgeAccessoryCache.load(dir, '@homebridge-plugins/homebridge-govee');
    assert.equal(empty.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadHomebridgePlatform executes real dynamic platform lifecycle with cache and didFinishLaunching', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hb-loader-test-'));
  let api: HomebridgeVirtualApi | undefined;
  try {
    api = new HomebridgeVirtualApi({ storagePath: dir });
    assert.equal(api.version, '2.0.0');
    assert.equal(api.user.storagePath(), dir);
    assert.equal(api.user.configPath(), join(dir, 'config.json'));

    // Pre-populate durable cache with an accessory
    const cachedAcc = new MockAccessory('Cached Govee Bulb', generateHapUuid('device-cached-1'), 5);
    cachedAcc.context = { deviceId: 'device-cached-1', model: 'H6003' };
    const cachedService = cachedAcc.addService(new HAPServices.Lightbulb('Main Light'));
    cachedService.getCharacteristic(HAPCharacteristics.On).setValue(true);
    await HomebridgeAccessoryCache.save(dir, '@homebridge-plugins/homebridge-govee', 'Govee', [
      cachedAcc,
    ]);

    let configuredCached = 0;
    let launched = false;
    let discoveredCount = 0;

    const MockGoveePlatform: PlatformConstructor = class {
      accessoriesList: MockAccessory[] = [];
      constructor(
        public log: (msg: string) => void,
        public config: Record<string, unknown>,
        public apiRef: HomebridgeVirtualApi,
      ) {
        apiRef.on('didFinishLaunching', () => {
          launched = true;
          // Dynamically discover a new accessory
          const newAcc = new apiRef.platformAccessory(
            'New Govee Strip',
            apiRef.hap.uuid.generate('device-new-2'),
            5,
          );
          newAcc.context = { deviceId: 'device-new-2', model: 'H6159' };
          const s = newAcc.addService(new apiRef.hap.Service.Lightbulb('Strip'));
          s.getCharacteristic(apiRef.hap.Characteristic.On).setValue(false);
          s.getCharacteristic(apiRef.hap.Characteristic.Brightness).setValue(50);

          apiRef.registerPlatformAccessories('@homebridge-plugins/homebridge-govee', 'Govee', [
            newAcc,
          ]);
        });
      }

      configureAccessory(accessory: MockAccessory): void {
        configuredCached += 1;
        this.accessoriesList.push(accessory);
      }
    };

    api.on('deviceDiscovered', () => {
      discoveredCount += 1;
    });

    const pluginModule = (apiRef: HomebridgeVirtualApi) => {
      apiRef.registerPlatform('@homebridge-plugins/homebridge-govee', 'Govee', MockGoveePlatform);
    };

    const platform = await loadHomebridgePlatform({
      api,
      pluginName: '@homebridge-plugins/homebridge-govee',
      platformName: 'Govee',
      config: {
        name: 'Govee',
        platform: 'Govee',
        username: 'test@example.com',
        password: 'secret-password',
      },
      pluginModule,
      storagePath: dir,
    });

    assert.ok(platform);
    assert.equal(configuredCached, 1);
    assert.equal(launched, true);

    const devices = api.getDevices();
    assert.equal(devices.length, 2);

    const cachedDevice = devices.find((d) => d.name === 'Cached Govee Bulb');
    assert.ok(cachedDevice);
    assert.equal(cachedDevice.endpoints[0]?.readings.on_off?.value, true);

    const newDevice = devices.find((d) => d.name === 'New Govee Strip');
    assert.ok(newDevice);
    assert.equal(newDevice.endpoints[0]?.readings.on_off?.value, false);
    assert.equal(newDevice.endpoints[0]?.readings.brightness?.value, 50);

    // Command execution
    const handled = api.executeCommand(newDevice.id, newDevice.endpoints[0]!.id, 'on_off', true);
    assert.equal(handled, true);
    const updatedDevice = api.getDevice(newDevice.id);
    assert.equal(updatedDevice?.endpoints[0]?.readings.on_off?.value, true);
  } finally {
    await api?.flushCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Lightbulb accessory projects ColorTemperature and ColorHSV/RGB and handles bidirectional commands', () => {
  const api = new HomebridgeVirtualApi();
  const acc = new MockAccessory('Govee RGBWW Bulb', generateHapUuid('bulb-rgbww-1'), 5);
  const service = acc.addService(new HAPServices.Lightbulb('Light'));

  let currentOn = false;
  let currentBri = 80;
  let currentCt = 300; // 300 Mireds (~3333K)
  let currentHue = 210;
  let currentSat = 75;

  service
    .getCharacteristic(HAPCharacteristics.On)
    .setValue(currentOn)
    .onSet((val) => {
      currentOn = Boolean(val);
    });
  service
    .getCharacteristic(HAPCharacteristics.Brightness)
    .setValue(currentBri)
    .onSet((val) => {
      currentBri = Number(val);
    });
  service
    .getCharacteristic(HAPCharacteristics.ColorTemperature)
    .setValue(currentCt)
    .onSet((val) => {
      currentCt = Number(val);
    });
  service
    .getCharacteristic(HAPCharacteristics.Hue)
    .setValue(currentHue)
    .onSet((val) => {
      currentHue = Number(val);
    });
  service
    .getCharacteristic(HAPCharacteristics.Saturation)
    .setValue(currentSat)
    .onSet((val) => {
      currentSat = Number(val);
    });

  const device = api.ingestAccessory('@homebridge-plugins/homebridge-govee', acc);
  assert.equal(device.category, 'lighting');
  const ep = device.endpoints[0]!;
  assert.ok(ep);

  // Check capability kinds
  const capKinds = ep.capabilities.map((c) => c.kind);
  assert.ok(capKinds.includes('on_off'));
  assert.ok(capKinds.includes('brightness'));
  assert.ok(capKinds.includes('color_temp'));
  assert.ok(capKinds.includes('color_hsv'));

  // Check initial readings
  assert.equal(ep.readings.on_off?.value, false);
  assert.equal(ep.readings.brightness?.value, 80);
  assert.equal(ep.readings.color_temp_mireds?.value, 300);
  assert.equal(ep.readings.color_temp?.value, 3333); // 1,000,000 / 300
  assert.deepEqual(ep.readings.color_hsv?.value, { hue: 210, saturation: 75, value: 80 });

  // Execute color_temp command in Kelvin (e.g. 4000K -> 250 Mireds)
  api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'color_temp',
    value: 4000,
  });
  assert.equal(currentCt, 250);

  // Execute color command via RGB
  api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'color',
    value: { r: 255, g: 0, b: 0 },
  });
  assert.equal(currentHue, 0);
  assert.equal(currentSat, 100);

  // Execute color_hsv command
  api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'color_hsv',
    value: { hue: 120, saturation: 90 },
  });
  assert.equal(currentHue, 120);
  assert.equal(currentSat, 90);
});

test('HomebridgeChildBridge does not fabricate PINs and emits real pairing cards when configured', async () => {
  const { HomebridgeChildBridge } = await import('../src/index.js');

  // Case 1: No pin configured -> no pairing card emitted
  const unconfiguredBridge = new HomebridgeChildBridge({
    pluginName: '@homebridge-plugins/homebridge-govee',
    config: { name: 'Govee', platform: 'Govee' },
    memoryMb: 64,
  });

  const cards: unknown[] = [];
  unconfiguredBridge.on('pairingCard', (card) => cards.push(card));

  try {
    await unconfiguredBridge.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(cards.length, 0, 'Must not fabricate PINs when none is configured');
  } finally {
    await unconfiguredBridge.stop();
  }

  // Case 2: Explicit real pin configured -> emits exact pairing card
  const configuredBridge = new HomebridgeChildBridge({
    pluginName: '@homebridge-plugins/homebridge-govee',
    config: {
      name: 'Govee',
      platform: 'Govee',
      _bridge: { pin: '776-41-434' },
    },
    memoryMb: 64,
  });

  const configuredCards: Array<{ pin: string; setupUri?: string }> = [];
  configuredBridge.on('pairingCard', (card) => configuredCards.push(card));

  try {
    await configuredBridge.start();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const completeCard = configuredCards.find((c) => c.pin === '776-41-434' && Boolean(c.setupUri));
    assert.ok(completeCard);
    assert.equal(completeCard.pin, '776-41-434');
    assert.ok(completeCard.setupUri?.startsWith('X-HM://'));
  } finally {
    await configuredBridge.stop();
  }
});
