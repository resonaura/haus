/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultCameraService } from '../../src/camera/camera.service.js';
import { CameraIntegrationService } from '../../src/camera/integration.service.js';
import { StandaloneHomeService } from '../../src/home/home.service.js';

describe('CameraIntegrationService & DefaultCameraService Native Cameras', () => {
  let cameraService: DefaultCameraService;
  let homeService: StandaloneHomeService;
  let integrationService: CameraIntegrationService;

  beforeEach(() => {
    cameraService = new DefaultCameraService();
    homeService = new StandaloneHomeService();
    integrationService = new CameraIntegrationService(cameraService, homeService);
  });

  it('registers all native cameras into cameraService and homeService on bootstrap', async () => {
    // Enable camera discovery for test
    process.env.HAUS_DISCOVER_CAMERAS = 'true';
    try {
      await integrationService.onApplicationBootstrap();

      const cameras = await cameraService.listCameras();
      expect(cameras.length).toBeGreaterThanOrEqual(3);

      const outdoor = cameras.find((c) => c.id === 'camera.outdoor_camera');
      expect(outdoor).toBeDefined();
      expect(outdoor?.name).toBe('Outdoor Camera');
      expect(outdoor?.state).toBe('online');

      const guinea = cameras.find((c) => c.id === 'camera.guinea_pigs_camera');
      expect(guinea).toBeDefined();
      expect(guinea?.name).toBe('Guinea Pigs Camera');

      const narnia = cameras.find((c) => c.id === 'camera.narnia_camera');
      expect(narnia).toBeDefined();
      expect(narnia?.name).toBe('Narnia Camera');

      const devices = homeService.listDevices();
      expect(devices.some((d) => d.id === 'camera.outdoor_camera')).toBe(true);
      expect(devices.some((d) => d.id === 'camera.guinea_pigs_camera')).toBe(true);
      expect(devices.some((d) => d.id === 'camera.narnia_camera')).toBe(true);
    } finally {
      delete process.env.HAUS_DISCOVER_CAMERAS;
      integrationService.onApplicationShutdown();
    }
  });

  it('serves snapshots via snapshotFetch and caches the buffer', async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    let fetchCount = 0;

    cameraService.registerCamera({
      id: 'camera.test',
      name: 'Test Camera',
      enabled: true,
      snapshotFetch: async () => {
        fetchCount++;
        return fakeJpeg;
      },
    });

    const snap1 = await cameraService.getSnapshot('camera.test');
    expect(snap1.mime).toBe('image/jpeg');
    expect(snap1.buffer).toEqual(fakeJpeg);
    expect(fetchCount).toBe(1);

    // If fetch throws on subsequent call, should serve cached snapshot with stale = true
    cameraService.registerCamera({
      id: 'camera.test',
      name: 'Test Camera',
      enabled: true,
      snapshotFetch: async () => {
        throw new Error('fetch_failure');
      },
    });

    const snap2 = await cameraService.getSnapshot('camera.test');
    expect(snap2.buffer).toEqual(fakeJpeg);
    expect(snap2.stale).toBe(true);
  });

  it('updates operating settings and triggers callback', async () => {
    let capturedControl = '';
    let capturedVal = false;

    cameraService.registerCamera({
      id: 'camera.operating_test',
      name: 'Operating Test',
      enabled: true,
      operating: { indicator: true, nightVision: false },
      onOperatingChange: async (control, val) => {
        capturedControl = control;
        capturedVal = val;
      },
    });

    const res = await cameraService.setOperating('camera.operating_test', 'nightVision', 'camera.operating_test', true);
    expect(res.accepted).toBe(true);
    expect(capturedControl).toBe('nightVision');
    expect(capturedVal).toBe(true);

    const list = await cameraService.listCameras();
    const cam = list.find((c) => c.id === 'camera.operating_test');
    expect(cam?.operating?.nightVision).toBe(true);
  });
});
