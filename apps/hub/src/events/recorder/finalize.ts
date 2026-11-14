/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractVideoSnapshot } from '@haus/media';
import { transcodePlayback } from '@haus/media/pipeline';
import { ORIGINAL_POLICY_VERSION, PLAYBACK_VERSION } from '../playback.js';
import type { EventRecord } from '../recording.types.js';
import {
  inspectAudioAlignment,
  inspectOriginalPlayback,
  probe,
  type OriginalPlaybackProvenance,
} from './compatible.js';
import type { MediaQueue } from './queue.js';
import { bufferDirectoryPath, type SegmentPart } from './segments.js';
import type {
  RecorderBuffer,
  RecorderCamera,
  RecorderCapturePort,
  RecorderConfig,
  RecorderPrepareOptions,
  RecorderStore,
} from './types.js';

export interface FinalizeContext {
  readonly config: RecorderConfig;
  readonly store: RecorderStore;
  readonly capture?: RecorderCapturePort;
  readonly useCapture?: boolean;
  readonly buffers: ReadonlyMap<string, RecorderBuffer>;
  readonly cameras?: readonly RecorderCamera[];
  readonly encoding: MediaQueue;
  readonly playbackAbort: AbortController;
  readonly stopped: boolean;
  onChange(): void;
  segments(buffer: { readonly dir: string }): Promise<SegmentPart[]>;
  preparePlayback(
    event: EventRecord,
    priority?: number,
    options?: RecorderPrepareOptions,
  ): Promise<string>;
}

