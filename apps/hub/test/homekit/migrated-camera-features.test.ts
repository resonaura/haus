/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import type { HausDevice, ProtocolCommandTarget } from '@haus/core';
import {
  HAPBridge,
  HAPStandalone,
  HomeKitCategory,
  TalkbackTranscoder,
} from '@haus/homekit';
import { HomeKitPublicationService } from '../../src/homekit/publication.service.js';
import { HomeKitPublicationController } from '../../src/homekit/publication.controller.js';
import type { StandaloneHomeService } from '../../src/home/home.service.js';

describe('Migrated Devices and Camera Features Verification (P18.10.3)', () => {
  const dispatchedCommands: ProtocolCommandTarget[] = [];

  const migratedLight: HausDevice = {
    id: 'zigbee-light-rgb',
    name: 'Living Room Floor Lamp',
    category: 'lighting',
    source: { instanceId: 'zigbee', externalId: '0x00158d0001aabb' },
    connectivity: { protocol: 'zigbee' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-light',
        name: 'Floor Lamp',
        readings: {
          state: { value: 'on', freshness: 'live' },
          brightness: { value: 75, freshness: 'live' },
          color_temp: { value: 370, freshness: 'live' },
        },
        capabilities: [
          { id: 'on_off', kind: 'on_off', readable: true, operations: ['read', 'write'] },
          { id: 'brightness', kind: 'brightness', readable: true, operations: ['read', 'write'] },
          { id: 'color_temp', kind: 'color_temp', readable: true, operations: ['read', 'write'] },
        ],
      },
    ],
  };

  const migratedCover: HausDevice = {
    id: 'cover-bedroom-blind',
    name: 'Master Bedroom Blind',
    category: 'covers',
    source: { instanceId: 'matter', externalId: 'matter-blind-1' },
    connectivity: { protocol: 'matter' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-blind',
        name: 'Window Blind',
        readings: { position: { value: 100, freshness: 'live' } },
        capabilities: [
          { id: 'position', kind: 'cover', readable: true, operations: ['read', 'write'] },
        ],
      },
    ],
  };

  const migratedLock: HausDevice = {
    id: 'lock-front-door',
    name: 'Front Door Deadbolt',
    category: 'security',
    source: { instanceId: 'zigbee', externalId: '0x00158d0002ccdd' },
    connectivity: { protocol: 'zigbee' },
    availability: 'online',
    endpoints: [
      {
        id: 'ep-lock',
        name: 'Deadbolt Mechanism',
        readings: { lock: { value: 'locked', freshness: 'live' } },
        capabilities: [
          { id: 'lock', kind: 'lock', readable: true, operations: ['read', 'write'] },
        ],
      },
    ],
  };

  const optedInCamera: HausDevice = {
    id: 'camera-driveway-g2h',
    name: 'Driveway G2H Pro Camera',
    category: 'security',
    source: { instanceId: 'lan-aqara', externalId: 'cam-driveway-01' },
    connectivity: { protocol: 'local_ip' },
    availability: 'online',
    metadata: { homekit_opt_in: true },
    endpoints: [
      {
        id: 'ep-camera',
        name: 'Camera Feed',
        readings: {},
        capabilities: [
          { id: 'camera', kind: 'camera', readable: true, operations: ['read'] },
          { id: 'motion', kind: 'motion', readable: true, operations: ['read'] },
          { id: 'night_vision', kind: 'night_vision', readable: true, operations: ['read', 'write'] },
          { id: 'indicator_light', kind: 'indicator', readable: true, operations: ['read', 'write'] },
          { id: 'spotlight', kind: 'spotlight', readable: true, operations: ['read', 'write'] },
        ],
      },
    ],
  };

  const unoptedCamera: HausDevice = {
    ...optedInCamera,
    id: 'camera-indoor-private',
    name: 'Indoor Private Camera',
    metadata: { homekit_opt_in: false },
  };

  const deviceMap = new Map<string, HausDevice>([
    [migratedLight.id, migratedLight],
    [migratedCover.id, migratedCover],
    [migratedLock.id, migratedLock],
    [optedInCamera.id, optedInCamera],
    [unoptedCamera.id, unoptedCamera],
  ]);

  const mockHomeService = {
    getDevice: async (id: string) => deviceMap.get(id) ?? undefined,
  } as unknown as StandaloneHomeService;

  it('exercises Apple Home state and command dispatch across multi-accessory bridge', async () => {
    dispatchedCommands.length = 0;
    const bridge = new HAPBridge(
      {
        name: 'Haus Living Bridge',
        pin: '123-45-678',
        setupId: 'HLB1',
        username: '00:11:22:33:AA:BB',
      },
      {
        onCommand: async (cmd) => {
          dispatchedCommands.push(cmd);
          return true;
        },
      },
    );

    // Add migrated devices to bridge
    await bridge.addDevice(migratedLight);
    await bridge.addDevice(migratedCover);
    await bridge.addDevice(migratedLock);
    expect(bridge.getBridgedDevices()).toHaveLength(3);

    // 1. Dispatch Lightbulb write (On, Brightness, ColorTemperature)
    await bridge.handleCharacteristicWrite(migratedLight.id, 'ep-light', 'on_off', true);
    await bridge.handleCharacteristicWrite(migratedLight.id, 'ep-light', 'brightness', 85);
    await bridge.handleCharacteristicWrite(migratedLight.id, 'ep-light', 'color_temp', 320);

    // 2. Dispatch WindowCovering write (TargetPosition)
    await bridge.handleCharacteristicWrite(migratedCover.id, 'ep-blind', 'position', 50);

    // 3. Dispatch LockMechanism write (LockTargetState)
    await bridge.handleCharacteristicWrite(migratedLock.id, 'ep-lock', 'lock', 1);

    expect(dispatchedCommands).toEqual([
      { deviceId: migratedLight.id, endpointId: 'ep-light', capability: 'on_off', value: true },
      { deviceId: migratedLight.id, endpointId: 'ep-light', capability: 'brightness', value: 85 },
      { deviceId: migratedLight.id, endpointId: 'ep-light', capability: 'color_temp', value: 320 },
      { deviceId: migratedCover.id, endpointId: 'ep-blind', capability: 'position', value: 50 },
      { deviceId: migratedLock.id, endpointId: 'ep-lock', capability: 'lock', value: 1 },
    ]);
  });

  it('publishes standalone camera with HKSV streaming profile and Talkback audio transcoding', async () => {
    const standalone = new HAPStandalone();

    // Register standalone camera
    const setupUri = standalone.registerDevice(optedInCamera, {
      pin: '031-45-154',
      setupId: 'DRIV',
      username: '00:11:22:33:CC:01',
      port: 51834,
    });

    expect(setupUri).toMatch(/^X-HM:\/\//);
    expect(standalone.listPublished()).toHaveLength(1);
    expect(standalone.listPublished()[0]?.category).toBe(HomeKitCategory.IP_CAMERA);

    // Start streaming session
    const started = await standalone.start(optedInCamera.id);
    expect(started).toBe(true);
    expect(standalone.isRunning(optedInCamera.id)).toBe(true);

    // Transcode Talkback audio return channel (OPUS / AAC / PCM)
    const transcoder = new TalkbackTranscoder();
    expect(transcoder).toBeDefined();

    // Privacy cutoff: stopping standalone accessory cancels active session immediately
    const stopped = await standalone.stop(optedInCamera.id);
    expect(stopped).toBe(true);
    expect(standalone.isRunning(optedInCamera.id)).toBe(false);
  });

  it('exercises motion/Assist, spotlight, status indicator, and night-vision capabilities', async () => {
    const service = new HomeKitPublicationService(undefined, mockHomeService);
    await service.onApplicationBootstrap();
    const controller = new HomeKitPublicationController(service);

    // Inspect device mapping for opted-in camera
    const { mapping } = await controller.getDeviceMapping(optedInCamera.id);
    expect(mapping.deviceId).toBe(optedInCamera.id);
    expect(mapping.serviceType).toBe('CameraRTPStreamManagement');

    // Mapped standard characteristics include Camera streaming and Motion
    const charNames = mapping.characteristics.map((c) => c.characteristicName);
    expect(charNames).toContain('MotionDetected');

    // Supported spotlight and status/night-vision are identified in diagnostics
    expect(mapping.unsupportedCapabilities).toBeDefined();
    // Non-standard capability extensions are surfaced explicitly
    expect(
      mapping.unsupportedCapabilities.some((c) => c.capabilityId === 'night_vision'),
    ).toBe(true);
    expect(
      mapping.unsupportedCapabilities.some((c) => c.capabilityId === 'indicator_light'),
    ).toBe(true);
    expect(
      mapping.unsupportedCapabilities.some((c) => c.capabilityId === 'spotlight'),
    ).toBe(true);
  });

  it('keeps per-camera native publishing optional and guards household pairing changes', async () => {
    const service = new HomeKitPublicationService(undefined, mockHomeService);
    await service.onApplicationBootstrap();
    const controller = new HomeKitPublicationController(service);

    // 1. Standalone camera publishing is optional: unopted camera is NOT automatically published
    const initialOverview = controller.listAccessories();
    expect(initialOverview.accessories).toHaveLength(1); // Bridge only
    expect(initialOverview.accessories.some((a) => a.id === unoptedCamera.id)).toBe(false);

    // 2. Explicitly publish opted-in camera
    const pubRes = await controller.publishStandaloneCamera(optedInCamera.id, { port: 51836 });
    expect(pubRes.status).toBe('published');

    const updatedOverview = controller.listAccessories();
    expect(updatedOverview.accessories).toHaveLength(2);
    expect(updatedOverview.accessories.some((a) => a.id === optedInCamera.id)).toBe(true);

    // 3. Resetting standalone pairing requires explicit endpoint call and regenerates credentials
    const initialSetup = pubRes.setup;
    const resetRes = await controller.resetStandalone(optedInCamera.id);
    expect(resetRes.status).toBe('reset');
    expect(resetRes.setup.pin).not.toBe(initialSetup?.pin);
    expect(resetRes.setup.setupId).not.toBe(initialSetup?.setupId);
    expect(resetRes.setup.paired).toBe(false);

    // 4. Clean unpublish
    const unpubRes = await controller.unpublishStandalone(optedInCamera.id);
    expect(unpubRes.unpublished).toBe(true);
    expect(controller.listAccessories().accessories).toHaveLength(1);
  });
});
