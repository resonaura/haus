/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import type { HausDevice } from '@haus/core';
import {
  HomeKitCategory,
  HomeKitPublicationManager,
  mapDeviceToHap,
  type HomeKitBridgeIdentity,
  type HomeKitPublicationStorage,
  type HomeKitStandaloneIdentity,
} from '../src/index.js';

class InMemoryPublicationStorage implements HomeKitPublicationStorage {
  private bridge: HomeKitBridgeIdentity | null = null;
  private readonly standalone = new Map<string, HomeKitStandaloneIdentity>();

  async getBridgeIdentity(_id?: string): Promise<HomeKitBridgeIdentity | null> {
    return this.bridge;
  }

  async saveBridgeIdentity(identity: HomeKitBridgeIdentity): Promise<void> {
    this.bridge = identity;
  }

  async getStandaloneIdentity(id: string): Promise<HomeKitStandaloneIdentity | null> {
    return this.standalone.get(id) ?? null;
  }

  async listStandaloneIdentities(): Promise<readonly HomeKitStandaloneIdentity[]> {
    return Array.from(this.standalone.values());
  }

  async saveStandaloneIdentity(identity: HomeKitStandaloneIdentity): Promise<void> {
    this.standalone.set(identity.id, identity);
  }

  async deleteStandaloneIdentity(id: string): Promise<void> {
    this.standalone.delete(id);
  }
}

