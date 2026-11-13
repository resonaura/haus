/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DefaultCameraService } from '../../src/camera/camera.service.js';
import { CameraIntegrationService } from '../../src/camera/integration.service.js';
import { StandaloneHomeService } from '../../src/home/home.service.js';

describe('CameraIntegrationService persisted reconciliation & mediaId', () => {
  let cameraService: DefaultCameraService;
  let homeService: StandaloneHomeService;
  let integrationService: CameraIntegrationService;

  beforeEach(() => {
    cameraService = new DefaultCameraService();
    homeService = new StandaloneHomeService();
    integrationService = new CameraIntegrationService(cameraService, homeService);
    vi.stubEnv('HAUS_DISCOVER_CAMERAS', 'true');
    vi.stubEnv('HAUS_AQARA_OUTDOOR_RTSP', '');
    vi.stubEnv('HAUS_AQARA_GUINEA_RTSP', '');
    vi.stubEnv('HAUS_TUYA_URL', '');
    vi.stubEnv('HAUS_TUYA_RTSP_BASE_URL', '');
    vi.stubEnv('HAUS_EUFY_WS_URL', '');
  });

  afterEach(() => {
    integrationService.onApplicationShutdown();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sets endpoint mediaId, preserves assigned roomId, removes unconfigured ghost cameras, and marks pending configured cameras offline', async () => {
    homeService.registerDevice({
      id: 'camera.outdoor_camera',
      source: { instanceId: 'haus-cameras', externalId: 'camera.outdoor_camera' },
      name: 'Outdoor Camera',
      category: 'security',
      roomId: 'outdoor',
      connectivity: { protocol: 'local_ip' },
      availability: 'online',
      manufacturer: 'Aqara',
      model: 'Camera G2H Pro',
      endpoints: [
        {
          id: 'ep_camera.outdoor_camera',
          name: 'Outdoor Camera',
          capabilities: [{ id: 'video', kind: 'custom', readable: true, operations: ['stream'] }],
          readings: {},
        },
      ],
    });
    homeService.registerDevice({
      id: 'camera.narnia_camera',
      source: { instanceId: 'haus-cameras', externalId: 'camera.narnia_camera' },
      name: 'Narnia Camera',
      category: 'security',
      roomId: 'unassigned',
      connectivity: { protocol: 'local_ip' },
      availability: 'online',
      manufacturer: 'Tuya',
      model: 'hepu0fueo4rmwfac',
      endpoints: [
        {
          id: 'ep_camera.narnia_camera',
          name: 'Narnia Camera',
          capabilities: [{ id: 'video', kind: 'custom', readable: true, operations: ['stream'] }],
          readings: {},
        },
      ],
    });
    homeService.registerDevice({
      id: 'camera.outdoor_side_camera',
      source: { instanceId: 'haus-cameras', externalId: 'camera.outdoor_side_camera' },
      name: 'Outdoor Side Camera',
      category: 'security',
      roomId: 'outdoor',
      connectivity: { protocol: 'local_ip' },
      availability: 'online',
      manufacturer: 'Eufy Security',
      model: 'T8410C',
      endpoints: [
        {
          id: 'ep_camera.outdoor_side_camera',
          name: 'Outdoor Side Camera',
          capabilities: [{ id: 'video', kind: 'custom', readable: true, operations: ['stream'] }],
          readings: {},
        },
      ],
    });

    vi.stubEnv('HAUS_AQARA_OUTDOOR_RTSP', 'rtsp://fixture.invalid/outdoor');
    vi.stubEnv('HAUS_EUFY_WS_URL', 'ws://127.0.0.1:65500/eufy');

    await integrationService.onApplicationBootstrap();

    const outdoor = homeService.getDevice('camera.outdoor_camera');
    expect(outdoor?.roomId).toBe('outdoor');
    expect(outdoor?.availability).toBe('online');
    expect(outdoor?.endpoints[0]?.mediaId).toBe('camera.outdoor_camera');

    expect(homeService.getDevice('camera.narnia_camera')).toBeUndefined();

    const side = homeService.getDevice('camera.outdoor_side_camera');
    expect(side?.availability).toBe('offline');
    expect(side?.endpoints[0]?.mediaId).toBe('camera.outdoor_side_camera');
  });
});
