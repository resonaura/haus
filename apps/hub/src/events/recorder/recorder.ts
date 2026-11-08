/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { stat } from 'node:fs/promises';
import type { EventRecord } from '../recording.types.js';
import { maintainCaptureBuffers, startCaptureBuffer, terminateCaptureBuffer } from './buffer.js';
import { probe } from './compatible.js';
import { finalizeRecordedEvent } from './finalize.js';
import { prepareEventPlaybackPinned } from './prepare.js';
import { MediaQueue } from './queue.js';
import { PrimarySourceRecovery } from './recovery.js';
import { bufferDirectoryPath, readBufferSegments, type SegmentPart } from './segments.js';
import type {
  PlaybackUrgency,
  PrepareRemoteFn,
  RecorderBuffer,
  RecorderBufferStatus,
  RecorderCamera,
  RecorderCapturePort,
  RecorderConfig,
  RecorderHaPort,
  RecorderPrepareOptions,
  RecorderProcessingStatus,
  RecorderSensor,
  RecorderStore,
} from './types.js';

const reportFinalizationFailure = () =>
  process.emitWarning('Recording finalization failed.', { code: 'HAUS_RECORDING_FINALIZE' });

export class Recorder {
  readonly config: RecorderConfig;
  readonly ha: RecorderHaPort;
  readonly store: RecorderStore;
  readonly onChange: () => void;
  readonly prepareRemote?: PrepareRemoteFn;
  readonly capture?: RecorderCapturePort;
  readonly remotePreparing = new Map<string, number>();
  readonly primaryRecovery = new PrimarySourceRecovery();
  buffers = new Map<string, RecorderBuffer>();
  readonly active = new Map<string, EventRecord>();
  readonly triggers = new Map<string, Promise<void>>();
  readonly finalizing = new Set<string>();
  readonly playbackJobs = new Map<string, Promise<string>>();
  readonly encoding = new MediaQueue();
  readonly playbackPriorities = new Map<string, PlaybackUrgency>();
  readonly playbackAbort = new AbortController();
  stopped = false;
  tickBusy = false;
  timer?: NodeJS.Timeout;
  cameras?: RecorderCamera[];
  activitySensors?: (camera: RecorderCamera) => RecorderSensor[];
  private initialization?: Promise<void>;
  private stopping?: Promise<void>;
  private ticking?: Promise<void>;
  private readonly finalizations = new Map<string, Promise<void>>();
  private readonly preparations = new Set<Promise<void>>();

  constructor(
    config: RecorderConfig,
    ha: RecorderHaPort,
    store: RecorderStore,
    onChange: () => void = () => {},
    {
      prepareRemote,
      capture,
    }: {
      prepareRemote?: PrepareRemoteFn;
      capture?: RecorderCapturePort;
    } = {},
  ) {
    this.config = config;
    this.ha = ha;
    this.store = store;
    this.onChange = onChange;
    this.prepareRemote = prepareRemote;
    this.capture = capture;
  }

  initialize(): Promise<void> {
    if (this.stopped) return Promise.reject(Error('recorder_stopped'));
    return (this.initialization ??= this.initializeRecording());
  }

  private async initializeRecording(): Promise<void> {
    await this.store.reconcileLocalMedia();
    if (this.stopped) return;
    for (const event of await this.store.recording()) {
      if (this.stopped) return;
      if (this.capture?.events.has(event.id)) continue;
      try {
        const info = await probe(this.store.path(event.id));
        const file = await stat(this.store.path(event.id));
        await this.store.finish(event.id, {
          duration: info.duration,
          bytes: file.size,
        });
      } catch {
        const parts = await this.segments({
          dir: this.bufferDirectory(event.cameraId),
        });
        if (
          parts.some(
            (part) =>
              part.end >= event.startAt - this.config.pre_roll_seconds * 1000 &&
              part.start <= event.endAt,
          )
        ) {
          // Ring segments survive upgrades; recovery must not delay fresh capture.
          this.finalizeInBackground(event);
        } else {
          await this.store.finish(event.id, {
            status: 'interrupted',
            error: 'Recording interrupted by a restart',
          });
        }
      }
    }
    if (!this.stopped) this.timer = setInterval(() => void this.tick(), 2000);
  }

  bufferDirectory(id: string): string {
    return bufferDirectoryPath(this.config.data, id);
  }

  sync(cameras: RecorderCamera[]): void {
    if (this.stopped) return;
    this.cameras = cameras;
    if (this.capture) {
      this.capture.sync(cameras);
      this.buffers = this.capture.buffers;
      return;
    }
    const enabled = new Set(
      cameras
        .filter((camera) => camera.enabled && camera.available && this.config.recording_enabled)
        .map((camera) => camera.id),
    );
    for (const [id, buffer] of this.buffers) {
      if (!enabled.has(id)) {
        buffer.stopped = true;
        this.primaryRecovery.cancel(buffer);
        buffer.probeAbort?.abort();
        this.terminateBuffer(buffer);
        clearTimeout(buffer.retry);
        this.buffers.delete(id);
      }
    }
    for (const id of enabled) {
      if (!this.buffers.has(id)) {
        const buffer: RecorderBuffer = {
          id,
          dir: this.bufferDirectory(id),
          status: 'starting',
          stopped: false,
        };
        this.buffers.set(id, buffer);
        void this.startBuffer(buffer);
      }
    }
  }

