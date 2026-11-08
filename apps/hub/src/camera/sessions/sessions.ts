/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { nodeJson, nodeRequest } from '@haus/servers';
import { probe } from '@haus/hub/events';
import { nvrCameraSource, type NvrCameraSource } from '../source-url.js';
import {
  acquireSession,
  ensureSession,
  releaseEntry,
  releaseSession,
  touchSession,
  updateBuffer,
  validateSession,
} from './acquire.js';
import {
  advertiseHost,
  candidates,
  clearContinuityNode,
  nodeFailure,
  nodeLoad,
  rememberAssignment,
  reserveNode,
  sourceHealth,
  syncContinuity,
  validNode,
} from './continuity.js';
import { finalizeEvent, finalizeRecording } from './finalize.js';
import {
  acknowledgeRecording,
  durableRecording,
  recordEvent,
  recoverReadyRecordings,
  recoverRecordings,
  reportRecordingFailure,
  submitRecord,
  validateReceipt,
} from './recording.js';
import {
  type DurableReceiptValue,
  type NvrCameraSessionsHost,
  type RecordingEvent,
  type RecordingJob,
  type SessionBuffer,
  type SessionCamera,
  type SessionEntry,
  type SessionJson,
  type SessionNode,
  type SessionNodeHealth,
  type SessionNodeRemote,
  type SessionPersistence,
  type SessionRegistry,
  type SessionRequest,
  type SessionStore,
  type ViewerEntry,
} from './types.js';
import {
  closeViewer,
  deleteViewer,
  ensureLive,
  liveCandidates,
  openViewer,
  peerEntry,
  viewerCandidate,
} from './viewer.js';

export { nvrCameraSource };

/** Controller-only credentials and owner leases; one NVR owns camera media. */
export class NvrCameraSessions implements NvrCameraSessionsHost {
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
  buffers = new Map<string, SessionBuffer>();
  entries = new Map<string, SessionEntry>();
  revisions = new Map<string, number>();
  pending = new Map<string, Promise<SessionEntry>>();
  cameraPending = new Map<string, Promise<SessionEntry>>();
  nodeReservations = new Map<string, number>();
  failedNodes = new Map<string, { failures: number; until: number }>();
  viewers = new Map<string, ViewerEntry>();
  closedViewers = new Map<string, number>();
  events = new Map<string, RecordingJob>();
  eventPending = new Map<string, Promise<RecordingJob>>();
  finalizations = new Map<string, Promise<void>>();
  recoveryCursors = new Map<string, string | undefined>();
  recordingDiagnostics = new Map<string, number>();
  abort = new AbortController();
  recordingOwner = `recording-${randomUUID()}`;
  continuityAssignments = new Map<string, string>();
  continuitySent = new Map<string, { fingerprint: string; at: number }>();
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

  constructor({
    config,
    store,
    catalog,
    cluster,
    registry,
    now = Date.now,
    json = nodeJson,
    request = nodeRequest,
    inspect = probe,
    resolve = lookup,
    log = (event: string, fields: Record<string, unknown>) =>
      console.log(JSON.stringify({ component: 'camera-capture', event, ...fields })),
  }: {
    config: NvrCameraSessions['config'];
    store: SessionStore;
    catalog?: {
      sessions: SessionPersistence;
      activity?: import('../motion/types.js').ActivityCatalogPort;
    };
    cluster: NvrCameraSessions['cluster'];
    registry: () => SessionRegistry;
    now?: () => number;
    json?: SessionJson;
    request?: SessionRequest;
    inspect?: typeof probe;
    resolve?: typeof lookup;
    log?: (event: string, fields: Record<string, unknown>) => void;
  }) {
    this.config = config;
    this.store = store;
    this.cluster = cluster;
    this.registry = registry;
    this.now = now;
    this.json = json;
    this.request = request;
    this.inspect = inspect;
    this.resolve = resolve;
    this.log = log;
    if (!catalog) throw Error('camera_catalog_required');
    this.catalog = catalog;
    this.persistence = catalog.sessions;
    for (const row of this.persistence.assignments())
      this.continuityAssignments.set(row.cameraId, row.nodeId);
    for (const row of this.persistence.events()) {
      try {
        this.events.set(row.eventId, JSON.parse(row.value) as RecordingJob);
      } catch (error) {
        process.emitWarning(error as Error);
      }
    }
  }

  camera(id: string): SessionCamera | undefined {
    return this.registry().cameras.find(
      (camera) => camera.id === id || camera.aliases?.includes(id),
    );
  }

  rememberAssignment(entry: SessionEntry): Promise<void> {
    return rememberAssignment(this, entry);
  }

  syncContinuity(force = false): Promise<void> {
    return syncContinuity(this, force);
  }

  clearContinuityNode(id: string): Promise<void> {
    return clearContinuityNode(this, id);
  }

  nodeLoad(node: SessionNode): {
    remote: SessionNodeRemote | undefined;
    capability: SessionNodeRemote['rtspSessions'];
    active: number;
  } {
    return nodeLoad(this, node);
  }

  sourceHealth(): { id: string; available: boolean; expiresAt: number }[] {
    return sourceHealth(this);
  }

  candidates(): SessionNode[] {
    return candidates(this);
  }

  reserveNode(nodeId: string, delta: number): void {
    reserveNode(this, nodeId, delta);
  }

  validNode(node: SessionNode): boolean {
    return validNode(this, node);
  }

  nodeFailure(node: SessionNode, error: unknown): void {
    nodeFailure(this, node, error);
  }

  advertiseHost(node: SessionNode): Promise<string> {
    return advertiseHost(this, node);
  }

