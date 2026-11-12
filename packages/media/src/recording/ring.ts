/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultMediaRuntime } from '../pipeline/tools.js';
import { MediaRuntime } from '../pipeline/tools.js';
import type { MediaRuntime as MediaRuntimeType } from '../pipeline/tools.js';
import {
  cameraMetadata,
  cameraProcess,
  type CameraMetadataResult,
  type CameraProcessOptions,
} from '../pipeline/process.js';
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
  restartTimer?: NodeJS.Timeout;
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
        '+genpts',
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
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
    this.child = child;
    this.exit = new Promise((resolve) => child.once('close', resolve));
    child.on('error', (error: Error) => {
      const code = 'code' in error && typeof error.code === 'string' ? error.code : 'unknown';
      this.log('camera_ring_reader_error', { run, code });
    });
    child.once('close', () => {
      if (this.child === child) this.child = undefined;
      if (this.abort.signal.aborted || this.failed) return;
      this.scheduleReaderRestart();
    });
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
    let ringBytes = 0;
    const entries = await readdir(this.root).catch(() => [] as string[]);
    for (const name of entries) {
      if (/^(?:\d{9}|\d{12,})\.ts$/.test(name)) {
        ringBytes += (await stat(join(this.root, name)).catch(() => null))?.size ?? 0;
      }
    }
    if (ringBytes > this.maxBytes * 1.1) {
      this.failed = true;
      this.child?.kill('SIGTERM');
      return;
    }
    const names = await readdir(this.root).catch(() => [] as string[]);
    const lists = names.filter((name) => /^segments(?:-\d{3})?\.csv$/.test(name));
    const rows: SegmentRow[] = [];
    for (const list of lists) {
      const csv = await readFile(join(this.root, list), 'utf8').catch(() => '');
      for (const line of csv.split('\n')) {
        const match = /^(?:"?)(?:[^",]*\/)?((?:\d{9}|\d{12,})\.ts)(?:"?),([\d.]+),([\d.]+)$/.exec(
          line,
        );
        if (!match) continue;
        const from = Number(match[2]);
        const to = Number(match[3]);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 30) {
          continue;
        }
        const info = await stat(join(this.root, match[1])).catch(() => null);
        if (!info) continue;
        rows.push({
          name: match[1],
          from,
          to,
          info,
          run: list,
          startAt: 0,
          endAt: 0,
        });
      }
    }
    const activeRuns = new Set(rows.map((row) => row.run));
    for (const run of this.runClocks.keys()) {
      if (!activeRuns.has(run)) this.runClocks.delete(run);
    }
    for (const row of [...rows].sort((a, b) => a.from - b.from)) {
      if (!this.runClocks.has(row.run) && row.info) {
        this.runClocks.set(row.run, row.info.mtimeMs - row.to * 1000);
      }
    }
    for (const row of rows) {
      const origin = this.runClocks.get(row.run) ?? 0;
      row.startAt = origin + row.from * 1000;
      row.endAt = origin + row.to * 1000;
    }
    rows.sort((a, b) => a.startAt - b.startAt || a.name.localeCompare(b.name));
    const latest = rows.at(-1);
    if (!latest) return;
    if (latest.name !== this.latestName) {
      this.latestName = latest.name;
      this.readerRestarts = 0;
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
    this.segments = rows;
    for (const job of this.jobs.values()) {
      if (job.state !== 'recording') continue;
      for (const part of this.segments) {
        if (part.endAt <= job.startAt || part.startAt >= job.endAt || job.parts.has(part.name)) {
          continue;
        }
        const target = join(job.root, part.name);
        const info = await stat(join(this.root, part.name)).catch(() => null);
        if (!info) continue;
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
    let bytes = 0;
    for (const part of [...this.segments].reverse()) {
      const file = join(this.root, part.name);
      const info = await stat(file).catch(() => null);
      bytes += info?.size ?? 0;
      if (this.now() - part.endAt > this.retentionSeconds * 1000 || bytes > this.maxBytes) {
        await rm(file, { force: true });
      }
    }
    const retained = new Set(this.segments.map((part) => part.name));
    for (const name of await readdir(this.root).catch(() => [] as string[])) {
      if (/^(?:\d{9}|\d{12,})\.ts$/.test(name) && !retained.has(name) && name !== this.latestName) {
        const file = join(this.root, name);
        const info = await stat(file).catch(() => null);
        if (info && this.now() - info.mtimeMs > 10000) {
          await rm(file, { force: true });
        }
      }
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
