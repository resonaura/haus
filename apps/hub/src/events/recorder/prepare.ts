/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { rename, stat, unlink } from 'node:fs/promises';
import { transcodePlayback } from '@haus/media/pipeline';
import { ORIGINAL_POLICY_VERSION, PLAYBACK_VERSION, playbackReady } from '../playback.js';
import type { EventRecord } from '../recording.types.js';
import {
  inspectAudioAlignment,
  inspectCadence,
  inspectOriginalPlayback,
  probe,
} from './compatible.js';
import type { MediaQueue } from './queue.js';
import type {
  PlaybackUrgency,
  PrepareRemoteFn,
  RecorderConfig,
  RecorderPrepareOptions,
  RecorderStore,
} from './types.js';

export interface PlaybackPrepareContext {
  readonly config: RecorderConfig;
  readonly store: RecorderStore;
  readonly encoding: MediaQueue;
  readonly playbackJobs: Map<string, Promise<string>>;
  readonly playbackPriorities: Map<string, PlaybackUrgency>;
  readonly remotePreparing: Map<string, number>;
  readonly playbackAbort: AbortController;
  readonly prepareRemote?: PrepareRemoteFn;
}

export async function prepareEventPlaybackPinned(
  ctx: PlaybackPrepareContext,
  event: EventRecord,
  priority = 20,
  { remoteOnly = false, forceCompatibility = false }: RecorderPrepareOptions = {},
): Promise<string> {
  if (ctx.playbackJobs.has(event.id)) {
    const existing = ctx.playbackPriorities.get(event.id);
    if (existing) {
      existing.value = Math.max(existing.value, priority);
      existing.localAllowed ||= !remoteOnly;
      existing.forceCompatibility ||= forceCompatibility;
    }
    ctx.encoding.promote(event.id, priority);
    return ctx.playbackJobs.get(event.id)!;
  }
  if (
    playbackReady(event) &&
    (!forceCompatibility || event.playbackInfo?.compatibilityRepaired === true)
  ) {
    return ctx.store.path(event.id, event.playbackBytes ? 'playback.mp4' : 'mp4');
  }
  if (ctx.playbackJobs.size >= 4) throw new Error('playback_queue_busy');
  const urgency: PlaybackUrgency = {
    value: priority,
    localAllowed: !remoteOnly,
    forceCompatibility,
  };
  ctx.playbackPriorities.set(event.id, urgency);
  const job = (async () => {
    const output = ctx.store.path(event.id, 'playback.mp4');
    const temporary = output.replace('.mp4', '.partial.mp4');
    try {
      const source = await stat(ctx.store.path(event.id)).catch(() => null);
      if (!source) throw new Error('archived_original_required_for_repair');
      const diagnostics = await inspectCadence(ctx.store.path(event.id));
      const alignment = await inspectAudioAlignment(
        ctx.store.path(event.id),
        (event.endAt - (event.mediaStartAt ?? event.startAt)) / 1000,
      );
      const originalCompatible =
        !urgency.forceCompatibility &&
        (await inspectOriginalPlayback(
          ctx.store.path(event.id),
          alignment,
          event.playbackInfo?.originalProvenance,
        ).catch(() => false));
      if (originalCompatible && !urgency.forceCompatibility) {
        await ctx.store.setPlayback(event.id, 0, PLAYBACK_VERSION, {
          ...event.playbackInfo,
          ...diagnostics,
          ...alignment,
          originalCompatible: true,
          originalPolicyVersion: ORIGINAL_POLICY_VERSION,
        });
        return ctx.store.path(event.id);
      }
      let remote = false;
      if (event.playbackVersion !== 2 && ctx.prepareRemote) {
        ctx.remotePreparing.set(event.id, Date.now());
        try {
          remote = await ctx.prepareRemote(event, {
            output: temporary,
            audioTrimSeconds: alignment.audioTrimSeconds,
            signal: ctx.playbackAbort.signal,
          });
        } catch (error) {
          if (ctx.playbackAbort.signal.aborted) throw error;
        } finally {
          ctx.remotePreparing.delete(event.id);
        }
      }
      if (!remote && !urgency.localAllowed) {
        throw new Error('background_worker_unavailable');
      }
      if (!remote) {
        await ctx.encoding.run(
          () =>
            transcodePlayback({
              input: ctx.store.path(event.id),
              output: temporary,
              // Version 3 also described unnormalized packet copies.
              // Only version 2 guarantees the earlier normalized video.
              copyVideo: event.playbackVersion === 2,
              audioTrimSeconds: alignment.audioTrimSeconds,
              videoDuration: alignment.videoDuration,
              timeout: Math.max(120000, event.duration * 2000),
              signal: ctx.playbackAbort.signal,
            }),
          urgency.value,
          event.id,
        );
      }
      const info = await probe(temporary);
      if (info.duration < 0.1) throw new Error('empty_video');
      await rename(temporary, output);
      await ctx.store.setPlayback(event.id, (await stat(output)).size, PLAYBACK_VERSION, {
        ...event.playbackInfo,
        ...diagnostics,
        ...alignment,
        originalCompatible: false,
        compatibilityRepaired: urgency.forceCompatibility,
        duration: info.duration,
        audio: info.audio,
        sourceAudioMissing: ctx.config.record_audio && !info.audio,
      });
      return output;
    } finally {
      await unlink(temporary).catch(() => {});
      ctx.playbackJobs.delete(event.id);
      ctx.playbackPriorities.delete(event.id);
    }
  })();
  ctx.playbackJobs.set(event.id, job);
  return job;
}
