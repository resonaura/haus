/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not discover or register cameras without explicit integrations', async () => {
    const fetchMock = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', fetchMock);

    await integrationService.onApplicationBootstrap();

    expect(await cameraService.listCameras()).toEqual([]);
    expect(homeService.listDevices()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not infer a Tuya RTSP source from a path or register a fallback camera', async () => {
    vi.stubEnv('HAUS_TUYA_URL', 'http://127.0.0.1:8123/fixture');
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ id: 'fixture-camera', rtspPath: 'live/fixture' }]), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await integrationService.onApplicationBootstrap();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await cameraService.listCameras()).toEqual([]);
    expect(homeService.listDevices()).toEqual([]);
  });

  it('registers only Aqara and Tuya cameras with explicit RTSP sources', async () => {
    vi.stubEnv('HAUS_AQARA_OUTDOOR_RTSP', 'rtsp://fixture.invalid/outdoor');
    vi.stubEnv('HAUS_AQARA_GUINEA_RTSP', 'rtsp://fixture.invalid/guinea');
    vi.stubEnv('HAUS_TUYA_URL', 'http://127.0.0.1:8123/fixture');
    vi.stubEnv('HAUS_TUYA_RTSP_BASE_URL', 'rtsp://fixture.invalid/tuya/');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([{ id: 'fixture-camera', name: 'Fixture Camera', rtspPath: 'live/fixture' }]),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await integrationService.onApplicationBootstrap();

    const cameras = await cameraService.listCameras();
    expect(cameras.map((camera) => camera.id).sort()).toEqual([
      'camera.guinea_pigs_camera',
      'camera.narnia_camera',
      'camera.outdoor_camera',
    ]);
    expect(homeService.listDevices().map((device) => device.id).sort()).toEqual([
      'camera.guinea_pigs_camera',
      'camera.narnia_camera',
      'camera.outdoor_camera',
    ]);
  });

  it('does not synthesize a Tuya camera when explicit bridge discovery fails', async () => {
    vi.stubEnv('HAUS_TUYA_URL', 'http://127.0.0.1:8123/fixture');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('fixture failure'))));

    await integrationService.onApplicationBootstrap();

    expect(await cameraService.listCameras()).toEqual([]);
    expect(homeService.listDevices()).toEqual([]);
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
