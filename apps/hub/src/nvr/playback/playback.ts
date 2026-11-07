/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { blobPath } from '../blobs.js';
import type { BlobReadHandle, BlobRelease } from '../blob-readers.js';
import { cameraFileDigest, pipeMediaFile } from '@haus/media/pipeline';
import { body, json } from '../http.js';
import type { NormalizeRecordingInput, MediaRuntime, PlaybackPrepared } from '@haus/media/pipeline';
import { defaultMediaRuntime, normalizeRecording } from '@haus/media/pipeline';

export interface PlaybackCapacity {
  cpus: number;
  memory: number;
  memoryUsed?: number;
  pressured: boolean;
  playbackBusy?: boolean;
}

export interface PlaybackBlobs {
  root: string;
  openRead: (digest: string) => Promise<BlobReadHandle>;
  reserveTransient: (bytes: number) => Promise<BlobRelease>;
}

export type RecordingEncoderResult = Partial<PlaybackPrepared> & Record<string, unknown>;
export type RecordingEncoder = (input: NormalizeRecordingInput) => Promise<RecordingEncoderResult>;

export interface PlaybackOptions {
  encode?: RecordingEncoder;
  now?: () => number;
  maxBytes?: number;
  runtime?: MediaRuntime;
}

export interface PlaybackStatus {
  profile: number;
  active: number;
  max: number;
}

interface PlaybackInput {
  digest: string;
  profile: number;
  audioTrimSeconds: number;
}

const parsePlaybackInput = (value: unknown): PlaybackInput | undefined => {
  if (!isRecord(value)) return undefined;
  const { digest, profile, audioTrimSeconds } = value;
  if (
    Object.keys(value).some((key) => !['digest', 'profile', 'audioTrimSeconds'].includes(key)) ||
    typeof digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    profile !== 1 ||
    typeof audioTrimSeconds !== 'number' ||
    !Number.isFinite(audioTrimSeconds) ||
    audioTrimSeconds < 0 ||
    audioTrimSeconds > 86400
  )
    return undefined;
  return { digest, profile, audioTrimSeconds };
};

type PlaybackJobState = 'preparing' | 'ready' | 'failed';

interface PlaybackJob {
  id: string;
  identity: string;
  state: PlaybackJobState;
  lastRead: number;
  abort: AbortController;
  dir: string;
  output: string;
  pending: Promise<void>;
  result?: Record<string, unknown>;
  release?: BlobRelease;
  serving?: number;
}

/** Optional bounded work on an existing authenticated blob; the helper owns the result. */
export class Playback {
  private readonly jobs = new Map<string, PlaybackJob>();
  private serving = 0;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private readonly encode: RecordingEncoder;
  private readonly runtime: MediaRuntime;

  private readonly now: () => number;
  readonly maxBytes: number;

  constructor(
    readonly root: string,
    readonly blobs: PlaybackBlobs,
    readonly capacity: PlaybackCapacity,
    {
      encode = normalizeRecording,
      now = () => performance.now(),
      maxBytes = 256 * 1024 ** 2,
      runtime = defaultMediaRuntime,
    }: PlaybackOptions = {},
  ) {
    this.encode = encode;
    this.runtime = runtime;
    this.now = now;
    this.maxBytes = maxBytes;
  }

  /** Includes completed work awaiting release without exposing mutable jobs or their private paths. */
  get retainedJobs(): number {
    return this.jobs.size;
  }

