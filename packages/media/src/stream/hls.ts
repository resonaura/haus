/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { defaultMediaRuntime, MediaRuntime } from '../pipeline/tools.js';
import type { MediaRuntime as MediaRuntimeType } from '../pipeline/tools.js';
import { safeMediaError } from './native-args.js';

export interface HlsStreamJob {
  id: string;
  dir: string;
  lastRead: number;
  state: 'starting' | 'ready' | 'stopped' | 'failed';
  child?: ChildProcess;
  lastError?: string;
}

export interface HlsStreamsOptions {
  max?: number;
  spawnProcess?: typeof spawn;
  runtime?: MediaRuntimeType;
  now?: () => number;
  report?: (reason: unknown) => void;
}

/** Owns bounded FFmpeg HLS relays and serves their generated media files. */
export class HlsStreams {
  readonly jobs = new Map<string, HlsStreamJob>();
  capacity: () => number;
  private stopped = false;
  private pruning = false;
  private timer?: NodeJS.Timeout;
  private readonly runtime: MediaRuntimeType;
  private readonly now: () => number;
  private readonly report: (reason: unknown) => void;

  constructor(
    readonly root: string,
    readonly origin: string,
    {
      max = 4,
      spawnProcess,
      runtime = defaultMediaRuntime,
      now = Date.now,
      report = (reason) => process.emitWarning(`media stream cleanup failed: ${String(reason)}`),
    }: HlsStreamsOptions = {},
  ) {
    this.capacity = () => max;
    this.runtime = spawnProcess
      ? new MediaRuntime({ tools: runtime.tools, spawnProcess })
      : runtime;
    this.now = now;
    this.report = report;
  }

  async initialize(): Promise<this> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.root))
      if (/^[a-f0-9-]{36}$/.test(name))
        await rm(join(this.root, name), { recursive: true, force: true });
    if (!this.timer) {
      this.timer = setInterval(() => void this.prune().catch(this.report), 5000);
      this.timer.unref();
    }
    return this;
  }

  get size(): number {
    return this.jobs.size;
  }

  async start(source: string): Promise<{ id: string }> {
    if (!this.origin || this.stopped) throw new Error('stream_busy');
    if (this.jobs.size >= this.capacity()) await this.prune();
    if (this.stopped || this.jobs.size >= this.capacity()) throw new Error('stream_busy');
    const url = parseSource(source, this.origin);
    const id = randomUUID();
    const dir = join(this.root, id);
    const job: HlsStreamJob = { id, dir, lastRead: this.now(), state: 'starting' };
    this.jobs.set(id, job);
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      if (this.stopped || this.jobs.get(id) !== job) throw new Error('stream_stopped');
      const child = this.runtime.spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-rw_timeout',
          '15000000',
          '-fflags',
          '+genpts+discardcorrupt',
          '-live_start_index',
          '-1',
          '-re',
          '-protocol_whitelist',
          'http,https,tcp,tls,crypto',
          '-i',
          url.href,
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-threads',
          '2',
          '-f',
          'hls',
          '-hls_time',
          '2',
          '-hls_list_size',
          '6',
          '-hls_delete_threshold',
          '2',
          '-hls_flags',
          'delete_segments+independent_segments',
          '-hls_segment_filename',
          join(dir, 'segment-%09d.ts'),
          join(dir, 'index.m3u8'),
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      job.child = child;
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr = `${stderr}${String(chunk)}`.slice(-4096);
      });
      child.on('error', () => {
        job.lastError = safeMediaError(stderr) || undefined;
        job.state = 'failed';
      });
      child.on('exit', () => {
        job.lastError = safeMediaError(stderr) || undefined;
        job.state = 'stopped';
      });
      const end = this.now() + 12000;
      while (this.now() < end) {
        if (
          job.state === 'failed' ||
          job.state === 'stopped' ||
          this.stopped ||
          this.jobs.get(id) !== job
        )
          throw new Error('stream_unavailable');
        if (await stat(join(dir, 'index.m3u8')).catch(() => null)) {
          job.state = 'ready';
          return { id };
        }
        await new Promise((wait) => setTimeout(wait, 100));
      }
      throw new Error('stream_timeout');
    } catch (error) {
      await this.remove(id);
      throw error;
    }
  }

  async serve(id: string, name: string, res: ServerResponse): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job || !/^(?:index\.m3u8|segment-\d+\.ts)$/.test(name)) return false;
    if ((job.state === 'failed' || job.state === 'stopped') && name === 'index.m3u8') return false;
    job.lastRead = this.now();
    const file = join(job.dir, name);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return false;
    res.writeHead(200, {
      'Content-Type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    await pipeline(createReadStream(file), res).catch(() => {});
    return true;
  }

  async remove(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    if (job.child && job.child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          job.child?.kill('SIGKILL');
        }, 1500);
        timer.unref();
        job.child?.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        job.child?.kill('SIGTERM');
      });
    }
    await rm(job.dir, { recursive: true, force: true });
  }

  async prune(): Promise<void> {
    if (this.pruning) return;
    this.pruning = true;
    try {
      for (const job of this.jobs.values()) {
        let bytes = 0;
        for (const file of await readdir(job.dir).catch(() => []))
          bytes += (await stat(join(job.dir, file)).catch(() => null))?.size ?? 0;
        const playlist =
          job.state === 'ready'
            ? await stat(join(job.dir, 'index.m3u8')).catch(() => null)
            : undefined;
        if (
          (job.state === 'ready' && (!playlist || this.now() - playlist.mtimeMs > 30000)) ||
          (job.state === 'starting' && this.now() - job.lastRead > 20000) ||
          this.now() - job.lastRead > 90000 ||
          bytes > 64 * 1024 ** 2 ||
          ['stopped', 'failed'].includes(job.state)
        )
          await this.remove(job.id);
      }
    } finally {
      this.pruning = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.jobs.keys()].map((id) => this.remove(id)));
  }
}

function parseSource(source: string, origin: string): URL {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error('invalid_stream_source');
  }
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/cluster\/source\/[a-f0-9]{48}\/[A-Za-z0-9_-]+(?:\.(?:m3u8|ts|m4s|mp4|aac|key))?$/.test(
      url.pathname,
    )
  )
    throw new Error('invalid_stream_source');
  return url;
}
