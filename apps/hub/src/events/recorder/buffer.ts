/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, statfs, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { RecordingProgress, spawnRecordingCapture } from '@haus/media/recording';
import type { EventRecord } from '../recording.types.js';
import { sourceHasAudio } from './compatible.js';
import type { PrimarySourceRecovery } from './recovery.js';
import { parseSegments } from './segments.js';
import type {
  RecorderBuffer,
  RecorderCamera,
  RecorderCapturePort,
  RecorderConfig,
  RecorderHaPort,
  RecorderStore,
} from './types.js';

const MAX_ASSIST_DELAY_MS = 30_000;

const sanitizeCaptureError = (value: string): string =>
  value
    .replace(/rtsps?:\/\/[^\s'"<>]+/gi, '[redacted RTSP URL]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted IP]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-320);

export interface BufferRuntimeContext {
  readonly config: RecorderConfig;
  readonly ha: RecorderHaPort;
  readonly store: RecorderStore;
  readonly capture?: RecorderCapturePort;
  readonly useCapture?: boolean;
  readonly primaryRecovery: PrimarySourceRecovery;
  readonly buffers: Map<string, RecorderBuffer>;
  readonly active: Map<string, EventRecord>;
  readonly playbackAbort: AbortController;
  readonly cameras?: readonly RecorderCamera[];
  readonly stopped: boolean;
  onChange(): void;
  terminateBuffer(buffer: RecorderBuffer): void;
  startBuffer(buffer: RecorderBuffer): Promise<void>;
}

export function terminateCaptureBuffer(buffer: RecorderBuffer): void {
  const child = buffer.process;
  if (!child || buffer.killTimer) return;
  child.kill('SIGTERM');
  buffer.killTimer = setTimeout(() => {
    if (buffer.process === child) child.kill('SIGKILL');
  }, 3000);
  buffer.killTimer.unref();
  child.once('close', () => {
    clearTimeout(buffer.killTimer);
    buffer.killTimer = undefined;
  });
}

export function startCaptureBuffer(
  ctx: BufferRuntimeContext,
  buffer: RecorderBuffer,
): Promise<void> {
  clearTimeout(buffer.retry);
  buffer.retry = undefined;
  if (ctx.stopped || buffer.stopped || buffer.process) return Promise.resolve();
  if (buffer.starting) return buffer.starting;
  const task = runCaptureBufferStart(ctx, buffer).finally(() => {
    if (buffer.starting === task) buffer.starting = undefined;
  });
  buffer.starting = task;
  return task;
}

async function runCaptureBufferStart(
  ctx: BufferRuntimeContext,
  buffer: RecorderBuffer,
): Promise<void> {
  if (ctx.stopped || buffer.stopped || buffer.process) return;
  try {
    const available = await statfs(ctx.config.media);
    if (available.bavail * available.bsize < 256 * 1024 ** 2) {
      throw new Error('insufficient_storage');
    }
    await mkdir(buffer.dir, { recursive: true, mode: 0o700 });
    const camera = ctx.cameras?.find((item) => item.id === buffer.id) ?? {
      id: buffer.id,
    };
    const allowDirect =
      (buffer.directFailures ?? 0) < 3 || Date.now() - (buffer.directAttempt ?? 0) > 300000;
    const input = ctx.ha.recordingInput
      ? await ctx.ha.recordingInput(camera, allowDirect)
      : {
          url: await ctx.ha.stream!(buffer.id),
          kind: 'ha',
          token: ctx.config.token ?? undefined,
          inputArguments: ['-live_start_index', '-1', '-re'],
        };
    if (input.kind === 'rtsp') buffer.directAttempt = Date.now();
    buffer.inputKind = input.kind;
    if (ctx.stopped || buffer.stopped) return;
    if (ctx.config.record_audio) {
      const abort = new AbortController();
      buffer.probeAbort = abort;
      buffer.expectedAudio = await sourceHasAudio(
        input.url,
        input.token,
        AbortSignal.any([abort.signal, ctx.playbackAbort.signal]),
        input.inputArguments,
      ).catch(() => undefined);
      if (buffer.probeAbort === abort) buffer.probeAbort = undefined;
    }
    if (ctx.stopped || buffer.stopped || buffer.process) return;
    const prefix = `b${Date.now()}-${randomUUID().slice(0, 8)}`;
    buffer.listName = `${prefix}.csv`;
    const child = spawnRecordingCapture({
      source: input.url,
      token: input.token,
      inputArguments: input.inputArguments,
      recordAudio: ctx.config.record_audio,
      expectedAudio: buffer.expectedAudio,
      segmentList: join(buffer.dir, buffer.listName),
      segmentPattern: join(buffer.dir, `${prefix}-%09d.mp4`),
    });
    buffer.process = child;
    buffer.status = 'starting';
    buffer.lastAdvance = Date.now();
    buffer.segmentStartedAt = Date.now();
    buffer.lastSegmentAt = undefined;
    buffer.lastFrame = -1;
    buffer.lastError = undefined;
    const progress = new RecordingProgress();
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (progress.push(chunk)) {
        buffer.lastFrame = progress.frames;
        buffer.lastAdvance = Date.now();
        buffer.status = 'buffering';
        buffer.failures = 0;
        if (progress.sustained && input.kind === 'rtsp') buffer.directFailures = 0;
      }
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8192);
    });
    const exited = () => {
      if (buffer.process !== child) return;
      clearTimeout(buffer.killTimer);
      buffer.process = undefined;
      if (input.kind === 'rtsp') buffer.directFailures = (buffer.directFailures ?? 0) + 1;
      buffer.status = 'reconnecting';
      const primaryRecovered = buffer.primaryRecovered;
      buffer.primaryRecovered = false;
      const detail = sanitizeCaptureError(stderr);
      if (!primaryRecovered && detail) buffer.lastError = detail;
      if (!buffer.stopped && !ctx.stopped) {
        buffer.retry = setTimeout(
          () => {
            buffer.retry = undefined;
            void ctx.startBuffer(buffer);
          },
          primaryRecovered
            ? 0
            : Math.min(
                30000,
                2000 * 2 ** Math.min((buffer.failures = (buffer.failures ?? 0) + 1), 4),
              ),
        );
        buffer.retry.unref?.();
      }
    };
    child.once('error', exited);
    child.once('close', exited);
    ctx.onChange();
  } catch (error) {
    const err = error as { message?: string } | null;
    buffer.status = 'unavailable';
    buffer.lastError =
      err?.message === 'insufficient_storage'
        ? 'Storage needs free space'
        : 'Camera stream unavailable';
    if (!ctx.stopped && !buffer.stopped) {
      buffer.retry = setTimeout(() => {
        buffer.retry = undefined;
        void ctx.startBuffer(buffer);
      }, 20000);
      buffer.retry.unref?.();
    }
  }
}

