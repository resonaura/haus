/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ChildProcess } from 'node:child_process';
import type { EventRecord } from '../recording.types.js';
import type { OriginalPlaybackProvenance } from './compatible.js';
import type { PrimarySourceInput } from './recovery.js';

export interface RecorderConfig {
  data: string;
  media: string;
  token?: string | null;
  recording_enabled: boolean;
  record_audio: boolean;
  pre_roll_seconds: number;
  post_roll_seconds: number;
  max_event_seconds: number;
  max_storage_gb: number;
  max_buffer_gb: number;
}

export interface RecorderSensor {
  id: string;
  kind: string;
  active?: boolean;
}

export interface RecorderCamera {
  id: string;
  enabled?: boolean;
  available?: boolean;
  independentSource?: boolean;
  kitsuneSource?: { url: string; kind?: string };
  sensors?: RecorderSensor[];
  motionDetection?: {
    enabled?: boolean;
    mode: 'objects' | 'motion';
  };
  playbackSource?: OriginalPlaybackProvenance;
}

export interface RecorderInputDescriptor extends PrimarySourceInput {
  url: string;
  kind: string;
  token?: string;
  inputArguments?: string[];
}

export interface RecorderHaPort {
  stream?(cameraId: string): Promise<string>;
  recordingInput?(camera: { id: string }, allowDirect: boolean): Promise<RecorderInputDescriptor>;
  primaryRecordingInput?(
    camera: RecorderCamera | undefined,
  ): Promise<PrimarySourceInput | null | undefined> | PrimarySourceInput | null | undefined;
}

export interface RecorderBuffer {
  id: string;
  dir: string;
  status: string;
  stopped: boolean;
  starting?: Promise<void>;
  process?: ChildProcess;
  killTimer?: NodeJS.Timeout;
  retry?: NodeJS.Timeout;
  probeAbort?: AbortController;
  directFailures?: number;
  directAttempt?: number;
  inputKind?: string;
  expectedAudio?: boolean;
  listName?: string;
  lastAdvance?: number;
  segmentStartedAt?: number;
  lastSegmentAt?: number;
  lastFrame?: number;
  lastError?: string;
  failures?: number;
  primaryRecovered?: boolean;
}

export interface RecorderCapturePort {
  events: ReadonlySet<string> | ReadonlyMap<string, unknown>;
  buffers: Map<string, RecorderBuffer>;
  sync(cameras: RecorderCamera[]): void;
  record(event: EventRecord | null): Promise<unknown>;
  finalize(event: EventRecord): Promise<unknown>;
}

export type PrepareRemoteFn = (
  event: EventRecord,
  options: {
    output: string;
    audioTrimSeconds?: number;
    signal: AbortSignal;
  },
) => Promise<boolean>;

export interface RecorderStore {
  reconcileLocalMedia(probe?: (path: string) => Promise<unknown>): Promise<void>;
  recording(): Promise<EventRecord[]>;
  path(id: string, extension?: string): string;
  finish(
    id: string,
    options?: {
      status?: string;
      duration?: number;
      bytes?: number;
      error?: string | null;
      playbackVersion?: number;
      mediaStartAt?: number | null;
    },
  ): Promise<EventRecord | null>;
  extend(
    id: string,
    kind: string,
    at: number,
    endAt: number,
    sensorId?: string,
    maxEndAt?: number,
  ): Promise<EventRecord | null>;
  extendTail(id: string, endAt: number): Promise<EventRecord | null>;
  totals(): Promise<{ bytes: number }>;
  create(
    cameraId: string,
    kind: string,
    at: number,
    endAt: number,
    sensorId?: string,
  ): Promise<EventRecord>;
  get(id: string): Promise<EventRecord | null>;
  pinMedia(id: string, signal?: AbortSignal): Promise<() => void>;
  setPlayback(
    id: string,
    bytes: number,
    version?: number,
    diagnostics?: Record<string, unknown>,
  ): Promise<void>;
}

export interface PlaybackUrgency {
  value: number;
  localAllowed: boolean;
  forceCompatibility: boolean;
}

export interface RecorderPrepareOptions {
  remoteOnly?: boolean;
  forceCompatibility?: boolean;
}

export interface RecorderBufferStatus {
  cameraId: string;
  status: string;
  error?: string;
  audioExpected?: boolean;
  inputKind?: string;
  lastSegmentAt?: number;
}

export interface RecorderProcessingStatus {
  active: boolean;
  activeKind?: 'playback' | 'capture' | 'prefetch' | 'nvr-playback';
  elapsedMs: number;
  remote: number;
  queued: number;
  preparing: number;
}
