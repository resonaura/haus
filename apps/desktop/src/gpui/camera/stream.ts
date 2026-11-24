/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { setTimeout as delay } from 'node:timers/promises';
import { decodeVideoFrames, type MediaRuntime, type VideoFrame } from '@haus/media/pipeline';
import { openLocalHlsRelay, openLocalMediaRelay } from '@haus/media/stream';
import type { HausHelper } from '../../main/helper.js';
import { isRecord } from '../../main/hub/types.js';
import { computeReconnectDelayMs } from '../../shared/camera/retry.js';

type Viewer = Pick<HausHelper, 'request' | 'media' | 'clear'>;
type PlaybackStatus = (status: 'playing' | 'reconnecting') => void;
const MAX_RESTARTS = 3;
const STABLE_PLAYBACK_MS = 30_000;

interface CameraPlayback {
  readonly hub: string;
  readonly id: string;
  readonly key: string;
  viewer: Viewer;
  releasePending: boolean;
  active?: {
    frames: AsyncGenerator<VideoFrame, void>;
    finished: Promise<void>;
    settle: () => void;
  };
}

async function waitForPlayback(finished: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void finished.then(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
  });
}

export class GpuiCameraStreams {
  private readonly shutdown = new AbortController();
  private readonly cameras = new Map<string, CameraPlayback>();

  constructor(
    private readonly media: MediaRuntime,
    private readonly createViewer: (hub: string) => Viewer,
  ) {}

  async *open(hub: string, id: string, signal: AbortSignal, onStatus?: PlaybackStatus) {
    if (!/^camera\.[a-z0-9_]+$/.test(id)) throw new Error('Invalid camera.');
    const scope = AbortSignal.any([this.shutdown.signal, signal]);
    scope.throwIfAborted();
    const key = `${hub}\0${id}`;
    let camera = this.cameras.get(key);
    while (camera?.active) {
      await waitForPlayback(camera.active.finished, scope);
      scope.throwIfAborted();
      camera = this.cameras.get(key);
    }
    camera ??= { hub, id, key, viewer: this.createViewer(hub), releasePending: false };
    const frames = this.watch(camera, scope, onStatus);
    // The promise executor captures the resolver synchronously before playback starts.
    let settle!: () => void;
    const finished = new Promise<void>((resolve) => {
      settle = resolve;
    });
    camera.active = { frames, finished, settle };
    this.cameras.set(key, camera);
    yield* frames;
  }