export async function maintainCaptureBuffers(
  ctx: BufferRuntimeContext,
  recordingEvents: readonly EventRecord[],
  now: number,
): Promise<void> {
  for (const buffer of ctx.buffers.values()) {
    if (ctx.useCapture ?? Boolean(ctx.capture)) continue;
    const camera = ctx.cameras?.find((item) => item.id === buffer.id);
    if (ctx.ha.primaryRecordingInput) {
      ctx.primaryRecovery.consider(buffer, {
        eligible: () =>
          Boolean(
            !ctx.stopped &&
            !buffer.stopped &&
            ctx.buffers.get(buffer.id) === buffer &&
            buffer.inputKind === 'ha' &&
            buffer.status === 'buffering' &&
            Boolean(buffer.process) &&
            !buffer.killTimer &&
            camera?.enabled &&
            camera.available &&
            ctx.config.recording_enabled &&
            !recordingEvents.some((event) => event.cameraId === buffer.id),
          ),
        find: () => ctx.ha.primaryRecordingInput!(camera),
        promote: () => {
          buffer.directFailures = 0;
          buffer.primaryRecovered = true;
          buffer.status = 'reconnecting';
          ctx.terminateBuffer(buffer);
        },
      });
    }
    const csv = buffer.listName
      ? await readFile(join(buffer.dir, buffer.listName), 'utf8').catch(() => '')
      : '';
    const completed = parseSegments(csv, buffer.dir).at(-1);
    if (completed) {
      const info = await stat(completed.path).catch(() => null);
      if (info?.size) buffer.lastSegmentAt = info.mtimeMs;
    }
    if (
      buffer.process &&
      !buffer.killTimer &&
      (now - (buffer.lastAdvance ?? now) > 30000 ||
        now - (buffer.lastSegmentAt ?? buffer.segmentStartedAt ?? now) > 30000)
    ) {
      buffer.status = 'reconnecting';
      buffer.lastError = 'Camera media stopped advancing; reconnecting';
      ctx.terminateBuffer(buffer);
    }
    const pinned = recordingEvents
      .filter((event) => event.cameraId === buffer.id)
      .map((event) => event.startAt - ctx.config.pre_roll_seconds * 1000);
    const cutoff = Math.min(
      now -
        (ctx.config.pre_roll_seconds + 12) * 1000 -
        (camera?.motionDetection?.enabled ? MAX_ASSIST_DELAY_MS : 0),
      ...pinned,
    );
    let total = 0;
    const retained: Array<{ file: string; size: number; mtimeMs: number }> = [];
    for (const name of await readdir(buffer.dir).catch(() => [] as string[])) {
      const isList = name === 'index.csv' || /^b\d{13}-[a-f0-9]{8}\.csv$/.test(name);
      if (isList) {
        if (name !== buffer.listName) {
          const list = join(buffer.dir, name);
          const listStat = await stat(list).catch(() => null);
          if (listStat && listStat.mtimeMs < cutoff) {
            await unlink(list).catch(() => {});
          }
        }
        continue;
      }
      if (!/^(?:\d{8}T\d{6}|b\d{13}-[a-f0-9]{8}-\d{9,})\.mp4$/.test(name)) continue;
      const file = join(buffer.dir, name);
      const info = await stat(file).catch(() => null);
      if (!info) continue;
      if (info.mtimeMs < cutoff) {
        const removed = await unlink(file).then(
          () => true,
          () => false,
        );
        if (removed) continue;
      }
      total += info.size;
      retained.push({ file, size: info.size, mtimeMs: info.mtimeMs });
    }
    const maxBytes = (ctx.config.max_buffer_gb * 1024 ** 3) / Math.max(1, ctx.buffers.size);
    if (total > maxBytes && retained.length > 1) {
      retained.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const pinnedStart = pinned.length ? Math.min(...pinned) : Infinity;
      for (const entry of retained.slice(0, -1)) {
        if (total <= maxBytes) break;
        if (entry.mtimeMs >= pinnedStart) break;
        const removed = await unlink(entry.file).then(
          () => true,
          () => false,
        );
        if (removed) total -= entry.size;
      }
    }
    if (total > maxBytes) {
      buffer.status = 'storage-limit';
      ctx.terminateBuffer(buffer);
      for (const event of recordingEvents.filter((item) => item.cameraId === buffer.id)) {
        await ctx.store.finish(event.id, {
          status: 'failed',
          error: 'Buffer storage limit reached',
        });
      }
      ctx.active.delete(buffer.id);
    }
  }
}
