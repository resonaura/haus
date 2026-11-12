/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NativeProviderCamera } from '../../src/providers/native.js';
import type { LightState } from '@haus/bridge/protocol';
import { AuthModule } from '../../src/auth/auth.module.js';
import { CamerasModule } from '../../src/camera/camera.module.js';
import { NativeProviders } from '../../src/providers/native.js';
import { CameraCatalog } from '../../src/storage/cameras/catalog.js';
import { StorageModule } from '../../src/storage/storage.module.js';
import { openCatalog } from '../../src/storage/source.js';
import { Transactions } from '../../src/storage/transactions.js';

const snapshotFrame = vi.hoisted(() => ({
  capture: vi.fn(async () => ({
    buffer: Buffer.from([255, 216, 255, 217]),
    at: 1_700_000_000_000,
    stale: false,
  })),
}));

vi.mock('@haus/media/snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@haus/media/snapshot')>()),
  fetchBridgeSnapshot: snapshotFrame.capture,
}));

const bridgeId = 'fixture-bridge';
const physicalId = 'physical-side-camera';
const cameraId = 'camera.side_camera';
const token = 'fixture-api-token';

describe('Native camera controls in the Nest Hub composition', () => {
  let app: INestApplication;
  let root: string;
  let origin: string;
  let reachable = true;
  const entities: NativeProviderCamera['entities'] = [
    {
      id: 'status-light',
      domain: 'switch',
      role: 'indicator',
      writable: true,
      available: true,
      state: false,
      updatedAt: 1,
    },
    {
      id: 'spotlight',
      domain: 'light',
      role: 'spotlight',
      writable: true,
      available: true,
      brightness: true,
      state: { on: false, brightness: 35 },
      updatedAt: 1,
    },
  ];
  const physical: NativeProviderCamera = {
    id: physicalId,
    name: 'Side Camera',
    available: true,
    stream: { url: 'rtsp://192.168.1.20/live', transport: 'native-rtsp' },
    snapshotPath: `/api/cameras/${physicalId}/snapshot/last-live`,
    entities,
  };
  const inventory = {
    bridgeId,
    provider: 'aqara',
    revision: 'fixture-revision',
    cameras: [physical],
  };
  const provider = {
    tick: vi.fn(async () => {}),
    inventory: vi.fn(() => ({ ...inventory, reachable })),
    connections: () => [
      { id: bridgeId, connection: { provider: 'aqara', endpoint: { url: 'http://127.0.0.1' } } },
    ],
    identities: {
      list: () => [],
      select: (_id: string, source: string, preferred?: string) => preferred ?? source,
    },
    onChanged: vi.fn(),
    command: vi.fn(async (_bridge: string, _camera: string, entityId: string, command: unknown) => {
      const entity = entities.find((item) => item.id === entityId);
      if (!entity || !command || typeof command !== 'object') return;
      const action = Reflect.get(command, 'action');
      const value: unknown = Reflect.get(command, 'value');
      if (action !== 'set') return;
      if (
        entity.domain === 'light' &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const current =
          entity.state && typeof entity.state === 'object' && !Array.isArray(entity.state)
            ? (entity.state as LightState)
            : { on: false };
        const patch = value as Record<string, unknown>;
        const next: LightState = { ...current };
        if (typeof patch.on === 'boolean') next.on = patch.on;
        if (typeof patch.brightness === 'number') next.brightness = patch.brightness;
        if (typeof patch.hue === 'number') next.hue = patch.hue;
        if (typeof patch.saturation === 'number') next.saturation = patch.saturation;
        entity.state = next;
      } else if (
        typeof value === 'boolean' ||
        typeof value === 'number' ||
        typeof value === 'string' ||
        value === null
      ) {
        entity.state = value;
      }
    }),
    refresh: vi.fn(async () => inventory),
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'haus-camera-composition-'));
    const source = await openCatalog(join(root, 'haus.sqlite'));
    const transactions = new Transactions(source);
    const catalog = new CameraCatalog(transactions);
    await catalog.initialize();
    await catalog.native.addProvider({
      id: bridgeId,
      connection: JSON.stringify({
        bridgeId,
        provider: 'aqara',
        endpoint: { url: 'http://127.0.0.1' },
      }),
      createdAt: Date.now(),
    });
    await catalog.native.importSources([
      {
        identity: { bridgeId, physicalId, cameraId },
        value: JSON.stringify({ cameraId, name: 'Side Camera', aliases: [], physical }),
      },
    ]);
    await transactions.drain();
    await source.destroy();

    const module = await Test.createTestingModule({
      imports: [
        AuthModule.forRoot({ apiToken: token }),
        StorageModule.forRoot({ databasePath: join(root, 'haus.sqlite') }),
        CamerasModule,
      ],
    })
      .overrideProvider(NativeProviders)
      .useValue(provider)
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }),
    );
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw Error('fixture_listener_unavailable');
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function request(path: string, body?: unknown): Promise<Response> {
    return fetch(`${origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it('lists imported native cameras and dispatches operating and spotlight controls', async () => {
    const listed = await request('/api/cameras');
    expect(listed.status).toBe(200);
    const payload = (await listed.json()) as {
      cameras: Array<{
        id: string;
        state: string;
        operating?: { indicator?: { id: string; available: boolean; value: boolean } };
        spotlight?: { id: string; available: boolean; brightness?: number };
      }>;
    };
    expect(payload.cameras).toHaveLength(1);
    expect(payload.cameras[0]).toMatchObject({
      id: cameraId,
      state: 'online',
      operating: { indicator: { id: 'native:status-light', available: true, value: false } },
      spotlight: { id: 'native:spotlight', available: true, brightness: 35 },
    });

    const operating = await request(`/api/cameras/${cameraId}/operating`, {
      control: 'indicator',
      entityId: 'native:status-light',
      value: true,
    });
    expect(operating.status).toBe(200);
    expect(await operating.json()).toEqual({ accepted: true });

    const spotlight = await request(`/api/cameras/${cameraId}/spotlight`, {
      entityId: 'native:spotlight',
      brightness: 72,
    });
    expect(spotlight.status).toBe(200);
    expect(await spotlight.json()).toEqual({ accepted: true });
    expect(provider.command).toHaveBeenCalledTimes(2);
    expect(provider.command.mock.calls.map((call) => call[2])).toEqual([
      'status-light',
      'spotlight',
    ]);
  });

  it('serves a validated native snapshot and retains it while the bridge is unavailable', async () => {
    snapshotFrame.capture.mockResolvedValueOnce({
      buffer: Buffer.from([255, 216, 255, 217]),
      at: 1_700_000_000_000,
      stale: false,
    });
    const fresh = await request(`/api/cameras/${cameraId}/snapshot`);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get('content-type')).toBe('image/jpeg');
    expect(fresh.headers.get('x-haus-snapshot-stale')).toBe('0');
    expect(fresh.headers.get('x-haus-snapshot-captured-at')).toBe('1700000000000');
    expect(Buffer.from(await fresh.arrayBuffer())).toEqual(Buffer.from([255, 216, 255, 217]));
    expect(snapshotFrame.capture).toHaveBeenCalledWith({
      version: 1,
      provider: 'aqara',
      url: `http://127.0.0.1/api/cameras/${physicalId}/snapshot/last-live`,
    });

    snapshotFrame.capture.mockRejectedValueOnce(new Error('bridge_unreachable'));
    const stale = await request(`/api/cameras/${cameraId}/snapshot`);
    expect(stale.status).toBe(200);
    expect(stale.headers.get('x-haus-snapshot-stale')).toBe('1');
    expect(stale.headers.get('x-haus-snapshot-captured-at')).toBe('1700000000000');
  });

  it('requires an authenticated session before requesting a native snapshot', async () => {
    snapshotFrame.capture.mockClear();
    const response = await fetch(`${origin}/api/cameras/${cameraId}/snapshot`);
    expect(response.status).toBe(401);
    expect(snapshotFrame.capture).not.toHaveBeenCalled();
  });

  it('returns not found for snapshots of cameras that are not imported', async () => {
    const response = await request('/api/cameras/camera.unknown/snapshot');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'camera_not_found' });
  });

  it('keeps unreachable and unsupported controls unavailable without dispatching commands', async () => {
    const commandCount = provider.command.mock.calls.length;
    reachable = false;

    const offline = await request(`/api/cameras/${cameraId}/operating`, {
      control: 'indicator',
      entityId: 'native:status-light',
      value: false,
    });
    expect(offline.status).toBe(409);

    const unsupported = await request(`/api/cameras/${cameraId}/spotlight`, {
      entityId: 'native:not-a-spotlight',
      on: true,
    });
    expect(unsupported.status).toBe(409);

    const invalid = await request(`/api/cameras/${cameraId}/spotlight`, {
      entityId: 'native:spotlight',
      brightness: 101,
    });
    expect(invalid.status).toBe(400);

    const listed = await request('/api/cameras');
    const payload = (await listed.json()) as {
      cameras: Array<{
        state: string;
        operating?: { indicator?: { available: boolean } };
        spotlight?: { available: boolean };
      }>;
    };
    expect(payload.cameras[0]).toMatchObject({
      state: 'offline',
      operating: { indicator: { available: false } },
      spotlight: { available: false },
    });
    expect(provider.command).toHaveBeenCalledTimes(commandCount);
  });

  it('handles WebRTC viewer negotiation, warm touch and close for native cameras', async () => {
    const viewer = await request(`/api/cameras/${cameraId}/viewer`, {
      owner: 'viewer-owner-12345678',
      viewerId: '26c1f67d-9ce3-4099-8f1a-42c6826be001',
      offer: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\n',
    });
    expect(viewer.status).toBe(200);
    const viewerBody = (await viewer.json()) as { answer?: { type: string; sdp: string } };
    expect(viewerBody.answer?.type).toBe('answer');

    const warm = await request(`/api/cameras/${cameraId}/warm`, {
      owner: 'warm-owner-12345678',
      active: true,
    });
    expect(warm.status).toBe(200);
    const warmBody = (await warm.json()) as { active: boolean };
    expect(warmBody.active).toBe(true);

    const close = await request(`/api/cameras/${cameraId}/viewer/close`, {
      owner: 'viewer-owner-12345678',
      viewerId: '26c1f67d-9ce3-4099-8f1a-42c6826be001',
    });
    expect(close.status).toBe(200);
    expect(await close.json()).toEqual({ closed: true });
  });

  it('rejects media actions on unknown cameras and when recorder is unavailable', async () => {
    const unknownViewer = await request('/api/cameras/camera.unknown/viewer', {
      owner: 'viewer-owner-12345678',
      viewerId: '26c1f67d-9ce3-4099-8f1a-42c6826be001',
      offer: 'v=0\r\n',
    });
    expect(unknownViewer.status).toBe(404);

    const unknownWarm = await request('/api/cameras/camera.unknown/warm', {
      owner: 'warm-owner-12345678',
      active: true,
    });
    expect(unknownWarm.status).toBe(404);

    const recordUnknown = await request('/api/cameras/camera.unknown/record', {});
    expect(recordUnknown.status).toBe(404);

    const recordNativeNoWorker = await request(`/api/cameras/${cameraId}/record`, {});
    expect(recordNativeNoWorker.status).toBe(503);
    expect(await recordNativeNoWorker.json()).toMatchObject({
      error: 'recording_worker_unavailable',
    });
  });
});
