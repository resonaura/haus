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

  it('reports an unavailable snapshot instead of returning a fabricated image', async () => {
    cameraService.registerCamera({
      id: 'camera.no-source',
      name: 'Camera without a source',
      enabled: true,
    });

    await expect(cameraService.getSnapshot('camera.no-source')).rejects.toThrow(
      'snapshot_unavailable',
    );
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

  it('delegates to CameraSnapshots and propagates snapshot_busy', async () => {
    const mockSnapshots = {
      snapshot: vi.fn(async () => {
        throw new Error('snapshot_busy');
      }),
    };
    const svc = new DefaultCameraService(
      undefined,
      undefined,
      undefined,
      mockSnapshots as unknown as import('../../src/camera/control/snapshots.js').CameraSnapshots,
    );
    svc.registerCamera({ id: 'camera.busy', name: 'Busy Camera', enabled: true });

    await expect(svc.getSnapshot('camera.busy')).rejects.toThrow('snapshot_busy');
    expect(mockSnapshots.snapshot).toHaveBeenCalled();
  });

  it('delegates to talkback and sanitizes talkback credentials in updateCamera', async () => {
    let streamed = false;
    const mockTalkback = {
      stream: vi.fn(async () => {
        streamed = true;
      }),
      available: vi.fn(async () => true),
      stopAll: vi.fn(),
    };
    const svc = new DefaultCameraService(
      undefined,
      undefined,
      undefined,
      undefined,
      mockTalkback as unknown as import('../../src/camera/control/talkback.js').Talkback,
    );
    svc.registerCamera({ id: 'camera.talk', name: 'Talk Camera', enabled: true });

    const req = { headers: { 'x-haus-client': '1', 'content-type': 'audio/webm' } } as unknown as import('node:http').IncomingMessage;
    const res = {} as unknown as import('node:http').ServerResponse;
    await svc.talkbackStream('camera.talk', req, res);
    expect(streamed).toBe(true);

    const updated = await svc.updateCamera('camera.talk', {
      talkback: { url: 'rtmp://192.168.1.10:1935/talk/secret' },
    });
    expect(updated.talkbackConfigured).toBe(true);
    expect(JSON.stringify(updated).includes('secret')).toBe(false);
  });

  it('delegates HomeKit pairing, reset and settings to HomeKitCameras and marks backups changed', async () => {
    let pairingCalled = false;
    let manageCalledWith = '';
    let tickCalled = false;
    let backupMarked = false;

    const mockHomekit = {
      pairing: vi.fn(async (id: string) => {
        pairingCalled = true;
        return { id, paired: false, uri: `X-HM://000${id}` };
      }),
      managePairing: vi.fn(async (id: string, action: string) => {
        manageCalledWith = action;
        return { id, action, paired: false };
      }),
      status: vi.fn((id: string) => ({ id, enabled: true, paired: false })),
      tick: vi.fn(async () => {
        tickCalled = true;
      }),
    };
    const mockBackups = {
      markChanged: vi.fn(() => {
        backupMarked = true;
      }),
    };

    const svc = new DefaultCameraService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockHomekit as unknown as import('../../src/homekit/cameras.js').HomeKitCameras,
      mockBackups as unknown as import('../../src/backup/backups.js').Backups,
    );
    svc.registerCamera({ id: 'camera.hk', name: 'HomeKit Camera', enabled: true });

    const pair = await svc.getHomeKitPairing('camera.hk');
    expect(pairingCalled).toBe(true);
    expect((pair as { uri: string }).uri).toBe('X-HM://000camera.hk');

    await svc.manageHomeKitPairing('camera.hk', 'reset');
    expect(manageCalledWith).toBe('reset');
    expect(backupMarked).toBe(true);

    const updated = await svc.updateHomeKitSettings('camera.hk', { enabled: true, processor: 'auto' });
    expect(tickCalled).toBe(true);
    expect((updated as { enabled: boolean }).enabled).toBe(true);

    const list = await svc.listCameras();
    const cam = list.find((c) => c.id === 'camera.hk');
    expect(cam?.homekit).toEqual({ id: 'camera.hk', enabled: true, paired: false });
  });

  it('delegates viewerOffer and closeViewer to NvrCameraSessions', async () => {
    let viewerCalled = false;
    let closeCalled = false;
    const mockSessions = {
      camera: vi.fn((id: string) => ({ id, enabled: true, available: true })),
      viewer: vi.fn(async (camera, owner, viewerId, offer) => {
        viewerCalled = true;
        return {
          answer: { type: 'answer', sdp: `sdp-answer-${viewerId}-${offer}` },
          candidates: [{ candidate: 'cand-loopback' }],
        };
      }),
      closeViewer: vi.fn(async (_cameraId, _owner, _viewerId) => {
        closeCalled = true;
        return { closed: true };
      }),
    };

    const svc = new DefaultCameraService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockSessions as unknown as import('../../src/camera/sessions/sessions.js').NvrCameraSessions,
    );

    const result = (await svc.viewerOffer(
      'camera.live',
      'owner-session-1234',
      '26c1f67d-9ce3-4099-8f1a-42c6826be001',
      'v=0\r\no=-\r\n',
    )) as { answer: { type: string; sdp: string }; candidates: unknown[] };

    expect(viewerCalled).toBe(true);
    expect(result.answer.type).toBe('answer');
    expect(result.answer.sdp).toContain('sdp-answer-26c1f67d');
    expect(result.candidates).toEqual([{ candidate: 'cand-loopback' }]);

    const closed = (await svc.closeViewer(
      'camera.live',
      'owner-session-1234',
      '26c1f67d-9ce3-4099-8f1a-42c6826be001',
    )) as { closed: boolean };
    expect(closeCalled).toBe(true);
    expect(closed.closed).toBe(true);
  });

  it('delegates touchWarm to WarmStreams', async () => {
    let warmTouched = false;
    const mockWarm = {
      touch: vi.fn(async (_camera, owner, active, preview) => {
        warmTouched = true;
        return { warm: active, owner, preview, expiresAt: 123456789 };
      }),
    };

    const svc = new DefaultCameraService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockWarm as unknown as import('../../src/camera/control/warm.js').WarmStreams,
    );
    svc.registerCamera({ id: 'camera.warm', name: 'Warm Camera', enabled: true });

    const touched = (await svc.touchWarm('camera.warm', 'subscriber-1', true, false)) as {
      active: boolean;
      warm: boolean;
      expiresAt: number;
    };
    expect(warmTouched).toBe(true);
    expect(touched.active).toBe(true);
    expect(touched.warm).toBe(true);
    expect(touched.expiresAt).toBe(123456789);
  });

  it('delegates manual recording trigger to Recorder and handles native camera lookup', async () => {
    let triggerCalled = false;
    const mockRecorder = {
      trigger: vi.fn(async (id: string) => {
        triggerCalled = true;
        return { id: `event-${id}`, cameraId: id, startAt: 1000 };
      }),
    };
    const mockNative = {
      cameras: vi.fn(() => [
        {
          id: 'camera.native_recorder',
          name: 'Native Camera',
          available: true,
          nativeProvider: { bridgeId: 'b1' },
          nativeSource: { kind: 'rtsp' as const, url: 'rtsp://127.0.0.1/live' },
        },
      ]),
    };

    const svc = new DefaultCameraService(
      undefined,
      mockRecorder as unknown as import('../../src/events/recorder/recorder.js').Recorder,
      mockNative as unknown as import('../../src/camera/control/runtime.js').NativeCameraRuntime,
    );

    const recording = (await svc.triggerRecording('camera.native_recorder')) as {
      started: boolean;
      jobId: string;
      cameraId: string;
    };
    expect(triggerCalled).toBe(true);
    expect(recording).toEqual({
      id: 'event-camera.native_recorder',
      startAt: 1000,
      started: true,
      jobId: 'event-camera.native_recorder',
      cameraId: 'camera.native_recorder',
    });

    await expect(svc.triggerRecording('camera.unknown')).rejects.toThrow('camera_not_found');

    const svcNoRecorder = new DefaultCameraService(
      undefined,
      undefined,
      mockNative as unknown as import('../../src/camera/control/runtime.js').NativeCameraRuntime,
    );
    await expect(svcNoRecorder.triggerRecording('camera.native_recorder')).rejects.toThrow(
      'recording_worker_unavailable',
    );
  });

  it('publishes IntegratedCameraSources with kitsuneSource and forwards Eufy motion to Recorder', async () => {
    const { IntegratedCameraSources } = await import('../../src/camera/control/integrated.js');
    const { WebSocketServer } = await import('ws');

    const integrated = new IntegratedCameraSources();
    const svc = new DefaultCameraService(
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, integrated,
    );
    const triggers: Array<{ cameraId: string; kind: string; sensorId?: string }> = [];
    const mockRecorder = {
      trigger: vi.fn(async (cameraId: string, kind: string, sensorId?: string) => {
        triggers.push({ cameraId, kind, sensorId });
        return { id: `evt-${cameraId}`, cameraId, startAt: Date.now() };
      }),
    };
    const integration = new CameraIntegrationService(
      svc,
      homeService,
      mockRecorder as unknown as import('../../src/events/recorder/recorder.js').Recorder,
    );

    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
    const address = wss.address() as { port: number };
    wss.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { command?: string; messageId?: string };
        if (msg.command === 'start_listening') {
          socket.send(
            JSON.stringify({
              type: 'result',
              messageId: msg.messageId,
              result: { state: { devices: [{ name: 'Side Yard', model: 'T8113', serialNumber: 'E8113-TEST' }] } },
            }),
          );
        } else if (msg.command === 'device.get_properties') {
          socket.send(
            JSON.stringify({
              type: 'result',
              messageId: msg.messageId,
              result: { properties: { name: 'Side Yard', model: 'T8113', rtspStreamUrl: 'rtsp://127.0.0.1:8554/eufy-side' } },
            }),
          );
          socket.send(JSON.stringify({ type: 'event', event: { name: 'motionDetected', value: true } }));
        }
      });
    });

    try {
      vi.stubEnv('HAUS_EUFY_WS_URL', `ws://127.0.0.1:${address.port}`);
      await integration.onApplicationBootstrap();
      await vi.waitFor(() => expect(triggers.length).toBe(1));

      expect(triggers[0]).toEqual({
        cameraId: 'camera.outdoor_side_camera',
        kind: 'motion',
        sensorId: 'eufy:motion',
      });
      const recCameras = integrated.recordingCameras();
      expect(recCameras).toEqual([
        expect.objectContaining({
          id: 'camera.outdoor_side_camera',
          enabled: true,
          available: true,
          independentSource: true,
          kitsuneSource: { url: 'rtsp://127.0.0.1:8554/eufy-side', kind: 'rtsp' },
          sensors: [{ id: 'eufy:motion', kind: 'motion', active: true }],
        }),
      ]);
      const ep = homeService.getEndpointState('ep_camera.outdoor_side_camera');
      expect(ep).toMatchObject({ motion: true, state: 'detected' });
    } finally {
      integration.onApplicationShutdown();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  });
});
