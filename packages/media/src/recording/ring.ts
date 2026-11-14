/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultMediaRuntime } from '../pipeline/tools.js';
import { MediaRuntime } from '../pipeline/tools.js';
import type { MediaRuntime as MediaRuntimeType } from '../pipeline/tools.js';
import { safeMediaError } from '../stream/native-args.js';
import {
  cameraMetadata,
  cameraProcess,
  type CameraMetadataResult,
  type CameraProcessOptions,
} from '../pipeline/process.js';
import { pruneRingStorage, readRingSegments } from './ring-files.js';
import {
  describeRecording,
  failRecording,
  finalizeRecording,
  reserveRecording,
  type CameraRecordingDescription,
  type CameraRecordingJob,
  type CameraRecordInput,
  type SegmentRow,
} from './recording.js';

export interface CameraRingOptions {
  spawnProcess?: typeof spawn;
  runtime?: MediaRuntimeType;
  now?: () => number;
  probe?: (file: string, options?: CameraProcessOptions) => Promise<CameraMetadataResult>;
  run?: typeof cameraProcess;
  maxBytes?: number;
  reserve?: (bytes: number) => Promise<() => void>;
  requireAudio?: boolean;
  recordAudio?: boolean;
  retentionSeconds?: number;
  readerStallMs?: number;
  acquireFinalizer?: () => (() => void) | undefined;
  onRecordingReady?: (job: CameraRecordingJob) => Promise<void>;
  onRecordingFailed?: (job: CameraRecordingJob, error: unknown) => void;
  log?: (event: string, payload: Record<string, unknown>) => void;
}

/** Stream-copy ring: one local consumer of a shared producer, no camera credentials in FFmpeg. */
export class CameraRing {
  root: string;
  input: string;
  spawnProcess: typeof spawn;
  runtime: MediaRuntimeType;
  private readonly readerRuntime: MediaRuntimeType;
  now: () => number;
  probe: (file: string, options?: CameraProcessOptions) => Promise<CameraMetadataResult>;
  run: typeof cameraProcess;
  maxBytes: number;
  reserve: (bytes: number) => Promise<() => void>;
  requireAudio: boolean;
  recordAudio: boolean;
  retentionSeconds: number;
  readerStallMs: number;
  acquireFinalizer: () => (() => void) | undefined;
  onRecordingReady: (job: CameraRecordingJob) => Promise<void>;
  onRecordingFailed: (job: CameraRecordingJob, error: unknown) => void;
  log: (event: string, payload: Record<string, unknown>) => void;

  abort = new AbortController();
  jobs = new Map<string, CameraRecordingJob>();
  segments: SegmentRow[] = [];
  runClocks = new Map<string, number>();

  startedAt = 0;
  runIndex = 0;
  failed = false;
  child?: ChildProcess;
  exit?: Promise<number | null>;
  readerRestarts = 0;
  segmentsInRun = 0;
  restartTimer?: NodeJS.Timeout;
  stallTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
  sampling?: Promise<void>;
  finalizing?: Promise<void>;
  latestName?: string;
  freshAt?: number;
  metadata?: CameraMetadataResult;
  metadataAt?: number;
  releaseRing?: () => void;

  constructor(root: string, input: string, options: CameraRingOptions = {}) {
    this.root = root;
    this.input = input;
    this.runtime = options.runtime ?? defaultMediaRuntime;
    this.readerRuntime = options.spawnProcess
      ? new MediaRuntime({
          tools: this.runtime.tools,
          spawnProcess: options.spawnProcess,
        })
      : this.runtime;
    this.spawnProcess = options.spawnProcess ?? this.runtime.spawnProcess;
    this.now = options.now ?? Date.now;
    this.probe =
      options.probe ??
      ((file, processOptions) =>
        cameraMetadata(file, { ...processOptions, runtime: this.runtime }));
    this.run =
      options.run ??
      ((file, args, processOptions) =>
        cameraProcess(file, args, { ...processOptions, runtime: this.runtime }));
    this.maxBytes = options.maxBytes ?? 64 * 1024 ** 2;
    this.reserve = options.reserve ?? (async () => () => {});
    this.requireAudio = options.requireAudio ?? true;
    this.recordAudio = options.recordAudio ?? true;
    this.retentionSeconds = options.retentionSeconds ?? 48;
    this.readerStallMs = options.readerStallMs ?? 15000;
    this.acquireFinalizer = options.acquireFinalizer ?? (() => () => {});
    this.onRecordingReady = options.onRecordingReady ?? (async () => {});
    this.onRecordingFailed = options.onRecordingFailed ?? (() => {});
    this.log = options.log ?? (() => {});
  }

  async start(): Promise<void> {
    this.releaseRing = await this.reserve(this.maxBytes);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    this.startedAt = this.now();
    this.runIndex = 0;
    this.startReader();
  }

