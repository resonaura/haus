/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { join } from 'node:path';
import type { ResourceScope } from '@haus/core/lifecycle';
import { Detectors, VisionWorker, type Capacity } from '@haus/ai';
import { NativeCameraMedia } from '@haus/media/stream';
import { HomeKitMedia } from '@haus/homekit/media';
import { RtspPeer } from '@haus/media/camera';
import {
  CameraSessions,
  CameraRecordings,
  CameraAccess,
  CameraContinuity,
  CameraActivity,
  Playback,
  WorkerStreams,
} from '../nvr/index.js';
import type { RecordingIndex, Blobs } from '../nvr/index.js';
import type { NvrOptions } from '../nvr/transport/types.js';
import type { NvrConfig } from './config.js';
import type { NvrDependencies } from './nvr.js';

interface MediaComposition {
  blobs: Blobs;
  recordings: RecordingIndex;
  capacity: Capacity;
  scope: ResourceScope;
  signal: AbortSignal;
  dependencies: NvrDependencies;
}

export async function composeMedia(
  config: NvrConfig,
  context: MediaComposition,
): Promise<Partial<NvrOptions>> {
  const { root, key, origin } = config;
  const { scope, signal, blobs, recordings, capacity, dependencies } = context;
  const runtime = dependencies.media;
  const own = <T extends { stop(): void | Promise<unknown> }>(value: T): T => {
    scope.defer(async () => {
      await value.stop();
    });
    return value;
  };
  const initialize = async <T extends { initialize(): Promise<unknown> }>(value: T): Promise<T> => {
    await value.initialize();
    signal.throwIfAborted();
    return value;
  };
  const optional = async <
    T extends { initialize(): Promise<unknown>; stop?(): void | Promise<unknown> },
  >(
    value: T,
    code: string,
  ): Promise<T | undefined> => {
    let stopping: Promise<void> | undefined;
    const stop = () =>
      (stopping ??= Promise.resolve().then(async () => {
        await value.stop?.();
      }));
    scope.defer(stop);
    try {
      return await initialize(value);
    } catch (error) {
      try {
        await stop();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'camera_policy_cleanup_failed');
      }
      signal.throwIfAborted();
      dependencies.diagnostic?.(code);
      return undefined;
    }
  };
  const cameraRecordings = await initialize(
    own(new CameraRecordings(join(root, 'camera-recordings'), recordings, blobs)),
  );
  const streams = origin
    ? await initialize(own(new WorkerStreams(join(root, 'streams'), origin, { runtime })))
    : undefined;
  const playback = await initialize(
    own(new Playback(join(root, 'playback'), blobs, capacity, { runtime })),
  );
  const cameras = await initialize(
    own(
      new CameraSessions(
        join(root, 'camera-sessions'),
        new NativeCameraMedia(join(root, 'camera-runtime'), {
          runtime,
          viewerLimit: Math.min(8, capacity.streams * 2),
        }),
        { capacity, blobs, max: capacity.streams, recordings: cameraRecordings, runtime },
      ),
    ),
  );
  // Empty origin denies external detector inputs while allowing explicitly owned local sessions.
  const detectors = await initialize(
    own(
      new Detectors(origin ?? '', capacity, {
        sessions: cameras,
        worker: (options) => new VisionWorker({ ...options, runtime }),
      }),
    ),
  );
  const cameraAccess = await optional(
    new CameraAccess(join(root, 'camera-access.enc'), key, cameras),
    'camera_access_unavailable',
  );
  const continuity = await optional(
    new CameraContinuity(join(root, 'camera-continuity.enc'), key, cameras),
    'camera_continuity_unavailable',
  );
  const cameraActivity = await optional(
    new CameraActivity(join(root, 'camera-activity.enc'), key, cameras, detectors),
    'camera_activity_unavailable',
  );
  const homekit = own(
    new HomeKitMedia({
      runtime,
      input: async (value) => {
        const session = cameras.owned(value.sessionId, value.owner);
        if (session.cameraId !== value.cameraId) throw Error('invalid_homekit_context');
        return cameras.engine.localRtsp(session.id);
      },
      capacity,
      maxEncoders: Math.max(
        1,
        Math.min(8, Math.floor(capacity.cpus), Math.floor(capacity.memory / (256 * 1024 ** 2))),
      ),
    }),
  );
  const peers = own(new RtspPeer(cameras));
  return {
    cameraRecordings,
    streams,
    playback,
    cameras,
    detectors,
    cameraAccess,
    continuity,
    cameraActivity,
    homekit,
    peers,
  };
}
