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

export interface BufferRuntimeContext {
  readonly config: RecorderConfig;
  readonly ha: RecorderHaPort;
  readonly store: RecorderStore;
  readonly capture?: RecorderCapturePort;
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

export async function startCaptureBuffer(
  ctx: BufferRuntimeContext,
  buffer: RecorderBuffer,
): Promise<void> {
  if (ctx.stopped || buffer.stopped) return;
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
    if (ctx.stopped || buffer.stopped) return;
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
    child.stderr?.on('data', () => {});
    const exited = () => {
      if (buffer.process !== child) return;
      clearTimeout(buffer.killTimer);
      buffer.process = undefined;
      if (input.kind === 'rtsp') buffer.directFailures = (buffer.directFailures ?? 0) + 1;
      buffer.status = 'reconnecting';
      const primaryRecovered = buffer.primaryRecovered;
      buffer.primaryRecovered = false;
      if (!buffer.stopped && !ctx.stopped) {
        buffer.retry = setTimeout(
          () => void ctx.startBuffer(buffer),
          primaryRecovered
            ? 0
            : Math.min(
                30000,
                2000 * 2 ** Math.min((buffer.failures = (buffer.failures ?? 0) + 1), 4),
              ),
        );
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
      buffer.retry = setTimeout(() => void ctx.startBuffer(buffer), 20000);
    }
  }
}

export async function maintainCaptureBuffers(
  ctx: BufferRuntimeContext,
  recordingEvents: readonly EventRecord[],
  now: number,
): Promise<void> {
  for (const buffer of ctx.buffers.values()) {
    if (ctx.capture) continue;
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
      total += info.size;
      if (info.mtimeMs < cutoff) await unlink(file).catch(() => {});
    }
    if (total > (ctx.config.max_buffer_gb * 1024 ** 3) / Math.max(1, ctx.buffers.size)) {
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
