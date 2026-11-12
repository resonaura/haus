/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import type { HausDevice } from '@haus/core';
import { HomeKitCategory } from '@haus/homekit';
import { HomeKitPublicationService } from '../../src/homekit/publication.service.js';
import { HomeKitPublicationController } from '../../src/homekit/publication.controller.js';
import type { StandaloneHomeService } from '../../src/home/home.service.js';

describe('Hub HomeKit Publication & Pairing Management (P18.10.2)', () => {
  const lightDevice: HausDevice = {
    id: 'zigbee-light-10',
    name: 'Dining Room Chandelier',
    category: 'lighting',
    source: { instanceId: 'zigbee', externalId: '0x1234' },
    connectivity: { protocol: 'zigbee' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-light',
        name: 'Chandelier',
        readings: {},
        capabilities: [
          { id: 'on_off', kind: 'on_off', readable: true, operations: ['read', 'write'] },
          { id: 'brightness', kind: 'brightness', readable: true, operations: ['read', 'write'] },
          { id: 'custom_preset', kind: 'vendor_extension', readable: true, operations: ['read'] },
        ],
      },
    ],
  };

  const cameraDevice: HausDevice = {
    id: 'cam-garden-1',
    name: 'Garden Camera G2H',
    category: 'security',
    source: { instanceId: 'lan-aqara', externalId: 'cam-01' },
    connectivity: { protocol: 'local_ip' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-cam',
        name: 'Garden Feed',
        readings: {},
        capabilities: [
          { id: 'camera', kind: 'camera', readable: true, operations: ['read'] },
          { id: 'motion', kind: 'motion', readable: true, operations: ['read'] },
        ],
      },
    ],
  };

  const importedDevice: HausDevice = {
    id: 'eve-plug-imported',
    name: 'Eve Energy Imported',
    category: 'power',
    source: { instanceId: 'homekit-controller', externalId: 'AA:11' },
    connectivity: { protocol: 'homekit' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-pwr',
        name: 'Outlet',
        readings: {},
        capabilities: [
          { id: 'on_off', kind: 'on_off', readable: true, operations: ['read', 'write'] },
        ],
      },
    ],
  };

  const deviceMap = new Map<string, HausDevice>([
    [lightDevice.id, lightDevice],
    [cameraDevice.id, cameraDevice],
    [importedDevice.id, importedDevice],
  ]);

  const mockHomeService = {
    getDevice: async (id: string) => deviceMap.get(id) ?? undefined,
  } as unknown as StandaloneHomeService;

  it('manages bridge status, device bridging, and publication graph auditing', async () => {
    const service = new HomeKitPublicationService(undefined, mockHomeService);
    await service.onApplicationBootstrap();
    const controller = new HomeKitPublicationController(service);

    // 1. Initial bridge setup data
    const initial = controller.getBridge();
    expect(initial.bridge.id).toBe('haus-bridge');
    expect(initial.bridge.pin).toBe('031-45-154');
    expect(initial.bridge.setupId).toBe('HAUS');
    expect(initial.bridge.setupUri).toMatch(/^X-HM:\/\//);
    expect(initial.bridge.paired).toBe(false);
    expect(initial.devices).toHaveLength(0);

    // 2. Add eligible device to bridge
    const addRes = await controller.addBridgeDevice({ deviceId: lightDevice.id });
    expect(addRes.status).toBe('bridged');
    expect(addRes.summary.id).toBe('zigbee-light-10');
    expect(addRes.summary.category).toBe(HomeKitCategory.LIGHTBULB);

    const afterAdd = controller.getBridge();
    expect(afterAdd.devices).toHaveLength(1);

    // 3. Reject bridging imported devices (reimport loop prevention)
    let caughtError: unknown;
    try {
      await controller.addBridgeDevice({ deviceId: importedDevice.id });
    } catch (err: unknown) {
      caughtError = err;
    }
    expect(caughtError).toBeDefined();
    const badReq = caughtError as { getResponse?: () => { error?: string } };
    expect(badReq.getResponse?.().error).toMatch(
      /Cannot bridge an accessory imported from HomeKit controller/,
    );

    // 4. Batch selection with publication graph audit
    const selectRes = await controller.selectBridgeDevices({
      deviceIds: [lightDevice.id],
    });
    expect(selectRes.report.valid).toBe(true);
    expect(selectRes.devices).toHaveLength(1);

    // 5. Remove device from bridge
    const removeRes = await controller.removeBridgeDevice(lightDevice.id);
    expect(removeRes.removed).toBe(true);
    expect(controller.getBridge().devices).toHaveLength(0);
  });

  it('surfaces mapped characteristics and unsupported extensions in diagnostics', async () => {
    const service = new HomeKitPublicationService(undefined, mockHomeService);
    await service.onApplicationBootstrap();
    const controller = new HomeKitPublicationController(service);

    const { mapping } = await controller.getDeviceMapping(lightDevice.id);
    expect(mapping.deviceId).toBe(lightDevice.id);
    expect(mapping.serviceType).toBe('Lightbulb');
    expect(mapping.characteristics.map((c) => c.characteristicName)).toEqual(['On', 'Brightness']);

    // Crucial requirement: surfaces unsupported capability rather than pretending it is HAP characteristic
    expect(mapping.unsupportedCapabilities).toHaveLength(1);
    expect(mapping.unsupportedCapabilities[0]).toEqual({
      capabilityId: 'custom_preset',
      capabilityKind: 'vendor_extension',
      name: undefined,
      reason: 'no_standard_hap_characteristic_equivalent',
    });
    expect(mapping.isFullySupported).toBe(false);
  });

  it('publishes standalone camera accessories and lists published overview', async () => {
    const service = new HomeKitPublicationService(undefined, mockHomeService);
    await service.onApplicationBootstrap();
    const controller = new HomeKitPublicationController(service);

    // Publish standalone camera
    const pubRes = await controller.publishStandaloneCamera(cameraDevice.id, { port: 51833 });
    expect(pubRes.status).toBe('published');
    expect(pubRes.identity.id).toBe(cameraDevice.id);
    expect(pubRes.identity.category).toBe(HomeKitCategory.IP_CAMERA);
    expect(pubRes.setup?.setupUri).toMatch(/^X-HM:\/\//);

    // Overview includes bridge and standalone camera
    const overview = controller.listAccessories();
    expect(overview.accessories).toHaveLength(2);
    expect(overview.accessories.find((a) => a.kind === 'bridge')).toBeDefined();
    expect(overview.accessories.find((a) => a.id === cameraDevice.id)).toBeDefined();

    // Standalone pairing reset
    const resetRes = await controller.resetStandalone(cameraDevice.id);
    expect(resetRes.status).toBe('reset');
    expect(resetRes.setup.paired).toBe(false);

    // Standalone controller reauthorization
    const reauthRes = await controller.reauthorizeStandalone(cameraDevice.id, {
      allowedControllerIds: [],
    });
    expect(reauthRes.status).toBe('reauthorized');
    expect(reauthRes.identity.pairedControllers).toHaveLength(0);

    // Unpublish standalone accessory
    const unpubRes = await controller.unpublishStandalone(cameraDevice.id);
    expect(unpubRes.unpublished).toBe(true);
    expect(controller.listAccessories().accessories).toHaveLength(1);
  });

  it('resets bridge pairing and reauthorizes controllers', async () => {
    const service = new HomeKitPublicationService(undefined, mockHomeService);
    await service.onApplicationBootstrap();
    const controller = new HomeKitPublicationController(service);
    await controller.addBridgeDevice({ deviceId: lightDevice.id });

    // Execute pairing reset
    const resetRes = await controller.resetBridge();
    expect(resetRes.status).toBe('reset');
    expect(resetRes.bridge.paired).toBe(false);
    expect(resetRes.bridge.controllerCount).toBe(0);
    expect(resetRes.bridge.setupUri).toMatch(/^X-HM:\/\//);

    // Bridged accessories are preserved across pairing reset
    expect(controller.getBridge().devices).toHaveLength(1);

    // Reauthorize controllers
    const reauthRes = await controller.reauthorizeBridge({
      allowedControllerIds: [],
    });
    expect(reauthRes.status).toBe('reauthorized');
    expect(reauthRes.bridge.pairedControllers).toHaveLength(0);
  });
});
