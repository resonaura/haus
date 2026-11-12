/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, beforeEach, expect, it } from 'vitest';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { createNestApp } from '../../src/nest.js';
import { Backups } from '../../src/backup/backups.js';
import { CameraActivity } from '../../src/camera/control/activity.js';
import { CameraAvailability } from '../../src/camera/control/availability.js';
import { WarmStreams } from '../../src/camera/control/warm.js';
import { Motion } from '../../src/camera/motion/motion.js';
import { RecentPlayback } from '../../src/events/playback.js';
import { Recorder } from '../../src/events/recorder/recorder.js';
import { RecordingStore } from '../../src/events/recording.store.js';
import { Cluster } from '../../src/cluster/cluster.js';
import { NvrCameraSessions } from '../../src/camera/sessions/sessions.js';
import {
  CAMERA_SNAPSHOTS,
  CAMERA_TALKBACK,
  CameraSnapshots,
  HomeKitCameras,
  RECORDING_BACKUPS,
  RECORDING_CLUSTER,
  RECORDING_SESSIONS,
} from '../../src/events/runtime.module.js';
import { CatalogLifetime } from '../../src/storage/lifetime.js';
import { CAMERA_SERVICE } from '../../src/camera/tokens.js';
import { DefaultCameraService } from '../../src/camera/camera.service.js';

let root: string;
let app: INestApplication | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'haus-recording-runtime-'));
});
afterEach(async () => {
  try {
    await app?.close();
  } finally {
    app = undefined;
    await rm(root, { recursive: true, force: true });
  }
});

it('boots one shared cluster and backup engine and stops them before the catalog closes', async () => {
  app = await createNestApp({ dataDirectory: root, apiToken: 'isolated-runtime-token' });
  await app.init();
  const cluster = app.get<Cluster>(RECORDING_CLUSTER);
  const backups = app.get<Backups>(RECORDING_BACKUPS);
  expect(cluster).toBeInstanceOf(Cluster);
  expect(backups).toBeInstanceOf(Backups);
  expect(cluster.backups).toBe(backups);
  const sessions = app.get<NvrCameraSessions>(RECORDING_SESSIONS);
  expect(sessions).toBeInstanceOf(NvrCameraSessions);
  expect(sessions.cluster).toBe(cluster);
  expect(sessions.registry().cameras).toEqual([]);
  const recorder = app.get(Recorder);
  expect(recorder.capture).toBe(sessions);
  expect(recorder.timer).toBeDefined();
  const motion = app.get(Motion);
  const warm = app.get(WarmStreams);
  const activity = app.get(CameraActivity);
  expect(motion.warm).toBe(warm);
  expect(warm.sessions).toBe(sessions);
  expect(activity.motion).toBe(motion);
  expect(motion.onDetection).toBeTypeOf('function');
  expect(recorder.activitySensors).toBeTypeOf('function');
  expect(sessions.authorizeActivityRecording).toBeTypeOf('function');
  const availability = app.get(CameraAvailability);
  expect(availability).toBeInstanceOf(CameraAvailability);
  const snapshots = app.get(CameraSnapshots);
  expect(snapshots).toBeInstanceOf(CameraSnapshots);
  expect(app.get(CAMERA_SNAPSHOTS)).toBe(snapshots);
  const talkback = app.get(CAMERA_TALKBACK);
  expect(talkback).toBeDefined();
  expect(typeof talkback.available).toBe('function');
  const homekit = app.get(HomeKitCameras);
  expect(homekit).toBeInstanceOf(HomeKitCameras);
  expect(cluster.recordingCache).toBeDefined();
  expect(app.get(RecentPlayback).cluster).toBe(cluster);
  expect(cluster.nodes()).toEqual([]);
  await access(join(root, 'backup.key'));
  const lifetime = app.get(CatalogLifetime);
  await app.close();
  app = undefined;
  expect(lifetime.state).toBe('closed');
  expect(homekit.stopped).toBe(true);
  expect(motion.stopped).toBe(true);
  expect(warm.stopped).toBe(true);
  expect(recorder.stopped).toBe(true);
  expect(sessions.stopped).toBe(true);
  expect(cluster.stopped).toBe(true);
  expect(backups.abort.signal.aborted).toBe(true);
});

it('observes camera availability and persists status rows in RecordingStore', async () => {
  app = await createNestApp({ dataDirectory: root, apiToken: 'isolated-runtime-token' });
  await app.init();
  const store = app.get(RecordingStore);
  const availability = app.get(CameraAvailability);
  expect(availability).toBeInstanceOf(CameraAvailability);

  await store.observeAvailability('camera.porch', 'online', 1000);
  const records = await store.availability({ cameraId: 'camera.porch', from: 0, to: 2000 });
  expect(records.length).toBe(1);
  expect(records[0]).toMatchObject({ cameraId: 'camera.porch', state: 'online' });
});

it('wires DefaultCameraService to NvrCameraSessions, WarmStreams, and Recorder in Nest composition', async () => {
  app = await createNestApp({ dataDirectory: root, apiToken: 'isolated-runtime-token' });
  await app.init();
  const cameraService = app.get<DefaultCameraService>(CAMERA_SERVICE);
  expect(cameraService).toBeInstanceOf(DefaultCameraService);
  const sessions = app.get<NvrCameraSessions>(RECORDING_SESSIONS);
  expect(sessions).toBeInstanceOf(NvrCameraSessions);
  const warm = app.get(WarmStreams);
  expect(warm).toBeInstanceOf(WarmStreams);
  const recorder = app.get(Recorder);
  expect(recorder).toBeInstanceOf(Recorder);

  sessions.registry = () => ({
    cameras: [
      {
        id: 'camera.runtime_test',
        enabled: true,
        available: true,
        nativeSource: { url: 'rtsp://127.0.0.1:8554/live' },
      },
    ],
  });

  const warmRes = (await cameraService.touchWarm(
    'camera.runtime_test',
    'warm-owner-12345678',
    false,
  )) as { warm?: boolean };
  expect(warmRes).toMatchObject({ warm: false });

  const closeRes = (await cameraService.closeViewer(
    'camera.runtime_test',
    'viewer-owner-12345678',
    '26c1f67d-9ce3-4099-8f1a-42c6826be001',
  )) as { closed: boolean };
  expect(closeRes).toEqual({ closed: true });
});
