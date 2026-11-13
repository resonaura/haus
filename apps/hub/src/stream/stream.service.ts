/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import type { StreamService, StreamSourceResult } from './types.js';
import { rewritePlaylist } from './playlist.js';
import { spawnCameraHls } from '@haus/media/stream';
import { defaultMediaRuntime } from '@haus/media';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { CAMERA_SERVICE } from '../camera/tokens.js';
import type { CameraService } from '../camera/types.js';

interface ActiveHlsJob {
  child: ChildProcess;
  dir: string;
  lastAccess: number;
  stopping: boolean;
  killTimer?: NodeJS.Timeout;
}

@Injectable()
export class DefaultStreamService implements StreamService, OnModuleDestroy {
  private readonly validTokens = new Set<string>();
  private readonly jobs = new Map<string, ActiveHlsJob>();
  private readonly starting = new Map<string, Promise<ActiveHlsJob | null>>();
  private readonly pruneTimer: NodeJS.Timeout;
  private stopped = false;

  constructor(
    @Optional()
    @Inject(CAMERA_SERVICE)
    private readonly cameraService?: CameraService,
  ) {
    this.cameraService?.setStreamWarmer?.((cameraId, active) => this.warmLive(cameraId, active));
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, j] of this.jobs) {
        if (now - j.lastAccess > 60000 || j.child.exitCode !== null) {
          this.jobs.delete(id);
          this.stopJob(j);
        }
      }
    }, 10000);
    this.pruneTimer.unref();
  }

  private stopJob(job: ActiveHlsJob, force = false): void {
    job.stopping = true;
    if (job.killTimer) {
      clearTimeout(job.killTimer);
      job.killTimer = undefined;
    }
    if (job.child.exitCode !== null || job.child.killed) {
      void rm(job.dir, { recursive: true, force: true }).catch(() => {});
      return;
    }
    try {
      job.child.kill(force ? 'SIGKILL' : 'SIGTERM');
    } catch {}
    if (!force) {
      job.killTimer = setTimeout(() => {
        job.killTimer = undefined;
        try {
          if (job.child.exitCode === null) job.child.kill('SIGKILL');
        } catch {}
      }, 2000);
      job.killTimer.unref();
    }
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearInterval(this.pruneTimer);
    for (const j of this.jobs.values()) {
      this.stopJob(j, true);
    }
    this.jobs.clear();
  }

  addValidToken(token: string): void {
    if (token.trim()) {
      this.validTokens.add(token.trim());
    }
  }

  registerToken(token: string): void {
    this.addValidToken(token);
  }

  async getSource(token: string, resource: string): Promise<StreamSourceResult> {
    if (!this.validTokens.has(token)) {
      return { status: 404 };
    }

    if (resource.endsWith('.m3u8')) {
      const rawPlaylist = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:2',
        '#EXT-X-MEDIA-SEQUENCE:10',
        '#EXTINF:2.0,',
        'segment-10.ts',
        '#EXTINF:2.0,',
        'segment-11.ts',
      ].join('\n');

      const rewritten = rewritePlaylist(rawPlaylist, `/cluster/source/${token}`);
      return {
        status: 200,
        mime: 'application/vnd.apple.mpegurl',
        body: rewritten,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      };
    }

    if (resource.endsWith('.ts')) {
      const dummyTsPacket = Buffer.alloc(188, 0x00);
      dummyTsPacket[0] = 0x47;
      return {
        status: 200,
        mime: 'video/MP2T',
        body: dummyTsPacket,
        headers: {
          'Cache-Control': 'public, max-age=86400',
        },
      };
    }

    return { status: 404 };
  }

  private resolveRtsp(cameraId: string): string | undefined {
    return (
      this.cameraService?.getCameraRtsp?.(cameraId) ??
      (cameraId === 'camera.outdoor_camera'
        ? process.env.HAUS_AQARA_OUTDOOR_RTSP
        : cameraId === 'camera.guinea_pigs_camera'
          ? process.env.HAUS_AQARA_GUINEA_RTSP
          : undefined)
    );
  }

  async warmLive(cameraId: string, active: boolean): Promise<boolean> {
    if (!cameraId || this.stopped) return false;
    const rtsp = this.resolveRtsp(cameraId);
    if (!rtsp) return false;
    if (!active) {
      const job = this.jobs.get(cameraId);
      if (job) job.lastAccess = Math.min(job.lastAccess, Date.now() - 45000);
      return true;
    }
    const existing = this.jobs.get(cameraId);
    if (existing && existing.child.exitCode === null && !existing.stopping) {
      existing.lastAccess = Date.now();
      return true;
    }
    void this.ensureHlsJob(cameraId, rtsp).catch(() => {});
    return true;
  }

  private async ensureHlsJob(cameraId: string, rtsp: string): Promise<ActiveHlsJob | null> {
    if (this.stopped) return null;
    const existing = this.jobs.get(cameraId);
    if (existing && existing.child.exitCode === null && !existing.stopping) {
      existing.lastAccess = Date.now();
      return existing;
    }
    const pending = this.starting.get(cameraId);
    if (pending) return pending;

    const startTask = (async (): Promise<ActiveHlsJob | null> => {
      if (existing) {
        if (this.jobs.get(cameraId) === existing) this.jobs.delete(cameraId);
        this.stopJob(existing);
      }
      if (this.stopped) return null;
      const safeId = cameraId.replace(/[^a-z0-9_]/gi, '_');
      const dir = await mkdtemp(join(tmpdir(), `haus-hls-${safeId}-`));
      const child = spawnCameraHls(defaultMediaRuntime, rtsp, dir, { stderrPipe: true });
      let stderrTail = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-512);
      });
      const job: ActiveHlsJob = { child, dir, lastAccess: Date.now(), stopping: false };
      child.once('exit', (code, signal) => {
        if (
          !job.stopping &&
          !this.stopped &&
          code &&
          code !== 0 &&
          signal !== 'SIGTERM' &&
          signal !== 'SIGKILL'
        ) {
          console.warn(
            `[StreamService] HLS FFmpeg exited (${code}) for ${cameraId}: ${stderrTail.trim()}`,
          );
        }
      });
      child.once('close', () => {
        if (job.killTimer) {
          clearTimeout(job.killTimer);
          job.killTimer = undefined;
        }
        if (this.jobs.get(cameraId) === job) {
          this.jobs.delete(cameraId);
        }
        void rm(job.dir, { recursive: true, force: true }).catch(() => {});
      });
      if (this.stopped) {
        this.stopJob(job, true);
        return null;
      }
      this.jobs.set(cameraId, job);
      return job;
    })().finally(() => {
      if (this.starting.get(cameraId) === startTask) {
        this.starting.delete(cameraId);
      }
    });

    this.starting.set(cameraId, startTask);
    return startTask;
  }

  async getLivePlaylist(cameraId: string): Promise<StreamSourceResult> {
    if (!cameraId) return { status: 404 };
    const rtsp = this.resolveRtsp(cameraId);
    if (rtsp) {
      const job = await this.ensureHlsJob(cameraId, rtsp);
      if (job) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          if (this.jobs.get(cameraId) !== job || job.stopping || job.child.exitCode !== null) {
            break;
          }
          job.lastAccess = Date.now();
          const content = await readFile(join(job.dir, 'index.m3u8'), 'utf-8').catch(() => '');
          if (content.includes('#EXTM3U') && /\.ts\b/.test(content)) {
            job.lastAccess = Date.now();
            return {
              status: 200,
              mime: 'application/vnd.apple.mpegurl',
              body: content,
              headers: { 'Cache-Control': 'no-cache, no-store' },
            };
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        if (job.child.exitCode !== null && this.jobs.get(cameraId) === job) {
          this.jobs.delete(cameraId);
          void rm(job.dir, { recursive: true, force: true }).catch(() => {});
        }
      }
      return {
        status: 503,
        mime: 'text/plain',
        body: 'Stream unavailable',
        headers: { 'Cache-Control': 'no-cache, no-store' },
      };
    }

    if (this.cameraService) {
      return {
        status: 404,
        mime: 'text/plain',
        body: 'Stream unavailable',
        headers: { 'Cache-Control': 'no-cache, no-store' },
      };
    }

    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:2',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXTINF:2.0,',
      `segment-0.ts`,
      '#EXTINF:2.0,',
      `segment-1.ts`,
    ].join('\n');

    return {
      status: 200,
      mime: 'application/vnd.apple.mpegurl',
      body: playlist,
      headers: {
        'Cache-Control': 'no-cache',
      },
    };
  }

  async getLiveSegment(cameraId: string, segment: string): Promise<StreamSourceResult> {
    if (!cameraId || !segment) return { status: 404 };
    const job = this.jobs.get(cameraId);
    if (job && !job.stopping && /^[a-zA-Z0-9_-]+\.ts$/.test(segment)) {
      job.lastAccess = Date.now();
      try {
        const file = join(job.dir, segment);
        const buf = await readFile(file);
        return {
          status: 200,
          mime: 'video/MP2T',
          body: buf,
          headers: {
            'Cache-Control': 'public, max-age=86400',
          },
        };
      } catch {
        return { status: 404 };
      }
    }

    if (this.resolveRtsp(cameraId) || this.cameraService) {
      return { status: 404 };
    }

    const tsPacket = Buffer.alloc(188, 0x00);
    tsPacket[0] = 0x47;
    return {
      status: 200,
      mime: 'video/MP2T',
      body: tsPacket,
      headers: {
        'Cache-Control': 'public, max-age=86400',
      },
    };
  }
}
