/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ChildProcess } from 'node:child_process';
import type { MediaRuntime as MediaRuntimeType } from '../pipeline/tools.js';
import { isRecord, safeMediaError } from './native-args.js';
import type { NativeCameraSession, NativeMediaLog } from './native-types.js';

export interface ProducerWatchdogOptions {
  sessions: Iterable<NativeCameraSession>;
  now: number;
  startupStallMs: number;
  idleStallMs: number;
  onStalled: (session: NativeCameraSession, reason: 'startup_timeout' | 'rtp_idle') => void;
}

/** Detects alive FFmpeg source readers that stopped delivering frames without exiting. */
export function detectStalledProducers({
  sessions,
  now,
  startupStallMs,
  idleStallMs,
  onStalled,
}: ProducerWatchdogOptions): void {
  for (const session of sessions) {
    const producer = session.producer;
    if (
      session.stopped ||
      session.restartTimer ||
      !producer ||
      producer.exitCode !== null ||
      producer.signalCode !== null
    ) {
      continue;
    }
    if (
      session.mediaReadyAt === 0 &&
      session.producerStartedAt !== undefined &&
      startupStallMs > 0 &&
      now - session.producerStartedAt >= startupStallMs
    ) {
      onStalled(session, 'startup_timeout');
      continue;
    }
    if (
      session.mediaReadyAt > 0 &&
      session.lastSourceRtpAt !== undefined &&
      idleStallMs > 0 &&
      now - session.lastSourceRtpAt >= idleStallMs
    ) {
      onStalled(session, 'rtp_idle');
    }
  }
}

/** Terminates stalled source readers so scheduled restart resets the relay cleanly. */
export function handleStalledProducer(
  session: NativeCameraSession,
  reason: 'startup_timeout' | 'rtp_idle',
  ops: {
    log: NativeMediaLog;
    onResetReady: (session: NativeCameraSession) => void;
    terminate: (child: ChildProcess) => Promise<void>;
  },
): void {
  const producer = session.producer;
  session.producerStartedAt = undefined;
  session.lastSourceRtpAt = undefined;
  if (reason === 'rtp_idle') ops.onResetReady(session);
  ops.log('source_reader_stalled', {
    cameraId: session.cameraId,
    sourceKind: session.sourceKind,
    reason,
  });
  if (producer) void ops.terminate(producer).catch(() => {});
}

/** Stops and clears active session producers after an unexpected media daemon failure. */
export function stopSessionProducers(
  sessions: Map<string, NativeCameraSession>,
  terminate: (child: ChildProcess) => Promise<void>,
): void {
  for (const session of sessions.values()) {
    session.stopped = true;
    clearTimeout(session.restartTimer);
    session.restartTimer = undefined;
    const producer = session.producer;
    session.producer = undefined;
    if (producer) void terminate(producer).catch(() => {});
  }
  sessions.clear();
}

export async function terminateChildProcess(child: ChildProcess): Promise<void> {
  if (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
  )
    return;
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 1500);
  timer.unref?.();
  await closed;
  clearTimeout(timer);
}

/** Spawns the FFmpeg source reader, captures redacted diagnostics, and schedules restarts on exit. */
export async function spawnProducerProcess(
  session: NativeCameraSession,
  args: string[],
  ops: {
    runtime: MediaRuntimeType;
    now: () => number;
    isActive: () => boolean;
    log: NativeMediaLog;
    onClose: () => void;
  },
): Promise<void> {
  const child = ops.runtime.spawn('ffmpeg', args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  session.producerStartedAt = ops.now();
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8192);
  });
  session.producer = child;
  const started = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('camera_media_spawn_timeout')), 5000);
    timer.unref?.();
    child.once('spawn', () => {
      clearTimeout(timer);
      resolve();
    });
    child.once('error', (error: Error) => {
      clearTimeout(timer);
      ops.log('source_reader_spawn_failed', {
        cameraId: session.cameraId,
        sourceKind: session.sourceKind,
        errorCode:
          isRecord(error) && typeof error.code === 'string' ? error.code.slice(0, 64) : 'unknown',
      });
      reject(new Error('camera_media_spawn_failed'));
    });
  });
  child.once('close', () => {
    if (session.producer === child) session.producer = undefined;
    if (!session.stopped && ops.isActive()) {
      ops.log('source_reader_closed', {
        cameraId: session.cameraId,
        sourceKind: session.sourceKind,
        exitCode: Number.isInteger(child.exitCode) ? child.exitCode : null,
        signal: typeof child.signalCode === 'string' ? child.signalCode : null,
        detail: safeMediaError(stderr) || undefined,
      });
      ops.onClose();
    }
  });
  await started;
}