  terminateBuffer(buffer: RecorderBuffer): void {
    terminateCaptureBuffer(buffer);
  }

  startBuffer(buffer: RecorderBuffer): Promise<void> {
    return startCaptureBuffer(this, buffer);
  }

  trigger(
    cameraId: string,
    kind = 'manual',
    sensorId?: string,
    at = Date.now(),
  ): Promise<EventRecord> {
    return this.withCamera(cameraId, () => this.triggerEvent(cameraId, kind, sensorId, at));
  }

  withCamera<T>(cameraId: string, operation: () => Promise<T>): Promise<T> {
    const task = (this.triggers.get(cameraId) ?? Promise.resolve()).then(operation);
    const settled = task.then(
      () => {},
      () => {},
    );
    this.triggers.set(cameraId, settled);
    void settled.then(() => {
      if (this.triggers.get(cameraId) === settled) this.triggers.delete(cameraId);
    });
    return task;
  }

  async triggerEvent(
    cameraId: string,
    kind: string,
    sensorId?: string,
    at = Date.now(),
  ): Promise<EventRecord> {
    if (this.stopped) throw Error('recorder_stopped');
    const camera = this.cameras?.find((item) => item.id === cameraId);
    if (!camera?.enabled || !camera.available || !this.config.recording_enabled) {
      throw new Error('recording_disabled');
    }
    const endAt = at + this.config.post_roll_seconds * 1000;
    const current = this.active.get(cameraId);
    if (current && at - current.startAt < this.config.max_event_seconds * 1000) {
      const event = await this.store.extend(
        current.id,
        kind,
        at,
        Math.min(endAt, current.startAt + this.config.max_event_seconds * 1000),
        sensorId,
        Math.min(at, current.startAt) + this.config.max_event_seconds * 1000,
      );
      if (event) {
        this.active.set(cameraId, event);
        if (!this.stopped && this.capture) void this.capture.record(event).catch(() => {});
        this.onChange();
        return event;
      }
      if (this.active.get(cameraId)?.id === current.id) this.active.delete(cameraId);
    }
    if (
      this.config.max_storage_gb > 0 &&
      (await this.store.totals()).bytes >= this.config.max_storage_gb * 1024 ** 3
    ) {
      throw new Error('recording_storage_limit');
    }
    if (this.stopped) throw Error('recorder_stopped');
    const event = await this.store.create(cameraId, kind, at, endAt, sensorId);
    this.active.set(cameraId, event);
    if (!this.stopped && this.capture) void this.capture.record(event).catch(() => {});
    this.onChange();
    return event;
  }

