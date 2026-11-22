/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createNestApp } from '../../src/nest.js';
import { CAMERA_SERVICE } from '../../src/camera/tokens.js';
import { DefaultCameraService } from '../../src/camera/camera.service.js';
import { CameraSnapshotScheduler } from '../../src/camera/control/snapshot-loop.js';
import { IntegratedCameraSources } from '../../src/camera/control/integrated.js';
import type { NativeCameraRuntime } from '../../src/camera/control/runtime.js';
import type { NativeCameraRegistryItem } from '../../src/camera/control/sources.js';
import type { CameraActivity } from '../../src/camera/control/activity.js';
import type { Motion } from '../../src/camera/motion/motion.js';
import type { RecordingOwner } from '../../src/events/owner.js';
import type { Backups } from '../../src/backup/backups.js';
import { openTestRecordingStore } from '../support/recording.js';

describe('Camera settings & Activity assist exposure', () => {
  it('exposes enabled, motionDetection, motionStatus, and activity for native and integrated cameras and persists updates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-cam-settings-'));
    const store = await openTestRecordingStore(join(dir, 'recording.sqlite'), dir);
    const integrated = new IntegratedCameraSources();
    const syncNow = vi.fn();
    const markChanged = vi.fn();

    const nativeCameras = {
      cameras: vi.fn((overrides: Record<string, Record<string, unknown>> = {}) => {
        const saved = overrides['camera.outdoor_camera'] ?? {};
        const item: NativeCameraRegistryItem = {
          id: 'camera.outdoor_camera',
          name: 'Outdoor Camera',
          aliases: ['camera.outdoor_alias'],
          available: true,
          enabled: saved.enabled === true,
          motionDetection: saved.motionDetection ?? { enabled: false, mode: 'objects' },
          talkback: saved.talkback,
          sensorMode: Array.isArray(saved.sensorIds) ? 'manual' : 'automatic',
          sensors: [{ id: 'binary_sensor.outdoor_motion', kind: 'motion', available: true }],
        };
        return [item];
      }),
      operating: vi.fn(() => ({})),
      spotlight: vi.fn(() => undefined),
    } as unknown as NativeCameraRuntime;

    const motion = {
      status: vi.fn((id: string) => ({
        state: 'off',
        fresh: false,
        placement: 'nvr',
        processor: 'Miku',
        cameraId: id,
      })),
    } as unknown as Motion;

    const activity = {
      status: vi.fn(() => ({
        available: true,
        active: false,
        source: 'native' as const,
        assistState: 'off',
      })),
    } as unknown as CameraActivity;

    const service = new DefaultCameraService(
      store,
      undefined,
      nativeCameras,
      undefined,
      undefined,
      undefined,
      { markChanged } as unknown as Backups,
      undefined,
      undefined,
      integrated,
      motion,
      activity,
      { syncNow } as unknown as RecordingOwner,
    );

    service.registerCamera({
      id: 'camera.outdoor_side_camera',
      name: 'Outdoor Side Camera',
      rtspUrl: 'rtsp://127.0.0.1:8554/side',
    });

    try {
      const initial = await service.listCameras();
      const side = initial.find((c) => c.id === 'camera.outdoor_side_camera');
      const outdoor = initial.find((c) => c.id === 'camera.outdoor_camera');

      expect(side).toMatchObject({
        id: 'camera.outdoor_side_camera',
        state: 'online',
        available: true,
        enabled: false,
        motionDetection: { enabled: false, mode: 'objects' },
        motionStatus: { placement: 'nvr', processor: 'Miku' },
        activity: { available: true, active: false, source: 'native' },
      });

      expect(outdoor).toMatchObject({
        id: 'camera.outdoor_camera',
        state: 'online',
        available: true,
        enabled: false,
        aliases: ['camera.outdoor_alias'],
        motionDetection: { enabled: false, mode: 'objects' },
        motionStatus: { placement: 'nvr', processor: 'Miku' },
        activity: { available: true, active: false, source: 'native' },
      });

      // Update a native camera by alias: persist both enabled=true (stream & record) and motionDetection=enabled
      const updatedNative = await service.updateCamera('camera.outdoor_alias', {
        enabled: true,
        motionDetection: { enabled: true, mode: 'motion' },
      });
      expect(updatedNative).toMatchObject({
        id: 'camera.outdoor_camera',
        enabled: true,
        motionDetection: { enabled: true, mode: 'motion' },
        motionStatus: { placement: 'nvr', processor: 'Miku' },
      });
      expect(markChanged).toHaveBeenCalled();
      expect(syncNow).toHaveBeenCalled();

      // Synchronous RecordingStore cache reflects persisted override immediately for RECORDING_CAMERAS
      expect(store.overridesSnapshot()['camera.outdoor_camera']).toMatchObject({
        enabled: true,
        motionDetection: { enabled: true, mode: 'motion' },
      });

      // Update integrated camera: persist enabled=true and then back to enabled=false without marking camera offline
      const updatedSide = await service.updateCamera('camera.outdoor_side_camera', {
        enabled: false,
        motionDetection: { enabled: true, mode: 'objects' },
      });
      expect(updatedSide).toMatchObject({
        id: 'camera.outdoor_side_camera',
        state: 'online',
        enabled: false,
        motionDetection: { enabled: true, mode: 'objects' },
      });
      expect(integrated.recordingCameras(store.overridesSnapshot())[0]).toMatchObject({
        id: 'camera.outdoor_side_camera',
        enabled: false,
        available: true,
        motionDetection: { enabled: true, mode: 'objects' },
      });
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('boots Nest RecordingRuntimeModule + CamerasModule without circular DI and serves motionDetection + motionStatus + PATCH over HTTP', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-cam-nest-'));
    await mkdir(join(dir, 'media'), { recursive: true });
    const binPath = join(dir, 'haus-vision-worker');
    await writeFile(binPath, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(binPath, 0o755);
    const prevBin = process.env.HAUS_VISION_BIN;
    process.env.HAUS_VISION_BIN = binPath;
    const token = 'camera-settings-nest-token';
    const app = await createNestApp({ dataDirectory: dir, apiToken: token });
    try {
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const svc = app.get<DefaultCameraService>(CAMERA_SERVICE);
      svc.registerCamera({
        id: 'camera.porch',
        name: 'Porch Camera',
        rtspUrl: 'rtsp://127.0.0.1:8554/porch',
      });

      const listRes = await fetch(`${base}/api/cameras`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listRes.status).toBe(200);
      const listed = (await listRes.json()) as { cameras: Array<Record<string, unknown>> };
      const porch = listed.cameras.find((c) => c.id === 'camera.porch');
      expect(porch).toMatchObject({
        id: 'camera.porch',
        enabled: false,
        motionDetection: { enabled: false, mode: 'objects' },
        motionStatus: { state: 'off', placement: 'home' },
      });
      expect((porch?.motionStatus as { blocked?: string } | undefined)?.blocked).not.toBe(
        'unsupported',
      );
      expect(porch?.activity).toBeDefined();

      const patchRes = await fetch(`${base}/api/cameras/camera.porch`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          motionDetection: { enabled: true, mode: 'motion' },
        }),
      });
      expect(patchRes.status).toBe(200);
      const patched = (await patchRes.json()) as Record<string, unknown>;
      expect(patched).toMatchObject({
        id: 'camera.porch',
        enabled: true,
        motionDetection: { enabled: true, mode: 'motion' },
        camera: {
          id: 'camera.porch',
          enabled: true,
          motionDetection: { enabled: true, mode: 'motion' },
        },
      });

      const badRes = await fetch(`${base}/api/cameras/camera.porch`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ motionDetection: { enabled: true, mode: 'invalid' } }),
      });
      expect(badRes.status).toBe(400);
      expect(await badRes.json()).toMatchObject({ error: 'invalid_motion_detection' });
    } finally {
      if (prevBin === undefined) delete process.env.HAUS_VISION_BIN;
      else process.env.HAUS_VISION_BIN = prevBin;
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exposes enabled operating controls for Eufy-style integrated cameras and toggles them via onOperatingChange', async () => {
    const integrated = new IntegratedCameraSources();
    const nativeCameras = {
      cameras: vi.fn(() => [
        {
          id: 'camera.outdoor_side_camera',
          name: 'Outdoor Side Camera',
          available: true,
          enabled: false,
        } as NativeCameraRegistryItem,
      ]),
      operating: vi.fn(() => ({})),
      spotlight: vi.fn(() => undefined),
      manages: vi.fn(() => false),
    } as unknown as NativeCameraRuntime;

    const service = new DefaultCameraService(
      undefined,
      undefined,
      nativeCameras,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      integrated,
    );

    const onOperatingChange = vi.fn(async () => undefined);
    service.registerCamera({
      id: 'camera.outdoor_side_camera',
      name: 'Outdoor Side Camera',
      rtspUrl: 'rtsp://127.0.0.1:8554/eufy',
      operating: { indicator: true, nightVision: false },
      onOperatingChange,
    });
    service.registerCamera({
      id: 'camera.no_controls',
      name: 'Basic Camera',
      rtspUrl: 'rtsp://127.0.0.1:8554/basic',
    });

    const listed = await service.listCameras();
    const eufy = listed.find((c) => c.id === 'camera.outdoor_side_camera');
    const basic = listed.find((c) => c.id === 'camera.no_controls');

    expect(eufy?.operating).toEqual({
      indicator: {
        id: 'native:camera.outdoor_side_camera:indicator',
        available: true,
        value: true,
      },
      nightVision: {
        id: 'native:camera.outdoor_side_camera:nightVision',
        available: true,
        value: false,
      },
    });
    expect(basic?.operating).toBeUndefined();

    await service.setOperating(
      'camera.outdoor_side_camera',
      'indicator',
      'native:camera.outdoor_side_camera:indicator',
      false,
    );
    expect(onOperatingChange).toHaveBeenCalledWith('indicator', false);

    const updated = (await service.listCameras()).find(
      (c) => c.id === 'camera.outdoor_side_camera',
    );
    expect(updated?.operating).toMatchObject({
      indicator: {
        id: 'native:camera.outdoor_side_camera:indicator',
        available: true,
        value: false,
      },
      nightVision: {
        id: 'native:camera.outdoor_side_camera:nightVision',
        available: true,
        value: false,
      },
    });
  });

  it('refreshes online camera snapshots in the background and reuses fresh cached snapshots for client reads', async () => {
    const integrated = new IntegratedCameraSources();
    const service = new DefaultCameraService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      integrated,
    );

    let onlineCaptures = 0;
    let offlineCaptures = 0;
    const jpeg = (n: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, 0xff, 0xd9]);

    service.registerCamera({
      id: 'camera.online_cam',
      name: 'Online Cam',
      snapshotFetch: async () => jpeg(++onlineCaptures),
    });
    service.registerCamera({
      id: 'camera.offline_cam',
      name: 'Offline Cam',
      providerAvailable: false,
      snapshotFetch: async () => jpeg(++offlineCaptures),
    });

    const scheduler = new CameraSnapshotScheduler(service);
    await scheduler.tick();

    expect(onlineCaptures).toBe(1);
    expect(offlineCaptures).toBe(0);

    // Client getSnapshot immediately reuses the fresh background-captured snapshot.
    const cached = await service.getSnapshot('camera.online_cam');
    expect(cached.stale).toBe(false);
    expect(cached.buffer.equals(jpeg(1))).toBe(true);
    expect(onlineCaptures).toBe(1);

    // Next background tick forces a fresh capture even within the client cache window.
    await scheduler.tick();
    expect(onlineCaptures).toBe(2);
    const refreshed = await service.getSnapshot('camera.online_cam');
    expect(refreshed.buffer.equals(jpeg(2))).toBe(true);
  });
});
