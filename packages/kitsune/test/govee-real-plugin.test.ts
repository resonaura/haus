/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  getGoveeOutletChannelCount,
  HOMEBRIDGE_GOVEE_OUTLET_CATALOG_FALLBACK,
  HOMEBRIDGE_GOVEE_PACKAGE,
  HomebridgeChildBridge,
  HomebridgeVirtualApi,
  isHomebridgeGoveeOutletModel,
  loadHomebridgeGoveeOutletCatalog,
  loadHomebridgePlatform,
  parseEffectiveCapNetRaw,
  resetActiveGoveeOutletCatalog,
  resolveHomebridgeBleEnvironment,
  resolveHomebridgePluginEntrypoint,
  resolveSharedNodeModulesPaths,
  type MockAccessory,
  type PlatformConstructor,
} from '../src/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  resetActiveGoveeOutletCatalog();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('Homebridge Govee catalog & BLE environment', () => {
  test('loads outlet models dynamically from installed homebridge-govee constants.js', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hb-govee-catalog-'));
    tempDirs.push(dir);
    const pluginDir = join(dir, 'node_modules', HOMEBRIDGE_GOVEE_PACKAGE);
    await mkdir(join(pluginDir, 'lib', 'utils'), { recursive: true });
    await writeFile(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: HOMEBRIDGE_GOVEE_PACKAGE, version: '11.40.0', type: 'module' }),
    );
    await writeFile(
      join(pluginDir, 'lib', 'utils', 'constants.js'),
      `export default {
        models: {
          switchSingle: ['H5080', 'H5083', 'H5099'],
          switchDouble: ['H5082', 'H5089'],
          switchTriple: ['H5160'],
        }
      };`,
    );

    const catalog = await loadHomebridgeGoveeOutletCatalog({ searchRoots: [dir] });
    expect(catalog.source).toBe('installed-plugin');
    expect(catalog.pluginVersion).toBe('11.40.0');
    expect(isHomebridgeGoveeOutletModel('H5099')).toBe(true);
    expect(isHomebridgeGoveeOutletModel('h5083')).toBe(true);
    expect(isHomebridgeGoveeOutletModel('H615D')).toBe(false);
    expect(getGoveeOutletChannelCount('H5080')).toBe(1);
    expect(getGoveeOutletChannelCount('H5082')).toBe(2);
    expect(getGoveeOutletChannelCount('H5160')).toBe(3);
    expect(getGoveeOutletChannelCount('H6006')).toBe(0);
  });

  test('falls back cleanly to snapshot when plugin is absent', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'hb-empty-catalog-'));
    tempDirs.push(emptyDir);
    const catalog = await loadHomebridgeGoveeOutletCatalog({
      pluginDirectory: emptyDir,
      dataDirectory: emptyDir,
    });
    expect(catalog.source).toBe('fallback-snapshot');
    for (const model of HOMEBRIDGE_GOVEE_OUTLET_CATALOG_FALLBACK.switchSingle) {
      expect(isHomebridgeGoveeOutletModel(model, catalog)).toBe(true);
    }
    expect(isHomebridgeGoveeOutletModel('H6022', catalog)).toBe(false);
  });

  test('detects native OS, Linux raw HCI CAP_NET_RAW, BlueZ D-Bus, and unavailable BLE cleanly', () => {
    expect(parseEffectiveCapNetRaw('CapEff:\t0000000000002000\n')).toBe(true);
    expect(parseEffectiveCapNetRaw('CapEff:\t0000000000000000\n')).toBe(false);

    const mac = resolveHomebridgeBleEnvironment({ platform: 'darwin' });
    expect(mac.mode).toBe('native_os');
    expect(mac.installHciSocketShim).toBe(false);

    const rawHci = resolveHomebridgeBleEnvironment({
      platform: 'linux',
      capEffHex: '0000000000002000',
      hciAdaptersPresent: true,
      hasDbusSocket: false,
      isContainer: false,
      isWsl: false,
      env: {},
    });
    expect(rawHci.mode).toBe('raw_hci');
    expect(rawHci.installHciSocketShim).toBe(false);

    const dbusContainer = resolveHomebridgeBleEnvironment({
      platform: 'linux',
      hasRawHciCap: false,
      hasDbusSocket: true,
      isContainer: true,
      isWsl: false,
      env: {},
    });
    expect(dbusContainer.mode).toBe('dbus');
    expect(dbusContainer.installHciSocketShim).toBe(true);
    expect(dbusContainer.envOverrides).toEqual({ NOBLE_BINDINGS: 'dbus' });

    const wslUnavailable = resolveHomebridgeBleEnvironment({
      platform: 'linux',
      hasRawHciCap: false,
      hasDbusSocket: false,
      isContainer: false,
      isWsl: true,
      env: {},
    });
    expect(wslUnavailable.mode).toBe('unavailable');
    expect(wslUnavailable.reason).toBe('wsl2_no_hci_passthrough');
  });

  test('resolveSharedNodeModulesPaths locates node_modules containing dbus-next', () => {
    const paths = resolveSharedNodeModulesPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((dir) => existsSync(join(dir, 'dbus-next')))).toBe(true);
  });
});