describe('HomeKit Publishing & Pairing Logic (P18.10.2)', () => {
  const lightDevice: HausDevice = {
    id: 'light-1',
    name: 'Living Room Pendant',
    category: 'lighting',
    source: { instanceId: 'zigbee', externalId: '0x001' },
    connectivity: { protocol: 'zigbee' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-1',
        name: 'Pendant Light',
        readings: {},
        capabilities: [
          { id: 'on_off', kind: 'on_off', readable: true, operations: ['read', 'write'] },
          { id: 'brightness', kind: 'brightness', readable: true, operations: ['read', 'write'] },
          { id: 'color_temp', kind: 'color_temp', readable: true, operations: ['read', 'write'] },
          { id: 'effect_list', kind: 'custom_effects', readable: true, operations: ['read'] },
          {
            id: 'linkquality',
            kind: 'signal',
            readable: true,
            operations: ['read'],
            entityCategory: 'diagnostic',
          },
        ],
      },
    ],
  };

  const thermostatDevice: HausDevice = {
    id: 'thermostat-1',
    name: 'Main Floor Thermostat',
    category: 'climate',
    source: { instanceId: 'mqtt', externalId: 'tstat-01' },
    connectivity: { protocol: 'mqtt' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-tstat',
        name: 'Thermostat Control',
        readings: {},
        capabilities: [
          { id: 'temperature', kind: 'temperature', readable: true, operations: ['read'] },
          {
            id: 'target_temperature',
            kind: 'target_temperature',
            readable: true,
            operations: ['read', 'write'],
          },
        ],
      },
    ],
  };

  const cameraDevice: HausDevice = {
    id: 'camera-front-porch',
    name: 'Front Porch G2H Pro',
    category: 'security',
    source: { instanceId: 'aqara-lan', externalId: 'cam-02' },
    connectivity: { protocol: 'local_ip' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-cam',
        name: 'Camera Feed',
        readings: {},
        capabilities: [
          { id: 'camera', kind: 'camera', readable: true, operations: ['read'] },
          { id: 'motion', kind: 'motion', readable: true, operations: ['read'] },
        ],
      },
    ],
  };

  const importedDevice: HausDevice = {
    id: 'imported-plug-1',
    name: 'Eve Energy Plug',
    category: 'power',
    source: { instanceId: 'homekit-controller', externalId: 'AA:01' },
    connectivity: { protocol: 'homekit' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-pwr',
        name: 'Switch',
        readings: {},
        capabilities: [
          { id: 'on_off', kind: 'on_off', readable: true, operations: ['read', 'write'] },
        ],
      },
    ],
  };

  describe('mapDeviceToHap', () => {
    it('maps lighting capabilities to standard HAP characteristics and surfaces unsupported extensions', () => {
      const mapping = mapDeviceToHap(lightDevice);

      expect(mapping.serviceType).toBe('Lightbulb');
      expect(mapping.characteristics.map((c) => c.characteristicName)).toEqual([
        'On',
        'Brightness',
        'ColorTemperature',
      ]);

      // Crucial requirement: surfaces unsupported capabilities rather than fabricating non-standard characteristics
      expect(mapping.unsupportedCapabilities).toHaveLength(2);
      expect(mapping.unsupportedCapabilities[0]).toEqual({
        capabilityId: 'effect_list',
        capabilityKind: 'custom_effects',
        name: undefined,
        reason: 'no_standard_hap_characteristic_equivalent',
      });
      expect(mapping.unsupportedCapabilities[1]).toEqual({
        capabilityId: 'linkquality',
        capabilityKind: 'signal',
        name: undefined,
        reason: 'internal_diagnostic_not_in_hap_spec',
      });
      expect(mapping.isFullySupported).toBe(false);
    });

    it('maps climate devices to Thermostat service with temperature characteristics', () => {
      const mapping = mapDeviceToHap(thermostatDevice);

      expect(mapping.serviceType).toBe('Thermostat');
      expect(mapping.characteristics.map((c) => c.characteristicName)).toEqual([
        'CurrentTemperature',
        'TargetTemperature',
      ]);
      expect(mapping.unsupportedCapabilities).toHaveLength(0);
      expect(mapping.isFullySupported).toBe(true);
    });
  });

  describe('HomeKitPublicationManager', () => {
    it('initializes default bridge identity and restores it from storage', async () => {
      const storage = new InMemoryPublicationStorage();
      const manager = new HomeKitPublicationManager({ storage });
      await manager.initialize();

      const bridgeSetup = manager.getBridgeSetupData();
      expect(bridgeSetup.id).toBe('haus-bridge');
      expect(bridgeSetup.setupUri).toMatch(/^X-HM:\/\//);
      expect(bridgeSetup.pin).toBe('031-45-154');
      expect(bridgeSetup.setupId).toBe('HAUS');
      expect(bridgeSetup.paired).toBe(false);
      expect(bridgeSetup.controllerCount).toBe(0);

      // Verify persistent storage was populated
      const stored = await storage.getBridgeIdentity('haus-bridge');
      expect(stored?.pin).toBe('031-45-154');
    });

    it('manages adding, selecting, and removing bridge accessories with capacity and loop guards', async () => {
      const storage = new InMemoryPublicationStorage();
      const manager = new HomeKitPublicationManager({ storage });
      await manager.initialize();

      // Add eligible light
      const summary = await manager.addDeviceToBridge(lightDevice);
      expect(summary.id).toBe('light-1');
      expect(summary.category).toBe(HomeKitCategory.LIGHTBULB);
      expect(manager.getBridgedDevices()).toHaveLength(1);

      // Attempt to add HomeKit controller import -> throws rejection
      await expect(manager.addDeviceToBridge(importedDevice)).rejects.toThrow(
        /Cannot bridge an accessory imported from HomeKit controller/,
      );

      // Remove device
      const removed = await manager.removeDeviceFromBridge('light-1');
      expect(removed).toBe(true);
      expect(manager.getBridgedDevices()).toHaveLength(0);
    });

    it('audits and selects batch device collections for the bridge', async () => {
      const storage = new InMemoryPublicationStorage();
      const manager = new HomeKitPublicationManager({ storage });
      await manager.initialize();

      // Clean selection
      const report = await manager.selectBridgeDevices([lightDevice, thermostatDevice]);
      expect(report.valid).toBe(true);
      expect(manager.getBridgedDevices()).toHaveLength(2);

      // Selection containing loop violation is rejected
      const invalidReport = await manager.selectBridgeDevices([lightDevice, importedDevice]);
      expect(invalidReport.valid).toBe(false);
      expect(invalidReport.violations.some((v) => v.type === 'reimport_loop')).toBe(true);
    });

    it('publishes standalone cameras and generates unique setup credentials', async () => {
      const storage = new InMemoryPublicationStorage();
      const manager = new HomeKitPublicationManager({ storage });
      await manager.initialize();

      const identity = await manager.publishStandaloneCamera(cameraDevice, 51835);
      expect(identity.id).toBe('camera-front-porch');
      expect(identity.category).toBe(HomeKitCategory.IP_CAMERA);
      expect(identity.port).toBe(51835);
      expect(identity.username).toMatch(/^00:11:22:33:44:/);

      const setupData = manager.getStandaloneSetupData('camera-front-porch');
      expect(setupData).toBeDefined();
      expect(setupData?.setupUri).toMatch(/^X-HM:\/\//);
      expect(setupData?.paired).toBe(false);

      // Standalone identities are persisted
      const stored = await storage.getStandaloneIdentity('camera-front-porch');
      expect(stored?.id).toBe('camera-front-porch');

      // Overview list contains both bridge and standalone
      const overview = manager.listPublishedAccessories();
      expect(overview).toHaveLength(2);
      expect(overview.find((o) => o.kind === 'bridge')).toBeDefined();
      expect(overview.find((o) => o.kind === 'standalone')).toBeDefined();
    });

    it('resets bridge pairing, cycling PIN and setupId and clearing paired controllers', async () => {
      const storage = new InMemoryPublicationStorage();
      const manager = new HomeKitPublicationManager({ storage });
      await manager.initialize();
      await manager.addDeviceToBridge(lightDevice);

      // Simulate an active pairing by saving a controller
      const initial = await storage.getBridgeIdentity();
      expect(initial).toBeDefined();
      await storage.saveBridgeIdentity({
        ...initial!,
        pairedControllers: [{ id: 'ctrl-1', publicKey: 'aabbcc', permissions: 1 }],
      });
      await manager.initialize();
      expect(manager.getBridgeSetupData().paired).toBe(true);
      expect(manager.getBridgeSetupData().controllerCount).toBe(1);

      // Execute pairing reset
      const resetData = await manager.resetBridgePairing();
      expect(resetData.paired).toBe(false);
      expect(resetData.controllerCount).toBe(0);
      expect(resetData.pin).not.toBe(initial?.pin);
      expect(resetData.setupId).not.toBe(initial?.setupId);
      expect(resetData.setupUri).toMatch(/^X-HM:\/\//);

      // Verify devices are still bridged after reset
      expect(manager.getBridgedDevices()).toHaveLength(1);
    });

    it('reauthorizes paired controllers and revokes unauthorized pairings', async () => {
      const storage = new InMemoryPublicationStorage();
      const manager = new HomeKitPublicationManager({ storage });
      await manager.initialize();

      // Seed 2 paired controllers
      const initial = await storage.getBridgeIdentity();
      await storage.saveBridgeIdentity({
        ...initial!,
        pairedControllers: [
          { id: 'controller-ios-1', publicKey: 'pk1', permissions: 1 },
          { id: 'controller-stale-2', publicKey: 'pk2', permissions: 0 },
        ],
      });
      await manager.initialize();
      expect(manager.getBridgeSetupData().controllerCount).toBe(2);

      // Revoke stale controller, retaining only controller-ios-1
      const reauthorized = await manager.reauthorizeBridge(['controller-ios-1']);
      expect(reauthorized.pairedControllers).toHaveLength(1);
      expect(reauthorized.pairedControllers[0]?.id).toBe('controller-ios-1');
      expect(manager.getBridgeSetupData().controllerCount).toBe(1);
    });
  });
});
