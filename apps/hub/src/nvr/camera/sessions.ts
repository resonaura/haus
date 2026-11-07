/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { openPeerRtsp, cameraSource, cameraId, ownerId, privateIp } from '@haus/media/camera';
import { CameraRing, type CameraRingOptions } from '@haus/media/recording';
import type { OpenPeerRtspOptions } from '@haus/media/camera';
import type { MediaRuntime } from '@haus/media/pipeline';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleCameraSessions } from './sessions-http.js';
import { viewerSessionId } from './viewer.js';

import type { CameraSessionsSource, CameraSessionsEngine, CameraSessionsBlobs, CameraSessionsSession, CameraSessionsSessionDescription, CameraSessionsOptions, CameraSessionAcquireInput, CameraSessionsRing, CameraSessionsRecordings } from './contracts.js';
export type { CameraSessionsSource, CameraSessionsEngine, CameraSessionsBlobs, CameraSessionsSession, CameraSessionsSessionDescription, CameraSessionsOptions, CameraSessionsRing, CameraSessionsRecordings } from './contracts.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Signed controller leases own producers. Browsers never receive RTSP credentials. */
export class CameraSessions {
  readonly sessions = new Map<string, CameraSessionsSession>();
  readonly byCamera = new Map<string, CameraSessionsSession>();
  readonly pending = new Map<string, Promise<unknown>>();
  closed = false;
  serving = 0;
  otherStreams = (): number => 0;
  finalizerBusy = false;
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private stopping?: Promise<void>;

  private readonly root: string;
  readonly engine: CameraSessionsEngine;
  private readonly capacity?: CameraSessionsOptions['capacity'];
  private readonly blobs?: CameraSessionsBlobs;
  readonly recordings?: CameraSessionsRecordings;
  private readonly runtime?: MediaRuntime;
  private readonly max: number;
  readonly now: () => number;
  private readonly sourceImpl: (
    input: { kind: unknown; url: unknown },
    resolve?: Parameters<typeof cameraSource>[1],
  ) => Promise<CameraSessionsSource>;
  private readonly ringFn: (path: string, input: string, options: CameraRingOptions) => CameraSessionsRing;

  constructor(root: string, engine: CameraSessionsEngine, options: CameraSessionsOptions = {}) {
    this.root = root;
    this.engine = engine;
    this.capacity = options.capacity;
    this.blobs = options.blobs;
    this.recordings = options.recordings;
    this.runtime = options.runtime;
    this.max = options.max ?? 4;
    this.now = options.now ?? Date.now;
    const defaultSource: CameraSessionsOptions['source'] = async (input, resolve) => {
      const result = await cameraSource(input, resolve);
      return { kind: String(result.kind), url: result.url };
    };
    this.sourceImpl = options.source ?? defaultSource;
    this.ringFn = options.ring ?? ((path, input, options) => new CameraRing(path, input, options));
  }