  async *openRecording(
    hub: string,
    eventId: string,
    signal: AbortSignal,
    options?: {
      readonly original?: boolean;
      readonly startSeconds?: number;
      readonly onStatus?: PlaybackStatus;
    },
  ): AsyncGenerator<VideoFrame, void> {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(eventId)) {
      throw new Error('Invalid recording.');
    }
    const scope = AbortSignal.any([this.shutdown.signal, signal]);
    scope.throwIfAborted();
    const viewer = this.createViewer(hub);
    const mediaUrl =
      `haus-media://recordings/${eventId}/video` + (options?.original ? '?format=1&original=1' : '');
    let firstFrame = true;
    try {
      const relay = await openLocalMediaRelay(
        (range, reqSignal) => viewer.media(mediaUrl, range, reqSignal),
        scope,
      );
      try {
        for await (const frame of decodeVideoFrames(this.media, {
          source: relay.url,
          width: 960,
          height: 540,
          fps: 24,
          startSeconds: options?.startSeconds,
          signal: scope,
        })) {
          if (firstFrame) {
            firstFrame = false;
            options?.onStatus?.('playing');
          }
          yield frame;
        }
      } finally {
        await relay.close();
      }
    } finally {
      viewer.clear();
    }
  }

  async close(): Promise<void> {
    this.shutdown.abort();
    // Returning the generator also unwinds playback if a consumer paused after a frame.
    const stopping = [];
    for (const camera of this.cameras.values()) {
      if (camera.active) stopping.push(camera.active.frames.return(undefined));
    }
    await Promise.allSettled(stopping);
    for (const camera of this.cameras.values()) {
      if (camera.releasePending) console.warn('Haus could not confirm a camera lease release.');
      camera.viewer.clear();
    }
    this.cameras.clear();
  }

  private async *watch(
    camera: CameraPlayback,
    signal: AbortSignal,
    onStatus?: PlaybackStatus,
  ): AsyncGenerator<VideoFrame, void> {
    let hasPlayed = false;
    let restarts = 0;
    try {
      if (camera.releasePending) {
        // Resolve an ambiguous release with the original owner before allocating another.
        await this.release(camera);
        signal.throwIfAborted();
        const viewer = this.createViewer(camera.hub);
        camera.viewer.clear();
        camera.viewer = viewer;
      }
      for (;;) {
        signal.throwIfAborted();
        let firstFrameAt: number | undefined;
        try {
          for await (const frame of this.play(camera, signal)) {
            const now = performance.now();
            if (firstFrameAt === undefined) {
              firstFrameAt = now;
              hasPlayed = true;
              onStatus?.('playing');
            } else if (now - firstFrameAt >= STABLE_PLAYBACK_MS) {
              restarts = 0;
            }
            yield frame;
          }
          throw new Error('The live camera stream ended.');
        } catch (error) {
          signal.throwIfAborted();
          if (camera.releasePending || !hasPlayed || restarts >= MAX_RESTARTS) throw error;
        }
        onStatus?.('reconnecting');
        await delay(computeReconnectDelayMs(restarts++, 1000, 5000), undefined, { signal });
      }
    } finally {
      const active = camera.active;
      camera.active = undefined;
      try {
        if (!camera.releasePending) {
          this.cameras.delete(camera.key);
          camera.viewer.clear();
        }
      } finally {
        active?.settle();
      }
    }
  }

  private warm(camera: CameraPlayback, active: boolean, signal: AbortSignal) {
    return camera.viewer.request(
      { method: 'POST', path: `/api/cameras/${camera.id}/warm`, data: { active } },
      signal,
    );
  }

  private async release(camera: CameraPlayback): Promise<void> {
    const result = await this.warm(camera, false, AbortSignal.timeout(5000));
    // Older Hubs can report the shared stream as warm when other owners remain.
    if (!isRecord(result) || typeof result.warm !== 'boolean')
      throw new Error('The Hub did not acknowledge the camera lease release.');
    camera.releasePending = false;
  }

  private async *play(
    camera: CameraPlayback,
    signal: AbortSignal,
  ): AsyncGenerator<VideoFrame, void> {
    const { id, viewer } = camera;
    const lifetime = new AbortController();
    const scope = AbortSignal.any([lifetime.signal, signal]);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let renewal: Promise<unknown> | undefined;
    const confirmWarm = async (timeout: number) => {
      scope.throwIfAborted();
      const result = await this.warm(camera, true, AbortSignal.timeout(timeout));
      if (
        !isRecord(result) ||
        result.warm !== true ||
        result.streamPath !== `/api/cameras/${id}/live/index.m3u8`
      ) {
        throw new Error('Haus Hub did not provide an HLS camera stream.');
      }
    };
    camera.releasePending = true;
    try {
      await confirmWarm(20_000);
      scope.throwIfAborted();
      heartbeat = setInterval(() => {
        if (renewal) return;
        renewal = confirmWarm(8000)
          .catch((error) => lifetime.abort(error))
          .finally(() => {
            renewal = undefined;
          });
      }, 20_000);
      heartbeat.unref();
      const relay = await openLocalHlsRelay(
        (asset, requestSignal) =>
          viewer.media(`haus-media://streams/${id}/${asset}`, null, requestSignal),
        scope,
      );
      try {
        yield* decodeVideoFrames(this.media, {
          source: relay.url,
          width: 960,
          height: 540,
          fps: 24,
          signal: scope,
        });
      } finally {
        await relay.close();
      }
    } finally {
      clearInterval(heartbeat);
      lifetime.abort();
      await renewal;
      await this.release(camera);
    }
  }
}
