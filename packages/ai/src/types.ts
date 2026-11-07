/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { spawn } from 'node:child_process';
import type { MediaRuntime } from '@haus/media/pipeline';

export type DetectionKind = 'person' | 'pet' | 'vehicle' | 'motion';

export type DetectionMode = 'objects' | 'motion';

export interface DetectionEvent {
  kind: DetectionKind;
  confidence?: number;
  box?: [number, number, number, number];
  at?: number;
  sequence?: number;
}

export interface VisionWorkerPort {
  state: string;
  lastFrame: number;
  lastResult: number;
  calibrated: boolean;
  processingMs?: number;
  stop: () => Promise<PromiseSettledResult<void>[] | void>;
}

export interface DetectorJob {
  id: string;
  mode: DetectionMode;
  until: number;
  sequence: number;
  events: (DetectionEvent & { sequence: number })[];
  worker?: VisionWorkerPort;
  overloadedAt?: number;
}

export interface HostPressureSample {
  scope: string;
  memoryFull: number | null;
  ioFull: number | null;
}

export interface CapacityStatus {
  cpus: number;
  memoryBytes: number;
  memoryUsedBytes: number;
  memoryCurrentBytes: number;
  cpu: number;
  pressured: boolean;
  analysisPressured: boolean;
  hostPressure?: HostPressureSample;
}

export interface DetectorsCapacityPort {
  pressured: boolean;
  analysisPressured?: boolean;
  playbackBusy?: boolean;
  detectors: number;
  memoryUsed: number;
  memory: number;
}

export interface VisionWorkerOptions {
  source: string;
  mode?: DetectionMode;
  headers?: string;
  onDetection?: (event: DetectionEvent) => void;
  spawnProcess?: typeof spawn;
  runtime?: MediaRuntime;
  interval?: number;
  binaryPath?: string;
  pythonPath?: string;
  scriptPath?: string;
}

export type InferenceDeviceType = 'cpu' | 'edgetpu' | 'gpu' | 'npu';

export interface InferenceModelMetadata {
  name: string;
  target: InferenceDeviceType;
  inputShape: [number, number, number, number];
  labels: string[];
  quantized: boolean;
}

export interface InferencePipelineOptions {
  device?: InferenceDeviceType;
  modelPath?: string;
  concurrency?: number;
}

export interface DetectorSessionRef {
  id: string;
  owner?: string;
}

export interface DetectorSessionsManager {
  owned: (id: string, owner?: string) => { id: string } | null | undefined;
  engine: {
    localRtsp: (id: string) => string;
  };
}