  async initialize(): Promise<this> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.root))
      if (/^[a-f0-9-]{36}$/.test(name))
        await rm(join(this.root, name), { recursive: true, force: true });
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick().catch(() => {}), 1000);
      this.timer.unref();
    }
    return this;
  }

  status(): {
    profile: number;
    active: number;
    max: number;
    webrtc: boolean;
    recording: boolean;
  } {
    return {
      profile: 1,
      active: this.sessions.size,
      max:
        this.closed || this.capacity?.pressured ? 0 : Math.max(0, this.max - this.otherStreams()),
      webrtc: true,
      recording: true,
    };
  }

  describe(session: CameraSessionsSession): CameraSessionsSessionDescription {
    return {
      id: session.id,
      state: session.ring?.ready() ? 'ready' : 'warming',
      expiresAt: Math.max(0, ...session.owners.values()),
      capabilities: { webrtc: true, recording: true },
      audio: session.ring?.metadata?.audio === true,
      preRollSeconds: session.preRollSeconds,
      requireAudio: session.requireAudio,
      recordAudio: session.recordAudio,
    };
  }

  source(input: { kind?: unknown; url?: unknown }): Promise<CameraSessionsSource> {
    return this.sourceImpl({ kind: input.kind, url: input.url });
  }

  async acquire(input: unknown): Promise<CameraSessionsSessionDescription> {
    const record = isRecord(input) ? input : {};
    const cameraIdValue = typeof record.cameraId === 'string' ? record.cameraId : '';
    const ownerValue = typeof record.owner === 'string' ? record.owner : '';
    const advertiseHost = typeof record.advertiseHost === 'string' ? record.advertiseHost : '';
    const sourceValue = isRecord(record.source)
      ? {
          kind: record.source.kind,
          url: typeof record.source.url === 'string' ? record.source.url : '',
        }
      : { kind: 'rtsp', url: '' };
    const peerRecord = isRecord(record.peer) ? record.peer : undefined;
    const peerValue: OpenPeerRtspOptions | undefined = peerRecord
      ? {
          token: typeof peerRecord.token === 'string' ? peerRecord.token : '',
          path: typeof peerRecord.path === 'string' ? peerRecord.path : '',
          url: typeof peerRecord.url === 'string' ? peerRecord.url : '',
          ...(typeof peerRecord.allowHttp === 'boolean' ? { allowHttp: peerRecord.allowHttp } : {}),
        }
      : undefined;
    const requireAudioValue =
      typeof record.requireAudio === 'boolean' ? record.requireAudio : undefined;
    const recordAudioValue =
      typeof record.recordAudio === 'boolean' ? record.recordAudio : undefined;
    const preRollValue =
      typeof record.preRollSeconds === 'number' ? record.preRollSeconds : undefined;
    if (
      !cameraId(cameraIdValue) ||
      !ownerId(ownerValue) ||
      !privateIp(advertiseHost) ||
      (record.recordAudio !== undefined && typeof record.recordAudio !== 'boolean') ||
      (record.requireAudio !== undefined && typeof record.requireAudio !== 'boolean') ||
      (preRollValue !== undefined &&
        (!Number.isInteger(preRollValue) || preRollValue < 0 || preRollValue > 30))
    )
      throw new Error('invalid_camera_session');
    const acquireInput: CameraSessionAcquireInput = {
      cameraId: cameraIdValue,
      owner: ownerValue,
      advertiseHost,
      source: sourceValue,
      peer: peerValue,
      requireAudio: requireAudioValue,
      preRollSeconds: preRollValue,
      recordAudio: recordAudioValue,
    };
    const selected = acquireInput.peer
      ? {
          kind: 'rtsp',
          url: `peer:${createHash('sha256').update(JSON.stringify(acquireInput.peer)).digest('hex')}`,
          peer: acquireInput.peer,
        }
      : await this.sourceImpl(acquireInput.source ?? { kind: 'rtsp', url: '' });
    const prior = this.pending.get(acquireInput.cameraId);
    if (prior) {
      await prior.catch(() => {});
      return this.acquire(input);
    }
    const task = this.open(acquireInput, selected);
    this.pending.set(acquireInput.cameraId, task);
    try {
      return await task;
    } finally {
      if (this.pending.get(acquireInput.cameraId) === task)
        this.pending.delete(acquireInput.cameraId);
    }
  }

  private async open(
    input: CameraSessionAcquireInput,
    selected: CameraSessionsSource,
  ): Promise<CameraSessionsSessionDescription> {
    if (this.closed) throw new Error('camera_sessions_stopped');
    let existing = this.byCamera.get(input.cameraId);
    if (existing?.ring?.failed || this.engine.failed) {
      for (const session of Array.from(this.sessions.values()))
        if (session === existing || this.engine.failed) await this.remove(session);
      existing = undefined;
    }
    if (
      existing &&
      existing.source.url === selected.url &&
      existing.source.kind === selected.kind &&
      existing.requireAudio === (input.requireAudio ?? true) &&
      existing.recordAudio === (input.recordAudio ?? true)
    ) {
      if (!existing.owners.has(input.owner) && existing.owners.size >= 32)
        throw new Error('camera_owner_busy');
      existing.owners.set(input.owner, this.now() + 60000);
      return this.describe(existing);
    }
    // A credential/source rotation gets a new private name. Existing owners keep
    // their last producer until their own leases expire or the replacement is ready.
    const rotation = Boolean(existing);
    if (
      this.capacity?.pressured ||
      this.sessions.size + this.otherStreams() >= this.max + (rotation ? 1 : 0) ||
      (rotation && [...this.sessions.values()].some((session) => session.rotation))
    )
      throw new Error('camera_session_busy');
    const id = randomUUID();
    const session: CameraSessionsSession = {
      id,
      cameraId: input.cameraId,
      source: selected,
      preRollSeconds: input.preRollSeconds ?? 8,
      requireAudio: input.requireAudio ?? true,
      recordAudio: input.recordAudio ?? true,
      rotation,
      owners: new Map([[input.owner, this.now() + 60000]]),
    };
    this.sessions.set(id, session);
    try {
      if (selected.peer) session.peer = await openPeerRtsp(selected.peer);
      await this.engine.initialize(input.advertiseHost);
      await this.engine.add(id, session.peer?.url ?? selected.url, {
        sourceKind: selected.kind,
        cameraId: session.cameraId,
      });
      session.ring = this.ringFn(join(this.root, id), session.peer?.url ?? selected.url, {
        now: this.now,
        log: (event, fields) => this.engine.log?.(event, { cameraId: session.cameraId, ...fields }),
        requireAudio: session.requireAudio,
        recordAudio: session.recordAudio,
        runtime: this.runtime,
        retentionSeconds: session.preRollSeconds + 40,
        acquireFinalizer: () => {
          if (this.finalizerBusy) return undefined;
          this.finalizerBusy = true;
          return () => {
            this.finalizerBusy = false;
          };
        },
        onRecordingReady: async (job) => {
          await this.recordings?.preserve(job);
        },
        onRecordingFailed: async (job, error) => {
          await this.recordings?.interruptActivity(
            job.id,
            error instanceof Error ? error.message : String(error),
          );
        },
        reserve: (bytes) =>
          this.blobs?.reserveWorkspace?.(bytes) ??
          this.blobs?.reserveTransient?.(bytes) ??
          Promise.resolve(() => {}),
      });
      await session.ring.start();
      if (this.closed) throw new Error('camera_sessions_stopped');
      this.byCamera.set(session.cameraId, session);
      if (existing) existing.replacement = session;
      return this.describe(session);
    } catch {
      session.peer?.stop();
      await session.ring?.stop().catch(() => {});
      await this.engine.remove(id);
      this.sessions.delete(id);
      throw new Error('camera_session_unavailable');
    }
  }

  owned(id: string, owner?: string): CameraSessionsSession {
    const session = this.sessions.get(id);
    if (
      !session ||
      typeof owner !== 'string' ||
      !ownerId(owner) ||
      (session.owners.get(owner) ?? 0) <= this.now()
    )
      throw new Error('camera_session_not_found');
    return session;
  }

  renew(id: string, owner: string): CameraSessionsSessionDescription {
    const session = this.owned(id, owner);
    const replacement = session.replacement;
    if (
      replacement &&
      this.sessions.get(replacement.id) === replacement &&
      replacement.ring &&
      replacement.ring.ready()
    ) {
      replacement.owners.set(owner, this.now() + 60000);
      if (this.recording(session)) session.owners.set(owner, this.now() + 60000);
      return this.describe(replacement);
    }
    session.owners.set(owner, this.now() + 60000);
    return this.describe(session);
  }

  async offer(id: string, owner: string, offer: string): ReturnType<CameraSessionsEngine['offer']> {
    const session = this.owned(id, owner);
    const ring = session.ring;
    if (ring && !ring.ready()) {
      const deadline = this.now() + 10000;
      while (!ring.ready() && !ring.failed && this.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 200));
      if (!ring.ready()) throw new Error('camera_stream_warming');
    }
    return this.engine.offer(session.id, owner, offer);
  }

  async release(id: string, owner: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session || !ownerId(owner) || !session.owners.has(owner))
      throw new Error('camera_session_not_found');
    for (const [leaseOwner, until] of session.owners) {
      if (until > this.now()) continue;
      session.owners.delete(leaseOwner);
      for (const [viewerId, viewer] of this.engine.viewers)
        if (
          viewerSessionId(viewer) === id &&
          viewer.owner === leaseOwner
        )
          this.engine.closeViewer(viewerId, leaseOwner);
    }
    session.owners.delete(owner);
    for (const [viewerId, viewer] of this.engine.viewers)
      if (
        viewerSessionId(viewer) === id &&
        viewer.owner === owner
      )
        this.engine.closeViewer(viewerId, owner);
    if (!session.owners.size && !this.recording(session)) await this.remove(session);
  }

  recording(session: CameraSessionsSession): boolean {
    return [...(session.ring?.jobs.values() ?? [])].some(
      (job) =>
        ['recording', 'preparing'].includes(job.state) ||
        (job.state === 'ready' && this.now() - (job.completedAt ?? this.now()) < 60000),
    );
  }

  async remove(session: CameraSessionsSession): Promise<void> {
    if (this.sessions.get(session.id) !== session) return;
    this.sessions.delete(session.id);
    if (this.byCamera.get(session.cameraId) === session) this.byCamera.delete(session.cameraId);
    if (session.replacement) session.replacement.rotation = false;
    await session.ring?.stop();
    await this.engine.remove(session.id);
    session.peer?.stop();
  }

  async tick(): Promise<void> {
    if (this.ticking || this.closed) return;
    this.ticking = true;
    try {
      for (const session of this.sessions.values()) {
        if (!session.ring) continue;
        for (const [owner, until] of session.owners)
          if (until <= this.now()) {
            session.owners.delete(owner);
            for (const [viewerId, viewer] of this.engine.viewers)
              if (
                viewerSessionId(viewer) ===
                  session.id &&
                viewer.owner === owner
              )
                this.engine.closeViewer(viewerId, owner);
          }
        if (
          session.ring.failed ||
          this.engine.failed ||
          (!session.owners.size && !this.recording(session)) ||
          this.now() - (session.ring.freshAt ?? session.ring.startedAt) > 30000
        ) {
          await this.remove(session);
          continue;
        }
        await session.ring.sample();
      }
    } finally {
      this.ticking = false;
    }
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    return handleCameraSessions(this, req, res, path);
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.close();
    return this.stopping;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled(this.pending.values());
    await Promise.allSettled([...this.sessions.values()].map((session) => this.remove(session)));
    await this.engine.stop();
  }
}
