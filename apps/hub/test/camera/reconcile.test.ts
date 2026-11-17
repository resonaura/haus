/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultCameraService } from '../../src/camera/camera.service.js';
import { CameraIntegrationService } from '../../src/camera/integration.service.js';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { openTestRecordingStore } from '../support/recording.js';

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

  it('persists compound recording and talkback settings together', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-camera-settings-'));
    const store = await openTestRecordingStore(join(dir, 'recording.sqlite'), dir);
    const camera = 'camera.settings';
    const service = new DefaultCameraService(store);
    service.registerCamera({ id: camera, name: 'Camera', enabled: true });
    try {
      await store.setCamera(camera, { homekit: { enabled: false } });
      await Promise.all([
        service.updateCamera(camera, { motionDetection: { enabled: false, mode: 'motion' }, sensorIds: ['detector'] }),
        service.updateCamera(camera, { talkback: { url: 'rtmp://127.0.0.1/talk' }, sensors: ['motion'] }),
      ]);
      expect((await store.overrides())[camera]).toMatchObject({
        homekit: { enabled: false },
        motionDetection: { enabled: false, mode: 'motion' },
        sensorIds: ['detector'],
        sensors: ['motion'],
        talkback: { url: 'rtmp://127.0.0.1/talk' },
      });
      await expect(service.updateCamera(camera, {
        motionDetection: { enabled: true, mode: 'motion' }, sensorIds: [33],
      })).rejects.toThrow('invalid_detectors');
      expect((await store.overrides())[camera]).toMatchObject({ motionDetection: { enabled: false } });
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(['serials', 'objects'] as const)('routes Eufy PTZ and motion from %s discovery', async (format) => {
    const bridge = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    const serial = 'T8410C0000000001';
    const anotherSerial = 'T8410C0000000002';
    const cameraId = 'camera.outdoor_side_camera';
    let socket: WebSocket | undefined;
    const commands: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve) => bridge.once('listening', resolve));
    bridge.on('connection', (connection) => {
      socket = connection;
      socket.send(JSON.stringify({ type: 'version', minSchemaVersion: 13, maxSchemaVersion: 21 }));
      socket.on('message', (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        commands.push(message);
        const command = message.command;
        const result = command === 'start_listening'
          ? { state: { devices: format === 'serials' ? [serial, anotherSerial]
            : [serial, anotherSerial].map((serialNumber) => ({ serialNumber, name: 'Fixture' })) } }
          : command === 'device.get_properties'
            ? { serialNumber: message.serialNumber, properties: {
              name: 'Fixture', model: 'T8410C', rtspStreamUrl: 'rtsp://127.0.0.1/live', statusLed: false,
            } }
            : command === 'device.has_command'
              ? { exists: message.serialNumber === serial }
              : {};
        connection.send(JSON.stringify({ type: 'result', messageId: message.messageId, success: true, result }));
      });
    });
    const address = bridge.address();
    if (!address || typeof address === 'string') throw Error('fixture socket unavailable');
    vi.stubEnv('HAUS_EUFY_WS_URL', `ws://127.0.0.1:${address.port}`);
    vi.stubEnv('HAUS_EUFY_LEGACY_SERIAL', serial);
    const sensor = vi.spyOn(cameraService, 'setMotionSensor');
    try {
      await integrationService.onApplicationBootstrap();
      await vi.waitFor(() => expect(homeService.getDevice(cameraId)?.endpoints.length).toBe(5));
      expect(homeService.getDevice(cameraId)).toMatchObject({ name: 'Fixture', model: 'T8410C' });
      expect(homeService.getDevice(cameraId)?.category).toBe('cameras');
      const ptz = homeService.getDevice(cameraId)?.endpoints.find(({ name }) => name === 'Pan left');
      if (!ptz) throw Error('missing PTZ endpoint');
      await homeService.executeDeviceCommand(ptz.id, 'press', 'press');
      expect(commands).toContainEqual(expect.objectContaining({
        command: 'device.pan_and_tilt', serialNumber: serial, direction: 1,
      }));

      const event = (serialNumber: string, state: boolean) => socket?.send(JSON.stringify({
        type: 'event', event: { source: 'device', event: 'motion detected', serialNumber, state },
      }));
      event('T8410C0000000003', true);
      event(serial, true);
      event(serial, true);
      event(serial, false);
      await vi.waitFor(() => expect(sensor.mock.calls).toEqual([
        [cameraId, { id: 'eufy:motion', kind: 'motion', active: true }],
        [cameraId, { id: 'eufy:motion', kind: 'motion', active: false }],
      ]));

      socket?.send(JSON.stringify({ type: 'event', event: {
        source: 'device', event: 'property changed', serialNumber: serial, name: 'statusLed', value: true,
      } }));
      await vi.waitFor(async () => expect((await cameraService.listCameras()).find(({ id }) => id === cameraId)?.operating?.indicator).toBe(true));
      expect(commands.some(({ command }) => command === 'device.set_property')).toBe(false);

      socket?.terminate();
      await vi.waitFor(async () => {
        expect(homeService.getDevice(cameraId)?.availability).toBe('offline');
        expect((await cameraService.listCameras()).find(({ id }) => id === cameraId)?.state).toBe(
          'offline',
        );
      });
    } finally {
      integrationService.onApplicationShutdown();
      await new Promise<void>((resolve) => bridge.close(() => resolve()));
    }
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
