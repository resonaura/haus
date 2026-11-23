/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ChildProcess } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaRuntime } from '@haus/media/pipeline';
import { spawnHomeKitSnapshot, spawnMediaFrameSnapshot } from '@haus/media/stream';
import type { CameraSnapshot } from '../types.js';
import type { IntegratedCameraConfig } from './integrated.js';
import type { NativeCameraRuntime } from './runtime.js';
import type { CameraSnapshots, SnapshotCamera } from './snapshots.js';

const MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024;
const MIN_BUFFER_SEGMENT_BYTES = 4096;
export const SNAPSHOT_CACHE_FRESH_MS = 4_000;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);
const BUFFER_SEGMENT_NAME = /^(?:\d{8}T\d{6}|b\d{13}-[a-f0-9]{8}-\d{9,})\.mp4$/;

/** Extracts a complete JPEG frame bounded by SOI and EOI markers, or null if incomplete. */
export function extractCompleteJpeg(buffer: Buffer): Buffer | null {
  if (buffer.length < 4) return null;
  const start = buffer.indexOf(JPEG_SOI);
  if (start !== 0) return null;
  const end = buffer.lastIndexOf(JPEG_EOI);
  if (end < 2) return null;
  return buffer.subarray(0, end + JPEG_EOI.length);
}

function collectJpegFromProcess(
  child: ChildProcess,
  timeoutMs: number,
  errorPrefix: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore kill failure on exited child
      }
      finish(() => reject(new Error(`${errorPrefix}_timeout`)));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_SNAPSHOT_BYTES) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore kill failure on exited child
        }
        finish(() => reject(new Error(`${errorPrefix}_too_large`)));
        return;
      }
      chunks.push(chunk);
    });

    child.on('close', (code) => {
      const payload = Buffer.concat(chunks);
      const jpeg = extractCompleteJpeg(payload);
      if (jpeg && jpeg.length > 0) {
        finish(() => resolve(jpeg));
        return;
      }
      finish(() => reject(new Error(`${errorPrefix}_exit_${code ?? 'signal'}`)));
    });

    child.on('error', (err) => {
      finish(() => reject(err));
    });
  });
}

/** Captures a single low-latency JPEG snapshot from an RTSP stream. */
export async function captureRtspFrame(
  runtime: MediaRuntime,
  rtspUrl: string,
  timeoutMs = 15000,
): Promise<Buffer> {
  const child = spawnHomeKitSnapshot(runtime, rtspUrl, { lowLatency: true });
  return collectJpegFromProcess(child, timeoutMs, 'rtsp_snapshot');
}

