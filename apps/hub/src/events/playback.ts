/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export const PLAYBACK_VERSION = 4;
export const ORIGINAL_POLICY_VERSION = 1;

export interface PlaybackInfo {
  audio?: boolean;
  originalCompatible?: boolean;
  originalPolicyVersion?: number;
  originalProvenance?: Record<string, unknown>;
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
  remoteOnly?: boolean;
}

export interface PlaybackWorkerTarget {
  preparePlayback(
    event: PlaybackEventLike,
    priority: number,
    options?: PlaybackPreparationOptions,
  ): Promise<unknown>;
}

export class PlaybackPreparation {
  readonly jobs = new Map<string, PlaybackJob>();

  get available(): boolean {
    return this.worker !== undefined;
  }

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

    const worker = this.worker;
    if (!worker) return 'failed';

    let job = this.jobs.get(key);
    if (job?.state === 'failed' && this.now() - (job.finishedAt ?? 0) >= 5000) {
      this.jobs.delete(key);
      job = undefined;
    }

    if (job) {
      if (job.state === 'preparing' && priority > (job.priority ?? 0)) {
        job.priority = priority;
        void worker.preparePlayback(event, priority, options).catch(() => {});
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

    void Promise.resolve()
      .then(() => worker.preparePlayback(event, priority, options))
      .then(
        () => {
          job!.state = 'ready';
          job!.finishedAt = this.now();
        },
        (error: unknown) => {
          job!.state = 'failed';
          job!.finishedAt = this.now();
          const message = error instanceof Error ? error.message : String(error);
          console.warn('[media] Playback preparation failed', {
            eventId: event.id,
            code: /^media_process_(?:\d+|null)$/.test(message) ? message : 'processing_failed',
          });
        },
      );

    return job.state;
  }

  clear(): void {
    this.jobs.clear();
  }
}

export interface RecentPlaybackEvent extends PlaybackEventLike {
  cameraId: string;
  localOriginal?: boolean;
}

export interface RecentPlaybackStore {
  get(id: string): Promise<RecentPlaybackEvent | null | undefined>;
}

export interface RecentPlaybackRecorder extends PlaybackWorkerTarget {
  stopped?: boolean;
  playbackJobs: { readonly size: number };
  encoding: { readonly activeWork?: unknown; readonly pending: readonly unknown[] };
  cameras?: ReadonlyArray<{ id: string; enabled?: boolean; available?: boolean }>;
}

export interface RecentPlaybackCluster {
  canPreparePlayback(event: RecentPlaybackEvent): boolean;
}

export interface RecentPlaybackCatalog {
  prunePreparations(playbackVersion: number, originalPolicyVersion: number): Promise<void>;
  pendingPreparations(
    playbackVersion: number,
    originalPolicyVersion: number,
    now: number,
  ): Promise<string[]>;
  deferPreparation(id: string, retryAfterAt: number): Promise<void>;
  clearPreparation(id: string): Promise<void>;
}

export interface RecentPlaybackOptions {
  catalog?: RecentPlaybackCatalog;
  now?: () => number;
}

/** Drain a bounded page of pending recordings on idle NVRs, never on HA fallback. */
export class RecentPlayback {
  readonly store: RecentPlaybackStore;
  readonly recorder: RecentPlaybackRecorder;
  readonly cluster: RecentPlaybackCluster;
  readonly catalog: RecentPlaybackCatalog;
  readonly now: () => number;
  busy = false;

  constructor(
    store: RecentPlaybackStore,
    recorder: RecentPlaybackRecorder,
    cluster: RecentPlaybackCluster,
    { catalog, now = Date.now }: RecentPlaybackOptions = {},
  ) {
    if (!catalog) throw new Error('retention_catalog_required');
    this.store = store;
    this.recorder = recorder;
    this.cluster = cluster;
    this.catalog = catalog;
    this.now = now;
  }

  blocked(): boolean {
    return Boolean(
      this.recorder.stopped ||
      this.recorder.playbackJobs.size ||
      this.recorder.encoding.activeWork ||
      this.recorder.encoding.pending.length,
    );
  }

  async tick(): Promise<void> {
    if (this.busy || this.blocked()) return;
    // Admission must be owned before the first asynchronous catalog operation.
    this.busy = true;
    try {
      await this.work();
    } finally {
      this.busy = false;
    }
  }

  async work(): Promise<void> {
    await this.catalog.prunePreparations(PLAYBACK_VERSION, ORIGINAL_POLICY_VERSION);
    const rows = await this.catalog.pendingPreparations(
      PLAYBACK_VERSION,
      ORIGINAL_POLICY_VERSION,
      this.now(),
    );
    for (const id of rows) {
      if (this.blocked()) return;
      const event = await this.store.get(id);
      if (!event) continue;
      const camera = this.recorder.cameras?.find((item) => item.id === event.cameraId);
      if (
        !camera?.enabled ||
        event.localOriginal === false ||
        playbackReady(event) ||
        !this.cluster.canPreparePlayback(event)
      ) {
        // A disabled or not-yet-replicated page must not hide older footage.
        await this.catalog.deferPreparation(id, this.now() + 15000);
        continue;
      }
      await this.catalog.deferPreparation(id, this.now() + 60000);
      if (this.blocked()) return;
      const current = await this.store.get(id);
      if (
        !current ||
        current.localOriginal === false ||
        playbackReady(current) ||
        !this.recorder.cameras?.some((item) => item.id === current.cameraId && item.enabled) ||
        !this.cluster.canPreparePlayback(current)
      ) {
        return;
      }
      try {
        await this.recorder.preparePlayback(current, -10, { remoteOnly: true });
      } catch {
        // Foreground playback retains its normal fallback and retry policy.
      } finally {
        const refreshed = await this.store.get(id);
        if (refreshed && playbackReady(refreshed)) {
          await this.catalog.clearPreparation(id);
        }
      }
      return;
    }
  }
}
