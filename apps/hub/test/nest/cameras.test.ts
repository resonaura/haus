/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createNestApp } from '../../src/nest.js';
import { CAMERA_SERVICE } from '../../src/camera/tokens.js';
import type { CameraService, CameraSnapshot, CameraSummary } from '../../src/camera/types.js';
import { LIVE_SERVICE } from '../../src/live/tokens.js';
import type { LiveService } from '../../src/live/types.js';

describe('NestJS Cameras & Live WebSocket Gateway Integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let wsUrl: string;
  let liveService: LiveService;

  const mockCameras: CameraSummary[] = [
    {
      id: 'camera.porch',
      name: 'Porch Camera',
      state: 'idle',
      motionStatus: { motion: false },
      activity: { recording: false },
      homekit: { enabled: true },
      operating: { indicator: true, nightVision: true },
      talkAvailable: true,
    },
  ];

  const mockSnapshotBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  const mockCameraService: CameraService = {
    async listCameras() {
      return mockCameras;
    },
    async listDetectors() {
      return [{ id: 'binary_sensor.porch_pir', name: 'Porch PIR', kind: 'motion' }];
    },
    async bootstrapAccess(cameraId: string, clientId: string) {
      if (cameraId !== 'camera.porch') throw new Error('camera_not_found');
      return { token: `access-${cameraId}-${clientId}`, expiresAt: Date.now() + 3600000 };
    },
    async getSnapshot(cameraId: string): Promise<CameraSnapshot> {
      if (cameraId !== 'camera.porch') throw new Error('camera_not_found');
      return {
        mime: 'image/jpeg',
        buffer: mockSnapshotBuffer,
        at: 1700000000000,
        stale: false,
      };
    },
    async updateCamera(cameraId: string, update: Record<string, unknown>): Promise<CameraSummary> {
      if (cameraId !== 'camera.porch') throw new Error('camera_not_found');
      return { ...mockCameras[0], ...update };
    },
    async setOperating(
      cameraId: string,
      control: 'indicator' | 'nightVision',
      entityId: string,
      value: boolean,
    ) {
      if (cameraId !== 'camera.porch') throw new Error('camera_not_found');
      if (!entityId) throw new Error('invalid_camera_control');
      return { accepted: value };
    },
    async setSpotlight(cameraId: string, entityId: string) {
      if (cameraId !== 'camera.porch') throw new Error('camera_not_found');
      if (!entityId) throw new Error('invalid_spotlight_command');
      return { accepted: true };
    },
    async viewerOffer(cameraId: string, owner: string, viewerId: string) {
      if (cameraId === 'camera.nvr_required') throw new Error('camera_nvr_required');
      return { sdp: `answer-${cameraId}-${owner}-${viewerId}` };
    },
    async closeViewer(_cameraId: string, _owner: string, _viewerId: string) {
      return { closed: true };
    },
    async touchWarm(cameraId: string, owner: string, active: boolean) {
      return { cameraId, owner, active, expiresAt: Date.now() + 60000 };
    },
    async triggerRecording(cameraId: string) {
      return { started: true, jobId: `job-${cameraId}` };
    },
    async getHomeKitPairing(cameraId: string) {
      return { id: cameraId, paired: false, uri: 'X-HM://000' };
    },
    async manageHomeKitPairing(cameraId: string, action: 'close' | 'reset') {
      return { id: cameraId, action, success: true };
    },
    async updateHomeKitSettings(cameraId: string, settings: unknown) {
      return { id: cameraId, settings, status: 'ok' };
    },
    async talkbackStream(cameraId: string, req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
      if (cameraId !== 'camera.porch') throw new Error('camera_not_found');
      if (
        req.headers['x-haus-client'] !== '1' ||
        !String(req.headers['content-type']).startsWith('audio/webm')
      ) {
        throw new Error('invalid_audio');
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end('talkback-stream-received');
    },
  };

  const authToken = 'test-camera-token';
  const authHeaders = { Authorization: `Bearer ${authToken}` };
  const jsonAuthHeaders = {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };

  beforeAll(async () => {
    app = await createNestApp({ apiToken: authToken });
    const cameraHolder = app.get<{ cameraService: CameraService }>(
      CAMERA_SERVICE as unknown as string,
      { strict: false },
    );
    if (cameraHolder) {
      Object.assign(cameraHolder, mockCameraService);
    }
    // Also re-bind CAMERA_SERVICE mock dynamically in module
    const foundCameraService = app.get<CameraService>(CAMERA_SERVICE);
    Object.assign(foundCameraService, mockCameraService);

    liveService = app.get<LiveService>(LIVE_SERVICE);
    if (
      'configure' in liveService &&
      typeof (liveService as unknown as { configure: (o: unknown) => void }).configure ===
        'function'
    ) {
      (liveService as unknown as { configure: (o: unknown) => void }).configure({
        heartbeatMs: 60000,
      });
    }

    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/api/live`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Live WebSocket Gateway (/api/live)', () => {
    it('rejects connection if X-Haus-Client header is missing', async () => {
      const socket = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      await expect(
        new Promise((_, reject) => {
          socket.on('error', reject);
          socket.on('open', () => reject(new Error('Should not have opened')));
        }),
      ).rejects.toThrow();
      socket.terminate();
    });

    it('rejects connection if authorization token is invalid or prototype fixture', async () => {
      for (const badHeader of ['Bearer wrong-token', 'Bearer fixture']) {
        const socket = new WebSocket(wsUrl, {
          headers: { Authorization: badHeader, 'X-Haus-Client': '1' },
        });
        await expect(
          new Promise((_, reject) => {
            socket.on('error', reject);
            socket.on('open', () => reject(new Error('Should not have opened')));
          }),
        ).rejects.toThrow();
        socket.terminate();
      }
    });

    it('successfully connects with valid token and receives initial home state', async () => {
      const socket = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Haus-Client': '1' },
      });
      const [, message] = await Promise.all([once(socket, 'open'), once(socket, 'message')]);
      const data = JSON.parse(String(message[0]));
      expect(data.protocol).toBe(1);
      expect(data.topic).toBe('home');
      expect(data.connected).toBe(true);
      expect(data.revision).toBe('0');
      socket.terminate();
    });

    it('broadcasts preferences update to connected clients when revision changes', async () => {
      const socket = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Haus-Client': '1' },
      });
      await Promise.all([once(socket, 'open'), once(socket, 'message')]);

      const pendingUpdate = once(socket, 'message');
      liveService.setRevision('rev-42');

      const [update] = await pendingUpdate;
      const data = JSON.parse(String(update));
      expect(data.topic).toBe('preferences');
      expect(data.revision).toBe('rev-42');
      socket.terminate();
    });

    it('closes socket with code 1008 if client sends data to read-only channel', async () => {
      const socket = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${authToken}`, 'X-Haus-Client': '1' },
      });
      await Promise.all([once(socket, 'open'), once(socket, 'message')]);

      const closed = new Promise<[number, string]>((resolve) => {
        socket.on('close', (code, reason) => resolve([code, reason.toString()]));
      });
      socket.send(JSON.stringify({ type: 'unsupported' }));

      const [code, reason] = await closed;
      expect(code).toBe(1008);
      expect(reason).toBe('Read-only channel');
      socket.terminate();
    });
  });

  describe('Cameras HTTP Controller', () => {
    it('rejects unauthenticated requests to /api/cameras with 401', async () => {
      const res = await fetch(`${baseUrl}/api/cameras`);
      expect(res.status).toBe(401);
    });

    it('GET /api/cameras returns list of registered cameras', async () => {
      const res = await fetch(`${baseUrl}/api/cameras`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.cameras).toHaveLength(1);
      expect(body.cameras[0].id).toBe('camera.porch');
    });

    it('GET /api/detectors returns detection sensors', async () => {
      const res = await fetch(`${baseUrl}/api/detectors`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.detectors).toHaveLength(1);
      expect(body.detectors[0].kind).toBe('motion');
    });

    it('POST /api/camera-access generates direct access token', async () => {
      const res = await fetch(`${baseUrl}/api/camera-access`, {
        method: 'POST',
        headers: jsonAuthHeaders,
        body: JSON.stringify({ cameraId: 'camera.porch', clientId: 'phone-1' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBe('access-camera.porch-phone-1');
    });

    it('GET /api/cameras/:id/snapshot serves image buffer with headers', async () => {
      const res = await fetch(`${baseUrl}/api/cameras/camera.porch/snapshot`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-haus-snapshot-stale')).toBe('0');
      expect(res.headers.get('x-haus-snapshot-captured-at')).toBe('1700000000000');
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.equals(mockSnapshotBuffer)).toBe(true);
    });

    it('GET /api/cameras/:id/snapshot returns 404 for unknown camera', async () => {
      const res = await fetch(`${baseUrl}/api/cameras/camera.unknown/snapshot`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('camera_not_found');
    });

    it('PATCH /api/cameras/:id updates camera configuration', async () => {
      const res = await fetch(`${baseUrl}/api/cameras/camera.porch`, {
        method: 'PATCH',
        headers: jsonAuthHeaders,
        body: JSON.stringify({ enabled: false, sensorIds: ['binary_sensor.porch_pir'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.camera.enabled).toBe(false);
    });

    it('POST /api/cameras/:id/operating updates hardware control', async () => {
      const res = await fetch(`${baseUrl}/api/cameras/camera.porch/operating`, {
        method: 'POST',
        headers: jsonAuthHeaders,
        body: JSON.stringify({
          control: 'indicator',
          entityId: 'switch.porch_light',
          value: true,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accepted).toBe(true);
    });

    it('POST /api/cameras/:id/viewer establishes WebRTC session', async () => {
      const res = await fetch(`${baseUrl}/api/cameras/camera.porch/viewer`, {
        method: 'POST',
        headers: jsonAuthHeaders,
        body: JSON.stringify({ owner: 'user-1', viewerId: 'v-1', offer: { sdp: 'offer-sdp' } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sdp).toBe('answer-camera.porch-user-1-v-1');
    });

    it('POST /api/cameras/:id/warm touches warm streaming session', async () => {
      const res = await fetch(`${baseUrl}/api/cameras/camera.porch/warm`, {
        method: 'POST',
        headers: jsonAuthHeaders,
        body: JSON.stringify({ owner: 'user-1', active: true, preview: false }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.active).toBe(true);
    });

    it('POST /api/cameras/:id/record triggers manual recording (201)', async () => {
      const res = await fetch(`${baseUrl}/api/cameras/camera.porch/record`, {
        method: 'POST',
        headers: jsonAuthHeaders,
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.started).toBe(true);
    });

    it('POST /api/cameras/:id/homekit manages HomeKit settings and pairing', async () => {
      const pairRes = await fetch(`${baseUrl}/api/cameras/camera.porch/homekit/pair`, {
        method: 'POST',
        headers: authHeaders,
      });
      expect(pairRes.status).toBe(200);
      const pairBody = await pairRes.json();
      expect(pairBody.uri).toBe('X-HM://000');

      const closeRes = await fetch(`${baseUrl}/api/cameras/camera.porch/homekit/close`, {
        method: 'POST',
        headers: authHeaders,
      });
      expect(closeRes.status).toBe(200);

      const resetRes = await fetch(`${baseUrl}/api/cameras/camera.porch/homekit/reset`, {
        method: 'POST',
        headers: authHeaders,
      });
      expect(resetRes.status).toBe(200);
    });

    it('POST /api/cameras/:id/talk streams two-way audio with required headers', async () => {
      const res = await fetch(`${baseUrl}/api/cameras/camera.porch/talk`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'X-Haus-Client': '1',
          'Content-Type': 'audio/webm',
        },
        body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('talkback-stream-received');
    });

    it('POST /api/cameras/:id/talk rejects invalid audio headers with 400', async () => {
      const res = await fetch(`${baseUrl}/api/cameras/camera.porch/talk`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_audio');
    });

    it('POST /api/cameras/:id/talk returns 404 for unknown camera', async () => {
      const res = await fetch(`${baseUrl}/api/cameras/camera.unknown/talk`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'X-Haus-Client': '1',
          'Content-Type': 'audio/webm',
        },
        body: Buffer.from([0x00]),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('camera_not_found');
    });

    it('POST /api/camera-access returns 404 for unknown camera', async () => {
      const res = await fetch(`${baseUrl}/api/camera-access`, {
        method: 'POST',
        headers: jsonAuthHeaders,
        body: JSON.stringify({ cameraId: 'camera.unknown', clientId: 'desktop-1' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('camera_not_found');
    });

    it('POST /api/cameras/:id/viewer returns 503 when camera requires NVR', async () => {
      const res = await fetch(`${baseUrl}/api/cameras/camera.nvr_required/viewer`, {
        method: 'POST',
        headers: jsonAuthHeaders,
        body: JSON.stringify({ owner: 'user-1', viewerId: 'v-1', offer: { sdp: 'offer-sdp' } }),
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('camera_nvr_required');
    });
  });
});
