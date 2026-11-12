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
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { CAMERA_SERVICE } from '../camera/tokens.js';
import type { CameraService } from '../camera/types.js';

interface ActiveHlsJob {
  child: ChildProcess;
  dir: string;
  lastAccess: number;
}

@Injectable()
export class DefaultStreamService implements StreamService, OnModuleDestroy {
  private readonly validTokens = new Set<string>();
  private readonly jobs = new Map<string, ActiveHlsJob>();
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(
    @Optional()
    @Inject(CAMERA_SERVICE)
    private readonly cameraService?: CameraService,
  ) {
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, j] of this.jobs) {
        if (now - j.lastAccess > 60000 || j.child.exitCode !== null) {
          try {
            j.child.kill('SIGTERM');
          } catch {}
          void rm(j.dir, { recursive: true, force: true }).catch(() => {});
          this.jobs.delete(id);
        }
      }
    }, 10000);
    this.pruneTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.pruneTimer);
    for (const j of this.jobs.values()) {
      try {
        j.child.kill('SIGKILL');
      } catch {}
      void rm(j.dir, { recursive: true, force: true }).catch(() => {});
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

  async getLivePlaylist(cameraId: string): Promise<StreamSourceResult> {
    if (!cameraId) return { status: 404 };
    let job = this.jobs.get(cameraId);
    if (!job || job.child.exitCode !== null) {
      const rtsp =
        this.cameraService?.getCameraRtsp?.(cameraId) ??
        (cameraId === 'camera.outdoor_camera'
          ? process.env.HAUS_AQARA_OUTDOOR_RTSP
          : cameraId === 'camera.guinea_pigs_camera'
            ? process.env.HAUS_AQARA_GUINEA_RTSP
            : undefined);
      if (rtsp) {
        const safeId = cameraId.replace(/[^a-z0-9_]/gi, '_');
        const dir = join(tmpdir(), `haus-hls-${safeId}`);
        await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {});
        const child = spawnCameraHls(defaultMediaRuntime, rtsp, dir);
        job = { child, dir, lastAccess: Date.now() };
        this.jobs.set(cameraId, job);
        for (let i = 0; i < 35; i++) {
          await new Promise((r) => setTimeout(r, 100));
          const ready = await stat(join(dir, 'index.m3u8')).catch(() => null);
          if (ready) break;
        }
      }
    }
    if (job) {
      job.lastAccess = Date.now();
      try {
        const content = await readFile(join(job.dir, 'index.m3u8'), 'utf-8');
        return {
          status: 200,
          mime: 'application/vnd.apple.mpegurl',
          body: content,
          headers: { 'Cache-Control': 'no-cache, no-store' },
        };
      } catch {}
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
    if (job && /^[a-zA-Z0-9_-]+\.ts$/.test(segment)) {
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
      } catch {}
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
