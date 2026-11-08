/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { isIP } from 'node:net';
import type { lookup } from 'node:dns/promises';
import type { nodeJson, nodeRequest } from '@haus/servers';
import type { probe } from '@haus/hub/events';
import type { RecorderSensor } from '../../events/recorder/types.js';
import type { NvrCameraSource } from '../source-url.js';

export const ownerId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(value);

export const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

export const privateIp = (value: string): boolean =>
  isIP(value) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);

export const missing = (message: string): Error => new Error(message);

export async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface SessionNode {
  id: string;
  name?: string;
  url: string;
  key: string;
  allowHttp?: boolean;
  enabled?: boolean;
  roles: string[];
  livePriority?: number;
}

export interface SessionNodeRemote {
  features?: {
    cameraContinuity?: number;
    rtspPeer?: boolean;
    cameraRecordingRecovery?: number;
  };
  rtspSessions?: {
    profile?: number;
    webrtc?: boolean;
    recording?: boolean;
    max: number;
    active?: number;
  };
  resources?: {
    pressured?: boolean;
    cpu?: number;
  };
  host?: {
    cpu?: { usage?: number };
  };
  cameraContinuity?: {
    cameras?: { cameraId: string; expiresAt: number }[];
  };
}

export interface SessionNodeHealth {
  online?: boolean;
  remote?: SessionNodeRemote;
}

export interface SessionCamera {
  id: string;
  aliases?: readonly string[];
  enabled?: boolean;
  available?: boolean;
  batteryPowered?: boolean;
  sensors?: RecorderSensor[];
  playbackSource?: {
    platform?: string;
    manufacturer?: string;
    model?: string;
  };
  nativeProvider?: unknown;
  nativeSource?: NvrCameraSource;
}

export interface SessionRegistry {
  cameras: SessionCamera[];
  states?: { entity_id: string; state: string; attributes?: Record<string, unknown> }[];
  entities?: {
    entity_id: string;
    device_id?: string | null;
    platform?: string;
    disabled_by?: unknown;
    hidden_by?: unknown;
  }[];
}

export interface SessionBuffer {
  id: string;
  dir: string;
  status: string;
  stopped: boolean;
  inputKind: string;
  lastError?: string;
  expectedAudio?: boolean;
  lastAdvance?: number;
  lastSegmentAt?: number;
}

export interface SessionEntry {
  node: SessionNode;
  id: string;
  cameraId: string;
  owner: string;
  fingerprint: string;
  state: 'ready' | 'warming';
  renewedAt: number;
  until: number;
  audio?: boolean;
  peerSource?: string;
  capabilities?: { webrtc?: boolean; recording?: boolean };
}

export interface ViewerEntry {
  cameraId: string;
  owner: string;
  viewerId: string;
  node?: SessionNode;
  id?: string;
  remoteId?: string;
  pending?: Promise<{ answer: { type: string; sdp: string }; candidates: unknown[] }>;
}

export interface RecordingEvent {
  id: string;
  cameraId: string;
  startAt: number;
  endAt: number;
  kinds?: string[];
  status?: string;
  localOriginal?: boolean;
}

export interface DurableReceiptValue {
  state: string;
  event: RecordingEvent;
  sha256: string;
  bytes: number;
  duration: number;
  mediaStartAt: number;
  audio: boolean;
}

export interface RecordingJob {
  nodeId: string;
  id?: string;
  owner?: string;
  receipt?: DurableReceiptValue;
  cameraId: string;
  startAt?: number;
  endAt?: number;
}

export interface SessionPersistence {
  assignments(): { cameraId: string; nodeId: string }[];
  events(): { eventId: string; value: string }[];
  saveAssignment(cameraId: string, nodeId: string): Promise<void>;
  saveEvent(eventId: string, value: string): Promise<void>;
  removeEvent(eventId: string): Promise<void>;
  originalDigest(eventId: string): Promise<string | null | undefined>;
}

