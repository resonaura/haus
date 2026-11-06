/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export const PLAYBACK_VERSION = 4;
export const ORIGINAL_POLICY_VERSION = 3;

export interface PlaybackInfo {
  audio?: boolean;
  originalCompatible?: boolean;
  originalPolicyVersion?: number;
  originalProvenance?: string;
  compatibilityRepaired?: boolean;
  sourceAudioMissing?: boolean;
  largestGap?: number;
  duration?: number;
  audioTailSeconds?: number;
  audioTrimSeconds?: number;
}

export interface PlaybackEventLike {
  id: string;
  playbackVersion?: number;
  playbackBytes?: number;
  playbackInfo?: PlaybackInfo;
}

export function playbackReady(event: PlaybackEventLike): boolean {
  if (event.playbackVersion !== PLAYBACK_VERSION) return false;
  return (
    (event.playbackBytes !== undefined && event.playbackBytes > 0) ||
    event.playbackInfo?.originalCompatible !== true ||
    event.playbackInfo?.originalPolicyVersion === ORIGINAL_POLICY_VERSION
  );
}

export interface PlaybackJob {
  state: 'preparing' | 'ready' | 'failed' | 'busy';
  priority?: number;
  finishedAt?: number;
}

export interface PlaybackPreparationOptions {
  forceCompatibility?: boolean;
  async?: boolean;
}

export interface PlaybackWorkerTarget {
  preparePlayback(
    event: PlaybackEventLike,
    priority: number,
    options?: PlaybackPreparationOptions,
  ): Promise<void>;
}

export class PlaybackPreparation {
  private readonly jobs = new Map<string, PlaybackJob>();

  constructor(
    private readonly worker?: PlaybackWorkerTarget,
    private readonly options: { now?: () => number; limit?: number } = {},
  ) {}

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  status(
    event: PlaybackEventLike,
    priority = 20,
    options: PlaybackPreparationOptions = {},
  ): 'preparing' | 'ready' | 'failed' | 'busy' {
    const key = event.id + (options.forceCompatibility ? ':repair' : '');
    const repair = this.jobs.get(event.id + ':repair');
    if (!options.forceCompatibility && repair?.state === 'preparing') {
      return 'preparing';
    }

    if (
      playbackReady(event) &&
      (!options.forceCompatibility || event.playbackInfo?.compatibilityRepaired === true)
    ) {
      this.jobs.delete(key);
      return 'ready';
    }

    let job = this.jobs.get(key);
    if (job?.state === 'failed' && this.now() - (job.finishedAt ?? 0) >= 5000) {
      this.jobs.delete(key);
      job = undefined;
    }

    if (job) {
      if (job.state === 'preparing' && priority > (job.priority ?? 0)) {
        job.priority = priority;
        if (this.worker) {
          void this.worker.preparePlayback(event, priority, options).catch(() => {});
        }
      }
      return job.state;
    }

    const limit = this.options.limit ?? 64;
    for (const [id, existing] of this.jobs) {
      if (this.jobs.size < limit) break;
      if (existing.state !== 'preparing') this.jobs.delete(id);
    }

    if (this.jobs.size >= limit) return 'busy';

    job = { state: 'preparing', priority };
    this.jobs.set(key, job);

    if (this.worker) {
      void Promise.resolve()
        .then(() => this.worker?.preparePlayback(event, priority, options))
        .then(
          () => {
            job!.state = 'ready';
            job!.finishedAt = this.now();
          },
          (error: unknown) => {
            job!.state = 'failed';
            job!.finishedAt = this.now();
            console.warn('[media] Playback preparation failed', {
              eventId: event.id,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        );
    } else {
      job.state = 'ready';
      job.finishedAt = this.now();
    }

    return job.state;
  }

  clear(): void {
    this.jobs.clear();
  }
}
