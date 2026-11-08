/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  NvrCameraRegistryLike,
  NvrCameraWithSources,
} from '../source-url.js';
import type { AnalysisNode, AnalysisNodeHealth } from './placement.js';
import type { MotionDetectionMode } from './settings.js';

export interface MotionCamera extends NvrCameraWithSources {
  enabled?: boolean;
  available?: boolean;
  motionDetection?: {
    enabled?: boolean;
    mode: MotionDetectionMode;
  };
}

export interface MotionConfig {
  recording_enabled?: boolean;
  record_audio?: boolean;
  pre_roll_seconds?: number;
  post_roll_seconds?: number;
  max_event_seconds?: number;
  standalone?: boolean;
  token?: string | null;
}

export interface MotionCluster<TNode extends AnalysisNode = AnalysisNode> {
  nodes(): readonly TNode[];
  health: ReadonlyMap<string, AnalysisNodeHealth>;
  backups?: {
    markChanged?(): void;
  };
}

export interface ActivityPolicyRecord {
  policyId: string;
  cameraId: string;
  nodeId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface ActivityReleaseRecord {
  policyId: string;
  cameraId: string;
  nodeId: string;
}

export interface ActivityTriggerRow {
  requestId: string;
  nodeId: string;
  value: string;
  expiresAt: number;
}

export interface ActivityCatalogPort {
  active(cameraId: string): ActivityPolicyRecord | undefined;
  policies(nodeId: string): readonly ActivityPolicyRecord[];
  policy(
    policyId: string,
    cameraId: string,
    nodeId: string,
  ): ActivityPolicyRecord | undefined;
  releases(cameraId: string): readonly ActivityReleaseRecord[];
  savePolicy(policy: ActivityPolicyRecord): Promise<unknown>;
  retire(policyId: string, now: number): Promise<unknown>;
  expireReleases(now: number): Promise<unknown>;
  acknowledge(nodeId: string, policyIds: readonly string[], expiresAt: number): Promise<unknown>;
  clearNode(nodeId: string, now: number): Promise<unknown>;
  enqueue(row: ActivityTriggerRow): Promise<unknown>;
  expireTriggers(now: number): Promise<unknown>;
  triggers(): readonly ActivityTriggerRow[];
  removeTrigger(requestId: string): Promise<unknown>;
}

export interface ActivityEventPayload {
  id: string;
  cameraId: string;
  startAt: number;
  endAt: number;
  kinds?: string[];
  origin?: {
    kind?: string;
    policyId?: string;
  };
}

export interface ActivityStorePort {
  get(id: string): Promise<{ id: string; cameraId: string } | null | undefined>;
  adoptActivity?(event: ActivityEventPayload): Promise<unknown>;
  interruptActivity?(id: string, error?: unknown): Promise<unknown>;
}

export interface ActivitySessionsRegistry extends NvrCameraRegistryLike {
  cameras: readonly MotionCamera[];
}

export interface ActivitySessionsPort {
  catalog?: { activity?: ActivityCatalogPort };
  registry(): ActivitySessionsRegistry;
  camera(id: string): MotionCamera | undefined;
  advertiseHost(node: AnalysisNode): Promise<string | undefined>;
  ensure?(
    camera: MotionCamera,
    owner: string,
    audio: boolean,
    node: AnalysisNode,
  ): Promise<{ id: string }>;
  release?(cameraId: string, owner: string): Promise<void>;
}

export interface ObservedActivityPlan {
  cameraId: string;
  policyId: string;
  expiresAt?: number;
  admitted?: boolean;
  ready?: boolean;
  state?: string;
  lastResultAt?: number;
  calibrated?: boolean;
  generation?: string | number;
  events?: Array<{ sequence: number; kind: string; at: number }>;
}

export interface LocalVisionWorkerInstance {
  state?: string;
  lastResult?: number;
  calibrated?: boolean;
  stop(): Promise<unknown> | unknown;
}

export type LocalVisionWorkerConstructor = new (options: {
  source: string;
  mode: MotionDetectionMode;
  headers?: string;
  interval: number;
  onDetection: (event: MotionDetectionEvent) => void;
}) => LocalVisionWorkerInstance;

export interface LocalCapacityMonitor {
  detectors?: number;
  pressured?: boolean;
  analysisPressured?: boolean;
  memoryUsed?: number;
  memory?: number;
  stop?(): void;
}

export interface MotionDetectionEvent {
  sequence?: number;
  kind: string;
  at?: number;
  recordingManaged?: boolean;
}

export interface MotionWarmLeaseEntry {
  id: string;
  source?: string;
  expires: number;
}

export interface MotionWarmPort {
  leases: Map<string, MotionWarmLeaseEntry>;
  resource?(entry: MotionWarmLeaseEntry, source: string): string;
  sessions?: ActivitySessionsPort;
}

export interface MotionJob {
  id?: string;
  local?: boolean;
  autonomous?: boolean;
  node?: AnalysisNode;
  policyId?: string;
  lease?: string;
  entry?: MotionWarmLeaseEntry;
  sessionId?: string;
  sessionOwner?: string;
  mode?: MotionDetectionMode;
  state?: string;
  sequence?: number;
  generation?: string | number;
  lastResultAt?: number;
  calibrated?: boolean;
  overloadedAt?: number;
  delivered?: Record<string, number>;
  worker?: LocalVisionWorkerInstance;
}
