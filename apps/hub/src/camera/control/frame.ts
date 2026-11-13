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

const MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024;
const MIN_BUFFER_SEGMENT_BYTES = 4096;
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