/** Captures a JPEG frame from the newest finalized recording buffer segment on disk. */
export async function captureBufferFrame(
  runtime: MediaRuntime,
  bufferDir: string | undefined,
  timeoutMs = 8000,
): Promise<Buffer> {
  if (!bufferDir) throw new Error('buffer_unavailable');
  const names = (await readdir(bufferDir).catch(() => [] as string[])).filter((name) =>
    BUFFER_SEGMENT_NAME.test(name),
  );
  if (names.length === 0) throw new Error('buffer_empty');

  const stats = await Promise.all(
    names.map(async (name) => {
      const path = join(bufferDir, name);
      const info = await stat(path).catch(() => null);
      return info?.isFile() && info.size >= MIN_BUFFER_SEGMENT_BYTES
        ? { name, path, mtimeMs: info.mtimeMs }
        : null;
    }),
  );

  const candidates = stats
    .filter((entry): entry is { name: string; path: string; mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(0, 2);

  if (candidates.length === 0) throw new Error('buffer_empty');

  let lastError: unknown = new Error('buffer_snapshot_unavailable');
  for (const candidate of candidates) {
    try {
      const child = spawnMediaFrameSnapshot(runtime, candidate.path);
      return await collectJpegFromProcess(child, timeoutMs, 'buffer_snapshot');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** Captures a local JPEG snapshot from RTSP first, then falls back to the newest buffer segment. */
export async function captureLocalSnapshot(
  runtime: MediaRuntime,
  rtsp: string | undefined,
  bufferDir: string | undefined,
): Promise<{ mime: string; buffer: Buffer; at: number; stale: false } | null> {
  if (rtsp) {
    try {
      const buf = await captureRtspFrame(runtime, rtsp);
      if (buf.length > 0) return { mime: 'image/jpeg', buffer: buf, at: Date.now(), stale: false };
    } catch {
      // fall through to buffer/cached fallbacks
    }
  }
  if (bufferDir) {
    try {
      const buf = await captureBufferFrame(runtime, bufferDir);
      if (buf.length > 0) return { mime: 'image/jpeg', buffer: buf, at: Date.now(), stale: false };
    } catch {
      // fall through to cached fallback
    }
  }
  return null;
}

export interface CachedCameraSnapshot extends CameraSnapshot {
  checkedAt: number;
  background?: boolean;
}

export interface SnapshotLoadContext {
  cameraId: string;
  force: boolean;
  target: unknown;
  cam?: IntegratedCameraConfig;
  native: boolean;
  nativeCameras?: NativeCameraRuntime;
  snapshots?: CameraSnapshots;
  mediaRuntime: MediaRuntime;
  rtsp?: string;
  bufferDir?: string;
  hasStreamNodes: boolean;
  cached?: CachedCameraSnapshot;
  localSnapshotPreferredUntil: Map<string, number>;
}

async function tryClusterSnapshot(
  snapshots: CameraSnapshots | undefined,
  target: unknown,
): Promise<CameraSnapshot | null> {
  if (!snapshots) return null;
  try {
    const s = await snapshots.snapshot(target as unknown as SnapshotCamera);
    return { mime: s.mime, buffer: s.buffer, at: s.at, stale: s.stale };
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'snapshot_busy') throw err;
    return null;
  }
}

/** Loads a camera snapshot across integrated, native bridge, local RTSP/buffer, and cluster paths. */
export async function loadCameraSnapshot(ctx: SnapshotLoadContext): Promise<CameraSnapshot> {
  const {
    cameraId,
    force,
    target,
    cam,
    native,
    nativeCameras,
    snapshots,
    mediaRuntime,
    rtsp,
    bufferDir,
    hasStreamNodes,
    cached,
    localSnapshotPreferredUntil,
  } = ctx;

  let sourceFailed = false;
  if (cam?.snapshotFetch) {
    try {
      const buf = await cam.snapshotFetch();
      if (buf?.length) {
        const at = Date.now();
        await snapshots?.remember(cameraId, buf, at, false).catch(() => undefined);
        return { mime: 'image/jpeg', buffer: buf, at, stale: false };
      }
    } catch {
      sourceFailed = true;
    }
  }

  if (native && nativeCameras) {
    try {
      const snap = await nativeCameras.snapshot(cameraId);
      if (!snap.stale) {
        await snapshots?.remember(cameraId, snap.buffer, snap.at, false).catch(() => undefined);
      }
      return snap;
    } catch {
      sourceFailed = true;
    }
  }

  if (
    !force &&
    !sourceFailed &&
    cached &&
    !cached.stale &&
    Date.now() - cached.checkedAt < SNAPSHOT_CACHE_FRESH_MS
  ) {
    return { mime: cached.mime, buffer: cached.buffer, at: cached.at, stale: false };
  }

  const preferLocal =
    Boolean(rtsp || bufferDir) &&
    (!hasStreamNodes || (localSnapshotPreferredUntil.get(cameraId) ?? 0) > Date.now());

  if (preferLocal) {
    const local = await captureLocalSnapshot(mediaRuntime, rtsp, bufferDir);
    if (local) {
      await snapshots?.remember(cameraId, local.buffer, local.at, false).catch(() => undefined);
      return local;
    }
    const cluster = await tryClusterSnapshot(snapshots, target);
    if (cluster) {
      if (!cluster.stale) localSnapshotPreferredUntil.delete(cameraId);
      return cluster;
    }
  } else {
    const cluster = await tryClusterSnapshot(snapshots, target);
    if (cluster && !cluster.stale) return cluster;
    const local = await captureLocalSnapshot(mediaRuntime, rtsp, bufferDir);
    if (local) {
      localSnapshotPreferredUntil.set(cameraId, Date.now() + 5 * 60_000);
      await snapshots?.remember(cameraId, local.buffer, local.at, false).catch(() => undefined);
      return local;
    }
    if (cluster) return cluster;
  }

  if (cached) return { mime: cached.mime, buffer: cached.buffer, at: cached.at, stale: true };
  throw new Error('snapshot_unavailable');
}
