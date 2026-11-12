/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import type { HausDevice } from '@haus/core';
import {
  auditPublicationGraph,
  evaluatePublicationRoute,
  HAPBridge,
  HAPClient,
  HAPStandalone,
  HomeKitCategory,
  MAX_HAP_BRIDGE_ACCESSORIES,
} from '../src/index.js';

describe('HomeKit Publication Graph & Loop/Duplication Prevention (P18.10.1)', () => {
  const standardLight: HausDevice = {
    id: 'zigbee-light-1',
    name: 'Living Room Ceiling',
    category: 'lighting',
    source: { instanceId: 'zigbee', externalId: '0x00158d0001' },
    connectivity: { protocol: 'zigbee' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-1',
        name: 'Main Light',
        readings: {},
        capabilities: [
          {
            id: 'light',
            kind: 'on_off',
            readable: true,
            operations: ['read', 'write'],
          },
        ],
      },
    ],
  };

  const homekitImportedPlug: HausDevice = {
    id: 'eve-plug-1',
    name: 'Eve Energy Smart Plug',
    category: 'power',
    source: { instanceId: 'homekit-controller', externalId: 'AA:BB:CC:DD:EE:01' },
    connectivity: { protocol: 'homekit' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-power',
        name: 'Power Outlet',
        readings: {},
        capabilities: [
          {
            id: 'switch',
            kind: 'on_off',
            readable: true,
            operations: ['read', 'write'],
          },
        ],
      },
    ],
  };

  const hapIpImportedSensor: HausDevice = {
    id: 'netatmo-sensor-1',
    name: 'Netatmo Weather Sensor',
    category: 'environmental_sensors',
    source: { instanceId: 'homekit', externalId: '11:22:33:44:55:66' },
    connectivity: { protocol: 'homekit' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-temp',
        name: 'Temperature',
        readings: {},
        capabilities: [
          {
            id: 'sensor',
            kind: 'temperature',
            readable: true,
            operations: ['read'],
          },
        ],
      },
    ],
  };

  const nativeAppleHomeDevice: HausDevice = {
    id: 'nanoleaf-bulb-1',
    name: 'Nanoleaf Matter Light',
    category: 'lighting',
    source: { instanceId: 'matter', externalId: 'matter-node-10' },
    connectivity: { protocol: 'matter' },
    availability: 'online',
    metadata: { native_apple_home: true },
    endpoints: [
      {
        id: 'ep-light',
        name: 'Lightbulb',
        readings: {},
        capabilities: [
          {
            id: 'light',
            kind: 'on_off',
            readable: true,
            operations: ['read', 'write'],
          },
        ],
      },
    ],
    relationships: [
      { type: 'companion', targetDeviceId: 'apple-home', metadata: { platform: 'apple_home' } },
    ],
  };

  const homebridgeDevice: HausDevice = {
    id: 'govee-strip-1',
    name: 'Govee RGB Strip',
    category: 'lighting',
    source: { instanceId: 'kitsune:homebridge', externalId: 'HB:01' },
    connectivity: { protocol: 'virtual' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-rgb',
        name: 'RGB Light',
        readings: {},
        capabilities: [
          {
            id: 'light',
            kind: 'on_off',
            readable: true,
            operations: ['read', 'write'],
          },
        ],
      },
    ],
  };

  const cameraDevice: HausDevice = {
    id: 'camera-aqara-g2h',
    name: 'Outdoor G2H Pro Camera',
    category: 'security',
    source: { instanceId: 'aqara-bridge', externalId: 'cam-01' },
    connectivity: { protocol: 'local_ip' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-cam',
        name: 'Camera Stream',
        readings: {},
        capabilities: [
          {
            id: 'camera',
            kind: 'camera',
            readable: true,
            operations: ['read'],
          },
        ],
      },
    ],
  };

  const existingBridge: HausDevice = {
    id: 'philips-hue-bridge',
    name: 'Hue Bridge',
    category: 'network',
    source: { instanceId: 'hue', externalId: 'hue-bridge-1' },
    connectivity: { protocol: 'local_ip' },
    availability: 'online',
    endpoints: [],
    relationships: [{ type: 'bridge', targetDeviceId: 'hue-light-1' }],
  };

  describe('evaluatePublicationRoute', () => {
    it('classifies standard devices as eligible for HAP bridge', () => {
      const evaluation = evaluatePublicationRoute(standardLight);
      expect(evaluation.route).toBe('haus_bridge');
      expect(evaluation.eligibleForBridge).toBe(true);
      expect(evaluation.eligibleForStandalone).toBe(false);
    });

    it('identifies HomeKit controller imports and strictly prohibits re-bridging', () => {
      const evalHomekit = evaluatePublicationRoute(homekitImportedPlug);
      expect(evalHomekit.route).toBe('homekit_controller_import');
      expect(evalHomekit.eligibleForBridge).toBe(false);
      expect(evalHomekit.eligibleForStandalone).toBe(false);
      expect(evalHomekit.reason).toBe('imported_from_homekit_controller');

      const evalHapIp = evaluatePublicationRoute(hapIpImportedSensor);
      expect(evalHapIp.route).toBe('homekit_controller_import');
      expect(evalHapIp.eligibleForBridge).toBe(false);
      expect(evalHapIp.eligibleForStandalone).toBe(false);
    });

    it('identifies existing native Apple Home devices and avoids duplicate publication', () => {
      const evaluation = evaluatePublicationRoute(nativeAppleHomeDevice);
      expect(evaluation.route).toBe('native_apple_home');
      expect(evaluation.eligibleForBridge).toBe(false);
      expect(evaluation.eligibleForStandalone).toBe(false);
      expect(evaluation.reason).toBe('already_native_apple_home');

      // Evaluates against explicit native set
      const evalWithSet = evaluatePublicationRoute(standardLight, {
        nativeAppleHomeIds: new Set(['zigbee-light-1']),
      });
      expect(evalWithSet.route).toBe('native_apple_home');
      expect(evalWithSet.eligibleForBridge).toBe(false);
    });

    it('classifies Homebridge plugins as virtualized accessories', () => {
      const evaluation = evaluatePublicationRoute(homebridgeDevice);
      expect(evaluation.route).toBe('homebridge_virtualized');
      expect(evaluation.eligibleForBridge).toBe(true);
      expect(evaluation.eligibleForStandalone).toBe(false);
    });

    it('routes cameras to standalone HKSV accessories instead of bridge', () => {
      const evaluation = evaluatePublicationRoute(cameraDevice);
      expect(evaluation.route).toBe('haus_standalone');
      expect(evaluation.eligibleForBridge).toBe(false);
      expect(evaluation.eligibleForStandalone).toBe(true);
      expect(evaluation.reason).toBe('high_capability_standalone_accessory');
    });

    it('excludes devices that are already bridges', () => {
      const evaluation = evaluatePublicationRoute(existingBridge);
      expect(evaluation.route).toBe('excluded');
      expect(evaluation.eligibleForBridge).toBe(false);
      expect(evaluation.eligibleForStandalone).toBe(false);
      expect(evaluation.reason).toBe('cannot_bridge_existing_bridge');
    });
  });

  describe('auditPublicationGraph', () => {
    it('approves a clean publication graph with valid routes', () => {
      const devices = [standardLight, homebridgeDevice, cameraDevice];
      const published = {
        bridgeDeviceIds: new Set([standardLight.id, homebridgeDevice.id]),
        standaloneDeviceIds: new Set([cameraDevice.id]),
      };

      const audit = auditPublicationGraph(devices, published);
      expect(audit.valid).toBe(true);
      expect(audit.violations).toHaveLength(0);
      expect(audit.bridgeCount).toBe(2);
      expect(audit.standaloneCount).toBe(1);
    });

    it('detects and flags reimport loops when HomeKit imports are bridged', () => {
      const devices = [standardLight, homekitImportedPlug];
      const published = {
        bridgeDeviceIds: new Set([standardLight.id, homekitImportedPlug.id]),
        standaloneDeviceIds: new Set<string>(),
      };

      const audit = auditPublicationGraph(devices, published);
      expect(audit.valid).toBe(false);
      const reimportViolation = audit.violations.find((v) => v.type === 'reimport_loop');
      expect(reimportViolation).toBeDefined();
      expect(reimportViolation?.deviceId).toBe('eve-plug-1');
    });

    it('detects duplicate route collisions when an accessory is both bridged and standalone', () => {
      const devices = [standardLight];
      const published = {
        bridgeDeviceIds: new Set([standardLight.id]),
        standaloneDeviceIds: new Set([standardLight.id]),
      };

      const audit = auditPublicationGraph(devices, published);
      expect(audit.valid).toBe(false);
      const dupViolation = audit.violations.find((v) => v.type === 'duplicate_route');
      expect(dupViolation).toBeDefined();
      expect(dupViolation?.deviceId).toBe('zigbee-light-1');
    });

    it('detects native Apple Home collisions', () => {
      const devices = [nativeAppleHomeDevice];
      const published = {
        bridgeDeviceIds: new Set([nativeAppleHomeDevice.id]),
        standaloneDeviceIds: new Set<string>(),
      };

      const audit = auditPublicationGraph(devices, published);
      expect(audit.valid).toBe(false);
      const collision = audit.violations.find((v) => v.type === 'native_collision');
      expect(collision).toBeDefined();
      expect(collision?.deviceId).toBe('nanoleaf-bulb-1');
    });

    it('detects bridge capacity violations when exceeding 149 accessories', () => {
      const deviceIds = new Set<string>();
      const devices: HausDevice[] = [];
      for (let i = 0; i <= MAX_HAP_BRIDGE_ACCESSORIES; i++) {
        const id = `dev-${i}`;
        deviceIds.add(id);
        devices.push({
          ...standardLight,
          id,
          name: `Light ${i}`,
        });
      }

      const audit = auditPublicationGraph(devices, {
        bridgeDeviceIds: deviceIds,
        standaloneDeviceIds: new Set(),
      });
      expect(audit.valid).toBe(false);
      const capViolation = audit.violations.find((v) => v.type === 'bridge_capacity_exceeded');
      expect(capViolation).toBeDefined();
    });
  });

  describe('HAPBridge Invariant Enforcement', () => {
    it('refuses to bridge accessories imported from HomeKit controller', async () => {
      const bridge = new HAPBridge({
        name: 'Haus Main Bridge',
        pin: '123-45-678',
        setupId: 'HAU1',
        username: '00:11:22:33:44:55',
      });

      await expect(bridge.addDevice(homekitImportedPlug)).rejects.toThrow(
        /Cannot bridge an accessory imported from HomeKit controller/,
      );

      await expect(bridge.addDevice(hapIpImportedSensor)).rejects.toThrow(
        /Cannot bridge an accessory imported from HomeKit controller/,
      );
    });

    it('refuses to bridge accessories already native to Apple Home', async () => {
      const bridge = new HAPBridge({
        name: 'Haus Main Bridge',
        pin: '123-45-678',
        setupId: 'HAU1',
        username: '00:11:22:33:44:55',
      });

      await expect(bridge.addDevice(nativeAppleHomeDevice)).rejects.toThrow(
        /Cannot bridge an accessory already native to Apple Home/,
      );
    });

    it('refuses to bridge accessories that are already bridges', async () => {
      const bridge = new HAPBridge({
        name: 'Haus Main Bridge',
        pin: '123-45-678',
        setupId: 'HAU1',
        username: '00:11:22:33:44:55',
      });

      await expect(bridge.addDevice(existingBridge)).rejects.toThrow(
        /Cannot bridge an accessory that is already a bridge/,
      );
    });

    it('successfully bridges eligible devices', async () => {
      const bridge = new HAPBridge({
        name: 'Haus Main Bridge',
        pin: '123-45-678',
        setupId: 'HAU1',
        username: '00:11:22:33:44:55',
      });

      const summary = await bridge.addDevice(standardLight);
      expect(summary.id).toBe('zigbee-light-1');
      expect(summary.category).toBe(HomeKitCategory.LIGHTBULB);
      expect(bridge.getBridgedDevices()).toHaveLength(1);
    });
  });

  describe('HAPStandalone Invariant Enforcement', () => {
    it('refuses to publish HomeKit controller imports or native Apple Home devices', () => {
      const standalone = new HAPStandalone();

      expect(() =>
        standalone.registerDevice(homekitImportedPlug, {
          pin: '123-45-678',
          setupId: 'CAM1',
          username: '00:11:22:33:44:01',
        }),
      ).toThrow(/Cannot publish an accessory imported from HomeKit controller/);

      expect(() =>
        standalone.registerDevice(nativeAppleHomeDevice, {
          pin: '123-45-678',
          setupId: 'CAM2',
          username: '00:11:22:33:44:02',
        }),
      ).toThrow(/Cannot publish an accessory already native to Apple Home/);
    });

    it('successfully registers standalone camera accessories and generates setup URI', () => {
      const standalone = new HAPStandalone();
      const setupUri = standalone.registerDevice(cameraDevice, {
        pin: '031-45-154',
        setupId: 'HAUS',
        username: '00:11:22:33:44:99',
      });

      expect(setupUri).toMatch(/^X-HM:\/\//);
      expect(standalone.listPublished()).toHaveLength(1);
      expect(standalone.listPublished()[0]?.name).toBe('Outdoor G2H Pro Camera');
      expect(standalone.listPublished()[0]?.category).toBe(HomeKitCategory.IP_CAMERA);
    });
  });

  describe('HAPClient Self-Discovery Loop Suppression', () => {
    it('suppresses registered bridge and standalone accessory IDs from discovery results', () => {
      const client = new HAPClient();
      const hausBridgeId = '00:11:22:33:44:55';
      const externalAccessoryId = 'AA:BB:CC:DD:EE:FF';

      client.suppressAccessoryId(hausBridgeId);
      expect(client.isSuppressed(hausBridgeId)).toBe(true);
      expect(client.isSuppressed(externalAccessoryId)).toBe(false);

      // Attempt to register discovered items
      client.registerDiscovered({
        id: hausBridgeId,
        name: 'Haus Main Bridge',
        address: '192.168.1.10',
        port: 51827,
        category: HomeKitCategory.BRIDGE,
        paired: false,
        configNumber: 1,
      });

      client.registerDiscovered({
        id: externalAccessoryId,
        name: 'External HomeKit Light',
        address: '192.168.1.50',
        port: 51826,
        category: HomeKitCategory.LIGHTBULB,
        paired: false,
        configNumber: 1,
      });

      const discovered = client.getDiscovered();
      expect(discovered).toHaveLength(1);
      expect(discovered[0]?.id).toBe(externalAccessoryId);
      expect(discovered.some((d) => d.id === hausBridgeId)).toBe(false);
    });
  });
});