  startReader(): void {
    if (this.abort.signal.aborted || this.failed) return;
    clearTimeout(this.stallTimer);
    this.stallTimer = undefined;
    clearTimeout(this.killTimer);
    this.killTimer = undefined;
    this.segmentsInRun = 0;
    const run = this.runIndex++;
    const runName = String(run).padStart(3, '0');
    const child = this.readerRuntime.spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-rtsp_transport',
        'tcp',
        '-timeout',
        '15000000',
        '-fflags',
        '+genpts+discardcorrupt',
        '-analyzeduration',
        '1000000',
        '-probesize',
        '1000000',
        '-i',
        this.input,
        '-map',
        '0:v:0',
        ...(this.recordAudio ? ['-map', '0:a?'] : ['-an']),
        '-c',
        'copy',
        '-copyinkf:a',
        '-f',
        'segment',
        '-segment_format',
        'mpegts',
        '-segment_time',
        '2',
        '-reset_timestamps',
        '1',
        '-segment_list',
        join(this.root, `segments-${runName}.csv`),
        '-segment_list_type',
        'csv',
        '-segment_list_size',
        '64',
        join(this.root, `${runName}%09d.ts`),
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4096);
    });
    this.child = child;
    this.exit = new Promise((resolve) => child.once('close', resolve));
    this.armStallTimer(child, run);
    child.on('error', (error: Error) => {
      const code = 'code' in error && typeof error.code === 'string' ? error.code : 'unknown';
      this.log('camera_ring_reader_error', { run, code });
    });
    child.once('close', () => {
      if (this.child === child) {
        this.child = undefined;
        clearTimeout(this.stallTimer);
        this.stallTimer = undefined;
        clearTimeout(this.killTimer);
        this.killTimer = undefined;
      }
      if (this.abort.signal.aborted || this.failed) return;
      const detail = safeMediaError(stderr);
      if (detail) this.log('camera_ring_reader_closed', { run, detail });
      this.scheduleReaderRestart();
    });
  }

  private armStallTimer(
    child: ChildProcess | undefined = this.child,
    run = this.runIndex - 1,
  ): void {
    clearTimeout(this.stallTimer);
    this.stallTimer = undefined;
    if (!child || child.exitCode !== null || this.abort.signal.aborted || this.failed) return;
    if (!(this.readerStallMs > 0 && Number.isFinite(this.readerStallMs))) return;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = undefined;
      if (
        this.child !== child ||
        child.exitCode !== null ||
        this.abort.signal.aborted ||
        this.failed
      )
        return;
      this.log('camera_ring_reader_stalled', { run });
      child.kill('SIGTERM');
      this.killTimer = setTimeout(() => {
        if (this.child === child && child.exitCode === null) child.kill('SIGKILL');
      }, 1500);
      this.killTimer.unref?.();
    }, this.readerStallMs);
    this.stallTimer.unref?.();
  }

  scheduleReaderRestart(): void {
    if (this.restartTimer || this.abort.signal.aborted || this.failed) return;
    const delay = Math.min(15000, 500 * 2 ** Math.min(this.readerRestarts ?? 0, 5));
    this.readerRestarts = (this.readerRestarts ?? 0) + 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.startReader();
    }, delay);
    this.restartTimer.unref?.();
  }

  async sample(): Promise<void> {
    if (this.sampling) return this.sampling;
    this.sampling = this.collect().finally(() => {
      this.sampling = undefined;
    });
    return this.sampling;
  }

  async collect(): Promise<void> {
    if (this.abort.signal.aborted) return;
    const { entries, rows } = await readRingSegments(this.root, this.runClocks);
    this.segments = rows;
    const latest = rows.at(-1);
    if (latest) {
      if (latest.name !== this.latestName) {
        this.latestName = latest.name;
        this.segmentsInRun++;
        if (this.segmentsInRun >= 2) this.readerRestarts = 0;
        this.armStallTimer();
        if (latest.info) {
          this.freshAt = latest.info.mtimeMs;
          if (!this.metadata || this.now() - (this.metadataAt ?? 0) > 5000) {
            this.metadata = await this.probe(join(this.root, latest.name), {
              signal: this.abort.signal,
            }).catch(() => undefined);
            this.metadataAt = this.now();
          }
        }
      }
      for (const job of this.jobs.values()) {
        if (job.state !== 'recording') continue;
        for (const part of this.segments) {
          if (part.endAt <= job.startAt || part.startAt >= job.endAt || job.parts.has(part.name)) {
            continue;
          }
          const target = join(job.root, part.name);
          const info = await stat(join(this.root, part.name)).catch(() => null);
          if (!info || info.size <= 0) continue;
          try {
            await reserveRecording(job, job.bytes + info.size, this.reserve, this.abort.signal);
            await copyFile(join(this.root, part.name), target);
            job.parts.set(part.name, part);
            job.bytes += info.size;
          } catch (error) {
            await failRecording(job, 'capture', error, this);
            break;
          }
        }
        if (job.state !== 'recording') continue;
        const tailReady = [...job.parts.values()].some((part) => part.endAt >= job.endAt - 500);
        if (
          this.now() >= job.endAt + 2500 &&
          (tailReady || this.now() >= job.endAt + 15000) &&
          !this.finalizing
        ) {
          const release = this.acquireFinalizer();
          if (release) {
            this.finalizing = finalizeRecording(job, this).finally(() => {
              this.finalizing = undefined;
              release();
            });
            void this.finalizing.catch(() => {});
          }
        }
      }
    }
    const { retained, ringBytes } = await pruneRingStorage({
      root: this.root,
      entries,
      rows,
      jobs: this.jobs.values(),
      retentionSeconds: this.retentionSeconds,
      maxBytes: this.maxBytes,
      now: this.now(),
      latestName: this.latestName,
    });
    this.segments = retained;
    if (ringBytes > this.maxBytes * 1.1) {
      this.failed = true;
      clearTimeout(this.stallTimer);
      this.stallTimer = undefined;
      this.child?.kill('SIGTERM');
      return;
    }
    for (const job of this.jobs.values()) {
      if (
        (job.state === 'ready' || job.state === 'failed') &&
        this.now() - job.createdAt > 900000
      ) {
        await this.removeRecording(job.id);
      }
    }
  }

  ready(): boolean {
    return (
      !this.failed &&
      this.metadata?.video === true &&
      (!this.requireAudio || !this.recordAudio || this.metadata.audio === true) &&
      this.now() - (this.metadataAt ?? 0) < 10000 &&
      this.now() - (this.freshAt ?? 0) < 10000
    );
  }

  async record(input: CameraRecordInput): Promise<CameraRecordingDescription> {
    const { eventId, startAt, endAt } = input;
    if (
      !/^[a-f0-9-]{36}$/.test(eventId) ||
      !Number.isSafeInteger(startAt) ||
      !Number.isSafeInteger(endAt) ||
      endAt <= startAt ||
      endAt - startAt > 330000 ||
      startAt > this.now() + 5000 ||
      startAt < this.now() - 330000 ||
      endAt > this.now() + 330000
    ) {
      throw new Error('invalid_camera_recording');
    }
    let job = this.jobs.get(eventId);
    if (job) {
      if (job.state === 'recording') {
        if (Math.max(job.endAt, endAt) - Math.min(job.startAt, startAt) > 330000) {
          throw new Error('invalid_camera_recording');
        }
        job.startAt = Math.min(job.startAt, startAt);
        job.endAt = Math.max(job.endAt, endAt);
        if (input.metadata) job.metadata = input.metadata;
      }
      return describeRecording(job);
    }
    if (!this.ready()) throw new Error('camera_ring_not_ready');
    if (
      [...this.jobs.values()].filter(
        (row) => row.state === 'recording' || row.state === 'preparing',
      ).length >= 2 ||
      this.jobs.size >= 16
    ) {
      throw new Error('camera_recording_busy');
    }
    const root = join(this.root, `event-${eventId}`);
    const maxBytes = 512 * 1024 ** 2;
    job = {
      id: eventId,
      root,
      startAt,
      endAt,
      state: 'recording',
      parts: new Map(),
      createdAt: this.now(),
      bytes: 0,
      maxBytes,
      capacity: 0,
      reservations: [],
      metadata: input.metadata,
    };
    job.release = () => {
      for (const release of job.reservations.splice(0)) release();
      job.capacity = 0;
    };
    try {
      await reserveRecording(job, 1, this.reserve, this.abort.signal);
      await mkdir(root, { mode: 0o700 });
    } catch (error) {
      job.release();
      throw error;
    }
    this.jobs.set(eventId, job);
    await this.sample();
    return describeRecording(job);
  }

  async removeRecording(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job || job.state === 'preparing') return;
    this.jobs.delete(id);
    await rm(job.root, { recursive: true, force: true });
    job.release?.();
  }

  async stop(): Promise<void> {
    this.abort.abort();
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    clearTimeout(this.stallTimer);
    this.stallTimer = undefined;
    clearTimeout(this.killTimer);
    this.killTimer = undefined;
    if (this.child && this.child.exitCode === null) {
      this.child.kill('SIGTERM');
      const kill = setTimeout(() => this.child?.kill('SIGKILL'), 1500);
      await this.exit;
      clearTimeout(kill);
    }
    await Promise.allSettled([this.sampling, this.finalizing]);
    for (const job of this.jobs.values()) {
      if (job.state === 'recording' || job.state === 'preparing') {
        try {
          this.onRecordingFailed(job, new Error('node_stopped'));
        } catch {
          /* Preserve shutdown. */
        }
      }
      job.release?.();
    }
    this.releaseRing?.();
    await rm(this.root, { recursive: true, force: true });
  }
}