describe('Homebridge HAP compatibility & Govee outlet projection', () => {
  test('supports 2-arg registerPlatform, HAP subclassing, deferred configureAccessory, and multi-outlet actuation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hb-govee-compat-'));
    tempDirs.push(dir);
    const api = new HomebridgeVirtualApi({ storagePath: dir });

    expect(api.serverVersion).toBe('1.8.4');
    expect(api.versionGreaterOrEqual('1.6.0')).toBe(true);
    expect(api.user.persistPath()).toBe(join(dir, 'persist'));
    expect(api.user.cachedAccessoryPath()).toBe(join(dir, 'accessories'));

    // Test HAP characteristic subclass + Eve-like static enums
    const {
      Characteristic,
      Service,
      Categories,
      Formats,
      Perms,
      Units,
      HAPStatus,
      HapStatusError,
    } = api.hap;
    expect(HAPStatus.SERVICE_COMMUNICATION_FAILURE).toBe(-70402);
    expect(new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE)).toBeInstanceOf(Error);

    class CustomPowerChar extends Characteristic {
      static readonly UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52';
      constructor() {
        super('Watts', CustomPowerChar.UUID, {
          format: Formats.UINT16,
          perms: [Perms.PAIRED_READ, Perms.NOTIFY],
          unit: Units.ARC_DEGREE,
        });
      }
    }
    const customChar = new CustomPowerChar();
    expect(customChar.getDefaultValue()).toBe(0);

    const onSetCalls: Array<{ outlet: string; value: unknown }> = [];
    const createdAccessories: MockAccessory[] = [];

    const GoveeMockPlatform: PlatformConstructor = class {
      constructor(
        public readonly log: ((msg: string) => void) & { info?: (m: string) => void },
        _config: Record<string, unknown>,
        private readonly hbApi: HomebridgeVirtualApi,
      ) {
        assert.equal(typeof log.info, 'function');

        hbApi.on('didFinishLaunching', () => {
          // 1. Single Smart Plug H5080 named with "Light Strip"
          const singleAcc = new hbApi.platformAccessory(
            'Light Strip Plug',
            hbApi.hap.uuid.generate('AA:BB:CC:DD:EE:FF:00:01GV'),
            Categories.OUTLET,
          );
          // 2. Dual Smart Plug H5082
          const dualAcc = new hbApi.platformAccessory(
            'TV Stand Dual Plug',
            hbApi.hap.uuid.generate('AA:BB:CC:DD:EE:FF:00:02GV'),
            Categories.OUTLET,
          );

          // Mirror real homebridge-govee order: registerPlatformAccessories BEFORE configureAccessory!
          hbApi.registerPlatformAccessories(HOMEBRIDGE_GOVEE_PACKAGE, 'Govee', [
            singleAcc,
            dualAcc,
          ]);
          this.configureAccessory(singleAcc);
          this.configureAccessory(dualAcc);
        });
      }

      configureAccessory(accessory: MockAccessory): void {
        createdAccessories.push(accessory);
        if (accessory.displayName === 'Light Strip Plug') {
          accessory
            .getService(Service.AccessoryInformation)
            ?.setCharacteristic(Characteristic.Manufacturer, 'Govee')
            .setCharacteristic(Characteristic.Model, 'H5080')
            .setCharacteristic(Characteristic.SerialNumber, 'AA:BB:CC:DD:EE:FF:00:01');

          // Even if a secondary night-light bulb is attached before/alongside Outlet, category stays 'power'
          const nightLight = accessory.addService(Service.Lightbulb, 'Night Light', 'nightlight');
          nightLight.getCharacteristic(Characteristic.On).onSet((val) => {
            onSetCalls.push({ outlet: 'nightlight', value: val });
          });

          const outlet = accessory.addService(Service.Outlet, 'Outlet', 'outlet');
          outlet.addCharacteristic(Characteristic.OutletInUse);
          outlet.getCharacteristic(Characteristic.On).onSet((val) => {
            onSetCalls.push({ outlet: 'single', value: val });
          });
          return;
        }

        accessory
          .getService(Service.AccessoryInformation)
          ?.setCharacteristic(Characteristic.Manufacturer, 'Govee')
          .setCharacteristic(Characteristic.Model, 'H5082')
          .setCharacteristic(Characteristic.SerialNumber, 'AA:BB:CC:DD:EE:FF:00:02');

        const o1 = accessory.addService(Service.Outlet, 'Outlet 1', 'outlet1');
        o1.getCharacteristic(Characteristic.On).onSet((val) => {
          onSetCalls.push({ outlet: 'dual-1', value: val });
        });
        const o2 = accessory.addService(Service.Outlet, 'Outlet 2', 'outlet2');
        o2.getCharacteristic(Characteristic.On).onSet((val) => {
          onSetCalls.push({ outlet: 'dual-2', value: val });
        });
      }
    };

    await loadHomebridgePlatform({
      api,
      pluginName: HOMEBRIDGE_GOVEE_PACKAGE,
      platformName: 'Govee',
      config: { name: 'Govee', platform: 'Govee' },
      pluginModule: (hb) => {
        hb.registerPlatform('Govee', GoveeMockPlatform);
      },
      storagePath: dir,
    });

    const devices = api.getDevices();
    expect(devices).toHaveLength(2);

    const singleDev = devices.find((d) => d.name === 'Light Strip Plug');
    expect(singleDev).toBeDefined();
    expect(singleDev?.category).toBe('power');
    expect(singleDev?.model).toBe('H5080');
    expect(singleDev?.manufacturer).toBe('Govee');
    expect(singleDev?.serialNumber).toBe('AA:BB:CC:DD:EE:FF:00:01');

    // Push passive state update via updateCharacteristic: must NOT invoke onSet!
    createdAccessories[0]?.getService('Outlet')?.updateCharacteristic(Characteristic.On, true);
    expect(onSetCalls).toHaveLength(0);
    const refreshedSingle = api.getDevice(singleDev!.id);
    const outletEp = refreshedSingle?.endpoints.find((ep) => ep.name === 'Outlet');
    expect(outletEp?.readings.on_off?.value).toBe(true);

    // Multi-outlet actuation: targeting Outlet 2 on H5082 must only toggle Outlet 2
    const dualDev = devices.find((d) => d.name === 'TV Stand Dual Plug');
    expect(dualDev?.endpoints).toHaveLength(2);
    const outlet2Ep = dualDev!.endpoints.find((ep) => ep.name === 'Outlet 2');
    expect(outlet2Ep).toBeDefined();

    await api.executeCommand({
      deviceId: dualDev!.id,
      endpointId: outlet2Ep!.id,
      capability: 'on_off',
      value: true,
    });
    expect(onSetCalls).toEqual([{ outlet: 'dual-2', value: true }]);
    await api.flushCache();
  });

  test('HomebridgeChildBridge sets NODE_PATH and resolves directory plugin entrypoints', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hb-entrypoint-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'lib'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ main: 'lib/index.js' }));
    await writeFile(join(dir, 'lib', 'index.js'), 'export default function () {}');

    const resolvedUrl = resolveHomebridgePluginEntrypoint(dir);
    expect(resolvedUrl.startsWith('file://')).toBe(true);
    expect(resolvedUrl.endsWith('/lib/index.js')).toBe(true);

    const bridge = new HomebridgeChildBridge({
      pluginName: HOMEBRIDGE_GOVEE_PACKAGE,
      config: { platform: 'Govee', name: 'Govee' },
      storagePath: join(dir, 'storage'),
      pluginPath: dir,
    });

    const spawnEnv = bridge.buildSpawnEnv({});
    const nodePathParts = (spawnEnv.NODE_PATH ?? '').split(delimiter).filter(Boolean);
    expect(nodePathParts.some((entry) => existsSync(join(entry, 'dbus-next')))).toBe(true);
  });
});