  segments(buffer: { readonly dir: string }): Promise<SegmentPart[]> {
    return readBufferSegments(buffer);
  }

  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return (this.ticking ??= this.maintainRecording().finally(() => {
      this.ticking = undefined;
    }));
  }

  private async maintainRecording(): Promise<void> {
    if (this.tickBusy || this.stopped) return;
    this.tickBusy = true;
    try {
      const now = Date.now();
      const recordingEvents = await this.store.recording();
      for (const observed of recordingEvents) {
        if (this.stopped) return;
        await this.withCamera(observed.cameraId, async () => {
          const event = await this.store.get(observed.id);
          if (this.stopped || !event || event.status !== 'recording') return;
          if (this.finalizing.has(event.id)) return;
          const camera = this.cameras?.find((item) => item.id === event.cameraId);
          const activeSensors =
            camera?.enabled && camera.available && this.config.recording_enabled
              ? (this.activitySensors?.(camera) ??
                (camera.sensors ?? []).filter((sensor) => sensor.active))
              : [];
          const held = activeSensors.length > 0 && this.active.get(event.cameraId)?.id === event.id;
          if (held && now < event.startAt + this.config.max_event_seconds * 1000) {
            const extended = await this.store.extendTail(
              event.id,
              Math.min(
                now + this.config.post_roll_seconds * 1000,
                event.startAt + this.config.max_event_seconds * 1000,
              ),
            );
            if (this.capture) void this.capture.record(extended).catch(() => {});
            return;
          }
          if (held) {
            for (const sensor of activeSensors) {
              try {
                await this.triggerEvent(event.cameraId, sensor.kind, sensor.id, now);
              } catch {
                /* A full budget pauses new events without disturbing capture cleanup. */
              }
            }
          }
          if (now >= event.endAt + 8000) {
            if (this.active.get(event.cameraId)?.id === event.id) {
              this.active.delete(event.cameraId);
            }
            this.finalizeInBackground(event);
          }
        });
      }
      if (!this.stopped) await maintainCaptureBuffers(this, recordingEvents, now);
    } catch {
      /* Retry transient disk errors on the next tick. */
    } finally {
      this.tickBusy = false;
    }
  }

  private finalizeInBackground(event: EventRecord): void {
    void this.finish(event).catch(() => {
      if (!this.stopped) reportFinalizationFailure();
    });
  }

  finish(event: EventRecord): Promise<void> {
    const existing = this.finalizations.get(event.id);
    if (existing) return existing;
    if (this.stopped) return Promise.reject(Error('recorder_stopped'));
    this.finalizing.add(event.id);
    const task = this.finishWithPin(event).finally(() => {
      this.finalizations.delete(event.id);
      this.finalizing.delete(event.id);
    });
    this.finalizations.set(event.id, task);
    return task;
  }

  private async finishWithPin(event: EventRecord): Promise<void> {
    const release = await this.store.pinMedia(event.id);
    try {
      if (this.stopped) throw Error('recorder_stopped');
      return await this.finishPinned(event);
    } finally {
      release();
    }
  }

  finishPinned(event: EventRecord): Promise<void> {
    return finalizeRecordedEvent(this, event);
  }

  status(): RecorderBufferStatus[] {
    return [...this.buffers.values()].map((buffer) => ({
      cameraId: buffer.id,
      status: buffer.status,
      error: buffer.lastError,
      audioExpected: buffer.expectedAudio,
      inputKind: buffer.inputKind,
      lastSegmentAt: buffer.lastSegmentAt,
    }));
  }

  processingStatus(): RecorderProcessingStatus {
    const remoteAt = Math.min(...this.remotePreparing.values());
    return {
      active: this.encoding.active || this.remotePreparing.size > 0,
      activeKind: this.encoding.activeWork
        ? this.encoding.activeWork.priority >= 20
          ? 'playback'
          : this.encoding.activeWork.priority >= 10
            ? 'capture'
            : 'prefetch'
        : this.remotePreparing.size
          ? 'nvr-playback'
          : undefined,
      elapsedMs: this.encoding.activeWork
        ? Math.max(0, Date.now() - this.encoding.activeWork.startedAt)
        : this.remotePreparing.size
          ? Math.max(0, Date.now() - remoteAt)
          : 0,
      remote: this.remotePreparing.size,
      queued: this.encoding.pending.length,
      preparing: this.playbackJobs.size,
    };
  }

  preparePlayback(
    event: EventRecord,
    priority = 20,
    options: RecorderPrepareOptions = {},
  ): Promise<string> {
    if (this.stopped) return Promise.reject(Error('recorder_stopped'));
    const task = this.prepareWithPin(event, priority, options);
    const settled = task.then(
      () => {},
      () => {},
    );
    this.preparations.add(settled);
    void settled.then(() => this.preparations.delete(settled));
    return task;
  }

  private async prepareWithPin(
    event: EventRecord,
    priority: number,
    options: RecorderPrepareOptions,
  ): Promise<string> {
    const release = await this.store.pinMedia(event.id);
    try {
      if (this.stopped) throw Error('recorder_stopped');
      const current = (await this.store.get(event.id)) ?? event;
      if (this.stopped) throw Error('recorder_stopped');
      return await this.preparePlaybackPinned(current, priority, options);
    } finally {
      release();
    }
  }

  preparePlaybackPinned(
    event: EventRecord,
    priority = 20,
    options: RecorderPrepareOptions = {},
  ): Promise<string> {
    return prepareEventPlaybackPinned(this, event, priority, options);
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    clearInterval(this.timer);
    return (this.stopping = Promise.resolve().then(() => this.stopRecording()));
  }

  private async stopRecording(): Promise<void> {
    const failures: unknown[] = [];
    const cancel = (operation: () => void) => {
      try {
        operation();
      } catch (error) {
        failures.push(error);
      }
    };
    cancel(() => this.playbackAbort.abort());
    cancel(() => this.encoding.stop());
    for (const buffer of this.buffers.values()) {
      buffer.stopped = true;
      cancel(() => buffer.probeAbort?.abort());
      clearTimeout(buffer.retry);
      cancel(() => this.terminateBuffer(buffer));
    }
    try {
      await this.primaryRecovery.stop();
    } catch (error) {
      failures.push(error);
    }
    await Promise.allSettled([this.initialization, this.ticking]);
    await Promise.allSettled(this.triggers.values());
    await Promise.allSettled(this.preparations);
    await Promise.allSettled(this.playbackJobs.values());
    await Promise.allSettled(this.finalizations.values());
    const deadline = Date.now() + 5000;
    const capturing = () =>
      [...this.buffers.values()].some(
        (buffer) =>
          buffer.process && buffer.process.exitCode === null && !buffer.process.signalCode,
      );
    while (capturing() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (capturing()) failures.push(Error('recording_capture_shutdown_incomplete'));
    if (failures.length) throw new AggregateError(failures, 'recorder_shutdown_failed');
  }
}