export async function finalizeRecordedEvent(
  ctx: FinalizeContext,
  event: EventRecord,
): Promise<void> {
  const useRemote = Boolean(
    ctx.capture && (ctx.capture.events.has(event.id) || (ctx.useCapture ?? true)),
  );
  if (useRemote && ctx.capture) {
    try {
      await ctx.capture.finalize(event);
    } catch (error) {
      if (!ctx.stopped) {
        const err = error as { code?: string; message?: string } | null;
        await ctx.store.finish(event.id, {
          status: 'failed',
          error:
            err?.code === 'storage_full' || err?.message === 'storage_full'
              ? 'Free space on your recording server and try again.'
              : 'The NVR recording could not be verified and saved',
        });
      }
    }
    ctx.onChange();
    return;
  }

  const buffer = ctx.buffers.get(event.cameraId) ?? {
    dir: bufferDirectoryPath(ctx.config.data, event.cameraId),
  };
  try {
    const segments = buffer
      ? (await ctx.segments(buffer)).filter(
          (part) =>
            part.end >= event.startAt - ctx.config.pre_roll_seconds * 1000 &&
            part.start <= event.endAt,
        )
      : [];
    const ready: SegmentPart[] = [];
    for (const part of segments) {
      const partInfo = await stat(part.path).catch(() => null);
      if (partInfo && partInfo.size > 0) ready.push(part);
    }
    if (!ready.length) throw new Error('no_video');
    const manifest = join(ctx.config.data, `${event.id}.concat`);
    const output = ctx.store.path(event.id);
    const temporary = output.replace('.mp4', '.partial.mp4');
    let activeParts = ready;
    let packetCopy = false;
    const runMux = async (selected: SegmentPart[]): Promise<boolean> => {
      await writeFile(
        manifest,
        selected
          .map(
            (part) =>
              `file '${part.path.replaceAll("'", "'\\''")}'\nduration ${((part.end - part.start) / 1000).toFixed(6)}`,
          )
          .join('\n'),
        { mode: 0o600 },
      );
      let usedCopy = true;
      await ctx.encoding.run(async () => {
        // One FFmpeg process keeps a fixed output codec. Check each ring
        // generation, including reconnects, before copying its H264 packets.
        const sources = new Map(
          selected.map((part) => [part.path.replace(/-\d{9,}\.mp4$/, ''), part.path]),
        );
        for (const source of sources.values()) {
          if ((await probe(source)).codec !== 'h264') {
            usedCopy = false;
            break;
          }
        }
        return transcodePlayback({
          input: manifest,
          output: temporary,
          concat: true,
          recordAudio: ctx.config.record_audio,
          copyVideo: usedCopy,
          timeout: Math.max(120000, ctx.config.max_event_seconds * 1500),
          signal: ctx.playbackAbort.signal,
        });
      }, 10);
      return usedCopy;
    };
    try {
      try {
        packetCopy = await runMux(activeParts);
      } catch (muxError) {
        if (ctx.stopped || ctx.playbackAbort.signal.aborted || activeParts.length <= 1) {
          throw muxError;
        }
        const salvaged: SegmentPart[] = [];
        for (const part of activeParts) {
          const probed = await probe(part.path).catch(() => null);
          if (probed && Number.isFinite(probed.duration) && probed.duration > 0) {
            salvaged.push(part);
          }
        }
        if (salvaged.length === 0 || salvaged.length === activeParts.length) throw muxError;
        activeParts = salvaged;
        await unlink(temporary).catch(() => {});
        packetCopy = await runMux(activeParts);
      }
      const info = await probe(temporary);
      if (info.duration < 0.1) throw new Error('empty_video');
      await rename(temporary, output);
      await extractVideoSnapshot(output, ctx.store.path(event.id, 'jpg'), {
        timestamp: Math.min(2, info.duration / 2),
        signal: ctx.playbackAbort.signal,
      }).catch(() => {});
      const file = await stat(output);
      const firstReady = activeParts[0]!;
      const lastReady = activeParts.at(-1)!;
      const alignment = packetCopy
        ? await inspectAudioAlignment(output, (event.endAt - firstReady.start) / 1000)
        : {};
      const originalProvenance: OriginalPlaybackProvenance | undefined = packetCopy
        ? ctx.cameras?.find((camera) => camera.id === event.cameraId)?.playbackSource
        : { kind: 'haus-encoder', profile: 1 };
      const compatible =
        !packetCopy ||
        (await inspectOriginalPlayback(output, alignment, originalProvenance).catch(() => false));
      await ctx.store.setPlayback(event.id, 0, compatible ? PLAYBACK_VERSION : 0, {
        ...alignment,
        originalProvenance,
        originalPolicyVersion: compatible ? ORIGINAL_POLICY_VERSION : undefined,
        audio: info.audio,
        sourceAudioMissing: ctx.config.record_audio && !info.audio,
        ...(compatible && packetCopy ? { originalCompatible: true } : {}),
      });
      await ctx.store.finish(event.id, {
        duration: info.duration,
        bytes: file.size,
        playbackVersion: compatible ? PLAYBACK_VERSION : 0,
        // The event starts at detection; the file starts in the pre-event ring.
        // Persist the actual boundary, including a keyframe-aligned extra segment.
        mediaStartAt: Math.round(firstReady.start),
        error:
          lastReady.end < event.endAt - 8000
            ? 'Partial recording: the camera stream stopped'
            : null,
      });
      // Start before periodic replication. The remote worker can upload the
      // authoritative original just in time; this never blocks fresh capture.
      if (!compatible && !ctx.stopped) {
        void ctx.store
          .get(event.id)
          .then((current) =>
            current ? ctx.preparePlayback(current, 5, { remoteOnly: true }) : undefined,
          )
          .catch(() => {});
      }
    } finally {
      await unlink(manifest).catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  } catch (error) {
    if (ctx.stopped) return;
    const err = error as { message?: string } | null;
    await ctx.store.finish(event.id, {
      status: 'failed',
      error:
        err?.message === 'no_video'
          ? 'No camera video was available for this event'
          : 'Video could not be finalized',
    });
  }
  ctx.onChange();
}

/** Removes orphaned concat manifests and partial mux outputs left behind by an abrupt crash. */
export async function cleanStaleRecorderTemps(configDir: string, mediaDir: string): Promise<void> {
  const removeMatching = async (dir: string, suffix: string): Promise<void> => {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (name.endsWith(suffix)) await unlink(join(dir, name)).catch(() => {});
    }
  };
  await Promise.all([
    removeMatching(configDir, '.concat'),
    removeMatching(mediaDir, '.partial.mp4'),
  ]);
}