export interface SessionStore {
  get(id: string): Promise<RecordingEvent | null | undefined>;
  adoptActivity(event: {
    id: string;
    cameraId: string;
    startAt: number;
    endAt: number;
    kinds?: string[];
  }): Promise<RecordingEvent | null | undefined>;
  pinMedia(id: string): Promise<() => void>;
  path(id: string, ext?: string): string;
  setPlayback(
    id: string,
    offset: number,
    version?: number,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  finish(
    id: string,
    info?: {
      status?: string;
      duration?: number;
      bytes?: number;
      error?: string | null;
      playbackVersion?: number;
      mediaStartAt?: number | null;
    },
  ): Promise<unknown>;
}

export type SessionJson = (
  node: SessionNode,
  path: string,
  input?: Parameters<typeof nodeJson>[2],
) => Promise<unknown>;

export type SessionRequest = (
  node: SessionNode,
  path: string,
  input?: Parameters<typeof nodeRequest>[2],
) => Promise<Response>;

export interface NvrCameraSessionsHost {
  config: {
    recording_enabled?: boolean;
    pre_roll_seconds?: number;
    record_audio?: boolean;
  };
  store: SessionStore;
  cluster: {
    nodes(): SessionNode[];
    health: Map<string, SessionNodeHealth>;
  };
  registry: () => SessionRegistry;
  now: () => number;
  json: SessionJson;
  request: SessionRequest;
  inspect: typeof probe;
  resolve: typeof lookup;
  log: (event: string, fields: Record<string, unknown>) => void;
  buffers: Map<string, SessionBuffer>;
  entries: Map<string, SessionEntry>;
  revisions: Map<string, number>;
  pending: Map<string, Promise<SessionEntry>>;
  cameraPending: Map<string, Promise<SessionEntry>>;
  nodeReservations: Map<string, number>;
  failedNodes: Map<string, { failures: number; until: number }>;
  viewers: Map<string, ViewerEntry>;
  closedViewers: Map<string, number>;
  events: Map<string, RecordingJob>;
  eventPending: Map<string, Promise<RecordingJob>>;
  finalizations: Map<string, Promise<void>>;
  recoveryCursors: Map<string, string | undefined>;
  recordingDiagnostics: Map<string, number>;
  abort: AbortController;
  recordingOwner: string;
  continuityAssignments: Map<string, string>;
  continuitySent: Map<string, { fingerprint: string; at: number }>;
  catalog: {
    sessions: SessionPersistence;
    activity?: import('../motion/types.js').ActivityCatalogPort;
  };
  persistence: SessionPersistence;
  cameras?: SessionCamera[];
  continuityBusy?: boolean;
  stopped?: boolean;
  ticking?: boolean;
  recovering?: boolean;
  lastRecovery?: number;
  recoveryPromise?: Promise<void>;
  clearActivityNode?: (id: string) => Promise<void> | undefined;
  activityAssignedNode?: (camera: SessionCamera) => SessionNode | undefined;
  authorizeActivityRecording?: (node: SessionNode, value: DurableReceiptValue) => boolean;

  camera(id: string): SessionCamera | undefined;
  rememberAssignment(entry: SessionEntry): Promise<void>;
  syncContinuity(force?: boolean): Promise<void>;
  clearContinuityNode(id: string): Promise<void>;
  nodeLoad(node: SessionNode): {
    remote: SessionNodeRemote | undefined;
    capability: SessionNodeRemote['rtspSessions'];
    active: number;
  };
  sourceHealth(): { id: string; available: boolean; expiresAt: number }[];
  candidates(): SessionNode[];
  reserveNode(nodeId: string, delta: number): void;
  validNode(node: SessionNode): boolean;
  nodeFailure(node: SessionNode, error: unknown): void;
  advertiseHost(node: SessionNode): Promise<string>;
  ensure(
    camera: SessionCamera | undefined,
    owner: string,
    preview?: boolean,
    preferredNode?: SessionNode,
    refresh?: boolean,
  ): Promise<SessionEntry>;
  acquire(
    camera: SessionCamera,
    owner: string,
    source: NvrCameraSource,
    key: string,
    preferredNode: SessionNode | undefined,
    revision: number,
    refresh?: boolean,
  ): Promise<SessionEntry>;
  validateSession(value: unknown): asserts value is SessionEntry;
  updateBuffer(entry: SessionEntry): Promise<void>;
  releaseEntry(entry: SessionEntry): Promise<void>;
  release(cameraId: string, owner: string): Promise<void>;
  liveCandidates(): SessionNode[];
  peerEntry(
    camera: SessionCamera,
    owner: string,
    source: SessionEntry,
    node: SessionNode,
  ): Promise<SessionEntry>;
  ensureLive(camera: SessionCamera, owner: string): Promise<SessionEntry>;
  deleteViewer(viewer: ViewerEntry): Promise<void>;
  closeViewer(cameraId: string, owner: string, viewerId: string): Promise<{ closed: boolean }>;
  record(event: RecordingEvent | null): Promise<RecordingJob>;
  reportRecordingFailure(event: RecordingEvent, phase: string, error: unknown): void;
  submitRecord(event: RecordingEvent): Promise<RecordingJob>;
  finalize(event: RecordingEvent): Promise<void>;
  validateReceipt(value: unknown, event: RecordingEvent): value is DurableReceiptValue;
  durableRecording(
    event: RecordingEvent,
    preferredNode?: string,
  ): Promise<{ node: SessionNode; value: DurableReceiptValue } | undefined>;
  acknowledgeRecording(node: SessionNode, value: DurableReceiptValue): Promise<unknown>;
  recoverRecordings(): Promise<void>;
  recoverReadyRecordings(): Promise<void>;
  finalizeRecording(event: RecordingEvent): Promise<void>;
}
