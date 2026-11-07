/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { rm, stat, writeFile } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import type { MediaToolName } from '../pipeline/tools.js';
import {
  cameraFileDigest,
  type CameraMetadataResult,
  type CameraProcessOptions,
} from '../pipeline/process.js';

export interface SegmentRow {
  name: string;
  from: number;
  to: number;
  info?: Stats;
  run: string;
  startAt: number;
  endAt: number;
}

export interface CameraRecordingResult {
  bytes: number;
  sha256: string;
  duration: number;
  mediaStartAt: number;
  audio: boolean;
}

export interface CameraRecordingJob {
  id: string;
  root: string;
  startAt: number;
  endAt: number;
  state: 'recording' | 'preparing' | 'ready' | 'failed';
  parts: Map<string, SegmentRow>;
  createdAt: number;
  completedAt?: number;
  bytes: number;
  maxBytes: number;
  capacity: number;
  reservations: Array<() => void>;
  metadata?: Record<string, unknown>;
  result?: CameraRecordingResult;
  output?: string;
  release?: () => void;
  /** Producer that currently owns a recording execution; sessions reassign on retry. */
  owner?: string;
}

export interface CameraRecordingDescription {
  id: string;
  state: string;
  bytes?: number;
  sha256?: string;
  duration?: number;
  mediaStartAt?: number;
  audio?: boolean;
  error?: string;
}

export interface CameraRecordInput {
  eventId: string;
  startAt: number;
  endAt: number;
  metadata?: Record<string, unknown>;
}

export interface FinalizeRecordingContext {
  abort: AbortController;
  requireAudio: boolean;
  recordAudio: boolean;
  run: (file: MediaToolName, args: string[], options?: CameraProcessOptions) => Promise<string>;
  probe: (file: string, options?: CameraProcessOptions) => Promise<CameraMetadataResult>;
  now: () => number;
  onRecordingReady: (job: CameraRecordingJob) => Promise<void>;
  onRecordingFailed: (job: CameraRecordingJob, error: unknown) => void;
  log: (event: string, payload: Record<string, unknown>) => void;
}

export async function reserveRecording(
  job: CameraRecordingJob,
  bytes: number,
  reserve: (needed: number) => Promise<() => void>,
  abortSignal: AbortSignal,
): Promise<void> {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > job.maxBytes) {
    throw new Error('camera_recording_incomplete');
  }
  const chunk = 16 * 1024 ** 2;
  const capacity = Math.min(job.maxBytes, Math.ceil(bytes / chunk) * chunk);
  if (capacity <= job.capacity) return;
  const release = await reserve((capacity - job.capacity) * 2);
  if (abortSignal.aborted) {
    release();
    abortSignal.throwIfAborted();
  }
  job.reservations.push(release);
  job.capacity = capacity;
}

export async function failRecording(
  job: CameraRecordingJob,
  stage: string,
  error: unknown,
  ctx: Pick<FinalizeRecordingContext, 'onRecordingFailed' | 'log'>,
): Promise<void> {
  job.state = 'failed';
  try {
    ctx.onRecordingFailed(job, error);
  } catch {
    /* Diagnostics cannot prevent cleanup. */
  }
  try {
    const parts = [...job.parts.values()].sort((a, b) => a.startAt - b.startAt);
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.log('recording_finalization_failed', {
      eventId: job.id,
      stage,
      reason: [
        'camera_recording_incomplete',
        'camera_media_failed',
        'storage_full',
        'camera_recording_outbox_full',
        'camera_recording_conflict',
      ].includes(errorMessage)
        ? errorMessage
        : 'recording_io_failed',
      parts: job.parts.size,
      ...(stage === 'coverage'
        ? {
            coverage: {
              missingStartMs: Math.round(
                Math.max(0, (parts[0]?.startAt ?? job.endAt) - job.startAt),
              ),
              missingEndMs: Math.round(
                Math.max(0, job.endAt - (parts.at(-1)?.endAt ?? job.startAt)),
              ),
              largestGapMs: Math.round(
                Math.max(
                  0,
                  ...parts.slice(1).map((part, index) => part.startAt - parts[index].endAt),
                ),
              ),
            },
          }
        : {}),
    });
  } catch {
    /* Diagnostics cannot interfere with bounded capture cleanup. */
  }
  await rm(job.root, { recursive: true, force: true });
  job.release?.();
  job.release = undefined;
}

export async function finalizeRecording(
  job: CameraRecordingJob,
  ctx: FinalizeRecordingContext,
): Promise<void> {
  job.state = 'preparing';
  let stage = 'coverage';
  try {
    const parts = [...job.parts.values()].sort((a, b) => a.startAt - b.startAt);
    const firstPart = parts[0];
    const lastPart = parts.at(-1);
    if (
      !parts.length ||
      !firstPart ||
      !lastPart ||
      firstPart.startAt > job.startAt + 3000 ||
      lastPart.endAt < job.endAt - 3000 ||
      parts.some((part, index) => index > 0 && part.startAt - parts[index - 1].endAt > 500)
    ) {
      throw new Error('camera_recording_incomplete');
    }
    const list = join(job.root, 'input.txt');
    await writeFile(list, parts.map((part) => `file '${part.name}'`).join('\n'), { mode: 0o600 });
    const output = join(job.root, 'recording.mp4');
    stage = 'remux';
    await ctx.run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-nostdin',
        '-y',
        '-protocol_whitelist',
        'file',
        '-f',
        'concat',
        '-safe',
        '1',
        '-i',
        list,
        '-map',
        '0:v:0',
        ...(ctx.recordAudio ? ['-map', '0:a?'] : ['-an']),
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        '-movflags',
        '+faststart',
        '-fs',
        String(job.capacity),
        output,
      ],
      { signal: ctx.abort.signal, timeout: 60000 },
    );
    stage = 'metadata';
    const metadata = await ctx.probe(output, { signal: ctx.abort.signal });
    const info = await stat(output);
    if (
      (ctx.requireAudio && ctx.recordAudio && !metadata.audio) ||
      !metadata.video ||
      !Number.isFinite(metadata.duration) ||
      (metadata.duration !== undefined &&
        Math.abs(metadata.duration - (lastPart.endAt - firstPart.startAt) / 1000) >
          Math.max(1, metadata.duration * 0.05)) ||
      info.size > job.capacity
    ) {
      throw new Error('camera_recording_incomplete');
    }
    stage = 'digest';
    job.result = {
      bytes: info.size,
      sha256: await cameraFileDigest(output),
      duration: metadata.duration ?? 0,
      mediaStartAt: Math.round(firstPart.startAt),
      audio: metadata.audio,
    };
    job.output = output;
    stage = 'archive-outbox';
    await ctx.onRecordingReady(job);
    job.state = 'ready';
    job.completedAt = ctx.now();
    for (const part of parts) {
      await rm(join(job.root, part.name), { force: true });
    }
    await rm(list, { force: true });
  } catch (error) {
    await failRecording(job, stage, error, ctx);
  }
}

export function describeRecording(job: CameraRecordingJob): CameraRecordingDescription {
  return {
    id: job.id,
    state: job.state,
    ...job.result,
    ...(job.state === 'failed' ? { error: 'camera_recording_failed' } : {}),
  };
}