  sync(cameras: SessionCamera[]): void {
    this.cameras = cameras;
    const wanted = new Set(
      cameras
        .filter(
          (camera) => camera.enabled && camera.available && this.config.recording_enabled,
        )
        .map((camera) => camera.id),
    );
    for (const [id, buffer] of this.buffers)
      if (!wanted.has(id)) {
        buffer.stopped = true;
        this.buffers.delete(id);
        void this.release(id, this.recordingOwner);
      }
    for (const id of wanted)
      if (!this.buffers.has(id))
        this.buffers.set(id, {
          id,
          dir: '',
          status: 'starting',
          stopped: false,
          inputKind: 'nvr-rtsp',
        });
    for (const entry of this.entries.values())
      if (!cameras.some((camera) => camera.id === entry.cameraId && camera.available))
        void this.release(entry.cameraId, entry.owner);
    void this.tick().catch(() => {});
  }

  ensure(
    camera: SessionCamera | undefined,
    owner: string,
    preview = false,
    preferredNode?: SessionNode,
    refresh = false,
  ): Promise<SessionEntry> {
    return ensureSession(this, camera, owner, preview, preferredNode, refresh);
  }

  acquire(
    camera: SessionCamera,
    owner: string,
    source: NvrCameraSource,
    key: string,
    preferredNode: SessionNode | undefined,
    revision: number,
    refresh = false,
  ): Promise<SessionEntry> {
    return acquireSession(this, camera, owner, source, key, preferredNode, revision, refresh);
  }

  validateSession(value: unknown): asserts value is SessionEntry {
    validateSession(value);
  }

  updateBuffer(entry: SessionEntry): Promise<void> {
    return updateBuffer(this, entry);
  }

  touch(
    camera: SessionCamera,
    owner: string,
    active: boolean,
    preview = false,
  ): Promise<Record<string, unknown>> {
    return touchSession(this, camera, owner, active, preview);
  }

  releaseEntry(entry: SessionEntry): Promise<void> {
    return releaseEntry(this, entry);
  }

  release(cameraId: string, owner: string): Promise<void> {
    return releaseSession(this, cameraId, owner);
  }

  liveCandidates(): SessionNode[] {
    return liveCandidates(this);
  }

  peerEntry(
    camera: SessionCamera,
    owner: string,
    source: SessionEntry,
    node: SessionNode,
  ): Promise<SessionEntry> {
    return peerEntry(this, camera, owner, source, node);
  }

  ensureLive(camera: SessionCamera, owner: string): Promise<SessionEntry> {
    return ensureLive(this, camera, owner);
  }

  viewer(
    camera: SessionCamera,
    owner: string,
    viewerId: string,
    offer: unknown,
  ): Promise<{ answer: { type: string; sdp: string }; candidates: unknown[] }> {
    return openViewer(this, camera, owner, viewerId, offer);
  }

  deleteViewer(viewer: ViewerEntry): Promise<void> {
    return deleteViewer(this, viewer);
  }

  viewerCandidate(
    cameraId: string,
    owner: string,
    viewerId: string,
    candidate: { candidate?: unknown } | undefined,
  ): Promise<unknown> {
    return viewerCandidate(this, cameraId, owner, viewerId, candidate);
  }

  closeViewer(cameraId: string, owner: string, viewerId: string): Promise<{ closed: boolean }> {
    return closeViewer(this, cameraId, owner, viewerId);
  }

  record(event: RecordingEvent | null): Promise<RecordingJob> {
    return recordEvent(this, event);
  }

  reportRecordingFailure(event: RecordingEvent, phase: string, error: unknown): void {
    reportRecordingFailure(this, event, phase, error);
  }

  submitRecord(event: RecordingEvent): Promise<RecordingJob> {
    return submitRecord(this, event);
  }

  finalize(event: RecordingEvent): Promise<void> {
    return finalizeEvent(this, event);
  }

  validateReceipt(value: unknown, event: RecordingEvent): value is DurableReceiptValue {
    return validateReceipt(value, event);
  }

  durableRecording(
    event: RecordingEvent,
    preferredNode?: string,
  ): Promise<{ node: SessionNode; value: DurableReceiptValue } | undefined> {
    return durableRecording(this, event, preferredNode);
  }

  acknowledgeRecording(node: SessionNode, value: DurableReceiptValue): Promise<unknown> {
    return acknowledgeRecording(this, node, value);
  }

  recoverRecordings(): Promise<void> {
    return recoverRecordings(this);
  }

  recoverReadyRecordings(): Promise<void> {
    return recoverReadyRecordings(this);
  }

  finalizeRecording(event: RecordingEvent): Promise<void> {
    return finalizeRecording(this, event);
  }

  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      for (const [key, until] of this.closedViewers)
        if (until < this.now()) this.closedViewers.delete(key);
      for (const buffer of this.buffers.values())
        try {
          await this.ensure(this.camera(buffer.id), this.recordingOwner);
        } catch (error) {
          buffer.status = 'unavailable';
          buffer.lastError =
            (error as Error).message === 'camera_nvr_required'
              ? 'A capable NVR is required'
              : 'Camera NVR source unavailable';
        }
      for (const [key, entry] of this.entries) {
        if (entry.owner === this.recordingOwner && this.buffers.has(entry.cameraId)) continue;
        if (entry.until < this.now()) {
          this.entries.delete(key);
          await this.releaseEntry(entry);
        }
      }
      void this.syncContinuity().catch(() => {});
      void this.recoverRecordings().catch(() => {});
    } finally {
      this.ticking = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    await Promise.allSettled(this.pending.values());
    await Promise.allSettled(this.eventPending.values());
    await this.recoveryPromise?.catch(() => {});
    await Promise.allSettled(this.finalizations.values());
    await Promise.allSettled([...this.entries.values()].map((entry) => this.releaseEntry(entry)));
    this.entries.clear();
  }
}