  async initialize(): Promise<this> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.root))
      if (/^[a-f0-9-]{36}$/.test(name))
        await rm(join(this.root, name), { recursive: true, force: true });
    this.timer = setInterval(() => void this.prune().catch(() => {}), 5000);
    this.timer.unref();
    return this;
  }

  status(): PlaybackStatus {
    return {
      profile: 1,
      active: [...this.jobs.values()].filter((job) => job.state === 'preparing').length,
      max:
        !this.stopped &&
        !this.capacity.pressured &&
        this.capacity.cpus >= 1 &&
        this.capacity.memory >= 768 * 1024 ** 2 &&
        this.capacity.memory - (this.capacity.memoryUsed || 0) >= 512 * 1024 ** 2
          ? 1
          : 0,
    };
  }

  describe(job: PlaybackJob): Record<string, unknown> {
    return {
      id: job.id,
      status: job.state,
      ...job.result,
      ...(job.state === 'failed' ? { error: 'preparation_failed' } : {}),
    };
  }

  start(input: unknown): Record<string, unknown> {
    // Match the helper's proven-silent-lead bound. Video itself is still
    // limited to ten minutes by the fixed, resource-bounded encoder.
    const parsed = parsePlaybackInput(input);
    if (!parsed) throw new Error('invalid_playback');
    if (this.stopped) throw new Error('playback_busy');
    const identity = JSON.stringify([parsed.digest, parsed.profile, parsed.audioTrimSeconds]);
    const known = [...this.jobs.values()].find((job) => job.identity === identity);
    if (known) return this.describe(known);
    const budget = this.status();
    if (budget.active >= budget.max || this.jobs.size >= 8) throw new Error('playback_busy');
    const id = randomUUID();
    const job: PlaybackJob = {
      id,
      identity,
      state: 'preparing',
      lastRead: this.now(),
      abort: new AbortController(),
      dir: join(this.root, id),
      output: '',
      pending: Promise.resolve(),
    };
    job.output = join(job.dir, 'playback.mp4');
    this.jobs.set(id, job);
    this.capacity.playbackBusy = true;
    job.pending = this.work(job, parsed);
    return this.describe(job);
  }

  private async work(job: PlaybackJob, input: PlaybackInput): Promise<void> {
    let reader: BlobReadHandle | undefined;
    try {
      reader = await this.blobs.openRead(input.digest);
      const info = reader.info;
      if (!info.isFile() || info.size <= 0 || info.size > 512 * 1024 ** 2)
        throw new Error('invalid_media');
      job.release = await this.blobs.reserveTransient(this.maxBytes);
      job.abort.signal.throwIfAborted();
      await mkdir(job.dir, { mode: 0o700 });
      job.abort.signal.throwIfAborted();
      const result = await this.encode({
        input: blobPath(this.blobs.root, input.digest),
        output: job.output,
        audioTrimSeconds: input.audioTrimSeconds,
        maxBytes: this.maxBytes,
        signal: job.abort.signal,
        runtime: this.runtime,
        memoryBudget: Math.max(0, this.capacity.memory * 0.8 - (this.capacity.memoryUsed || 0)),
      });
      job.abort.signal.throwIfAborted();
      const bytes = (await stat(job.output)).size;
      if (!bytes || bytes > this.maxBytes) throw new Error('invalid_prepared_media');
      await chmod(job.output, 0o600);
      job.abort.signal.throwIfAborted();
      job.result = { ...result, digest: await cameraFileDigest(job.output), bytes, profile: 1 };
      job.state = 'ready';
      job.lastRead = this.now();
    } catch {
      job.state = 'failed';
      job.lastRead = this.now();
      await rm(job.dir, { recursive: true, force: true }).catch(() => {});
      job.release?.();
    } finally {
      try {
        await reader?.close();
      } finally {
        this.capacity.playbackBusy = false;
      }
    }
  }

  async remove(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    job.abort.abort();
    await job.pending;
    await rm(job.dir, { recursive: true, force: true });
    job.release?.();
    this.jobs.delete(id);
  }

  async prune(): Promise<void> {
    for (const job of this.jobs.values())
      if (!job.serving && this.now() - job.lastRead > (job.state === 'failed' ? 5000 : 900000))
        await this.remove(job.id);
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path === '/v1/playback' && req.method === 'POST') {
      const result = this.start(await body(req));
      json(res, result.status === 'ready' ? 200 : result.status === 'failed' ? 503 : 202, result);
      return true;
    }
    const match = /^\/v1\/playback\/([a-f0-9-]{36})(\/media)?$/.exec(path);
    if (!match) return false;
    const job = this.jobs.get(match[1]);
    if (!job) {
      json(res, 404, { error: 'not_found' });
      return true;
    }
    job.lastRead = this.now();
    if (!match[2] && req.method === 'DELETE') {
      await this.remove(job.id);
      json(res, 200, { deleted: true });
      return true;
    }
    if (!match[2] && req.method === 'GET') {
      json(
        res,
        job.state === 'failed' ? 503 : job.state === 'ready' ? 200 : 202,
        this.describe(job),
      );
      return true;
    }
    if (match[2] && req.method === 'GET') {
      if (job.state !== 'ready') {
        json(res, 409, { error: 'video_not_ready' });
        return true;
      }
      if (this.serving >= 2) {
        json(res, 503, { error: 'stream_busy' });
        return true;
      }
      job.serving = (job.serving || 0) + 1;
      this.serving++;
      const deadline = setTimeout(() => res.destroy(), 120000);
      deadline.unref();
      try {
        res.setTimeout(30000, () => res.destroy());
        const bytes = typeof job.result?.bytes === 'number' ? job.result.bytes : 0;
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': bytes,
          'Cache-Control': 'no-store',
        });
        await pipeMediaFile(job.output, res);
      } finally {
        clearTimeout(deadline);
        job.serving--;
        this.serving--;
      }
      return true;
    }
    return false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await Promise.all([...this.jobs.keys()].map((id) => this.remove(id)));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
