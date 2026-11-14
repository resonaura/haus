/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { privateIp } from '../camera/source.js';
import { defaultMediaRuntime, MediaRuntime } from '../pipeline/tools.js';
import type { MediaRuntime as MediaRuntimeType } from '../pipeline/tools.js';
import { NativeCameraViewers } from './native-viewers.js';
import { asEvent, isUuid, producerArgs, viewerArgs } from './native-args.js';
import { logRtpStats, observeSourceRtpStats } from './native-events.js';
import {
  detectStalledProducers,
  handleStalledProducer,
  spawnProducerProcess,
  stopSessionProducers,
  terminateChildProcess,
} from './native-producer.js';
import { reservePort } from './native-ports.js';
import type { PortReservation } from './native-ports.js';
import type {
  NativeCameraSession,
  NativeCameraViewer,
  NativeMediaEvent,
  NativeMediaLog,
  NativeWaiter,
} from './native-types.js';

export interface NativeCameraMediaOptions {
  runtime?: MediaRuntimeType;
  binary?: string;
  ffmpeg?: string;
  spawnProcess?: typeof spawn;
  now?: () => number;
  viewerLimit?: number;
  readyTimeoutMs?: number;
  startupStallMs?: number;
  idleStallMs?: number;
  log?: NativeMediaLog;
}

/** Haus-owned native WebRTC signaling and bounded FFmpeg source/viewer readers. */
export class NativeCameraMedia {
  readonly sessions = new Map<string, NativeCameraSession>();
  readonly viewers: Map<string, NativeCameraViewer>;
  readonly waiters = new Map<string, NativeWaiter>();
  readonly terminating = new Set<Promise<void>>();
  readonly runtime: MediaRuntimeType;
  readonly now: () => number;
  readonly viewerLimit: number;
  readonly readyTimeoutMs: number;
  readonly startupStallMs: number;
  readonly idleStallMs: number;
  readonly logger: NativeMediaLog;
  failed = false;
  stopping = false;
  advertiseHost?: string;
  lineBuffer = '';
  private child?: ChildProcess;
  private exit?: Promise<void>;
  private ready?: Promise<void>;
  private watchdogTimer?: NodeJS.Timeout;
  private readonly viewerManager: NativeCameraViewers;

  constructor(
    _root: string,
    {
      runtime = defaultMediaRuntime,
      binary,
      ffmpeg,
      spawnProcess,
      now = Date.now,
      viewerLimit = 12,
      readyTimeoutMs = 20000,
      startupStallMs = 25000,
      idleStallMs = 20000,
      log = (event, fields) =>
        console.log(JSON.stringify({ component: 'camera-media', event, ...fields })),
    }: NativeCameraMediaOptions = {},
  ) {
    this.runtime = new MediaRuntime({
      tools: {
        ...runtime.tools,
        ...(binary ? { camera: binary } : {}),
        ...(ffmpeg ? { ffmpeg } : {}),
      },
      spawnProcess: spawnProcess ?? runtime.spawnProcess,
    });
    this.now = now;
    this.viewerLimit = viewerLimit;
    this.readyTimeoutMs = readyTimeoutMs;
    this.startupStallMs = startupStallMs;
    this.idleStallMs = idleStallMs;
    this.logger = log;
    this.viewerManager = new NativeCameraViewers(this);
    this.viewers = this.viewerManager.viewers;
  }

  log(event: string, fields: Record<string, unknown> = {}): void {
    try {
      this.logger(event, fields);
    } catch {
      process.emitWarning('camera media diagnostic callback failed');
    }
  }

  async initialize(advertiseHost: string): Promise<void> {
    if (!privateIp(advertiseHost)) throw new Error('invalid_camera_candidate');
    if (this.advertiseHost && this.advertiseHost !== advertiseHost)
      throw new Error('invalid_camera_candidate');
    this.advertiseHost = advertiseHost;
    if (this.ready && !this.failed) return this.ready;
    this.ready = this.start();
    try {
      await this.ready;
    } catch (error) {
      this.ready = undefined;
      throw error;
    }
  }

  private async start(): Promise<void> {
    this.failed = false;
    this.stopping = false;
    this.lineBuffer = '';
    const child = this.runtime.spawn('camera', [], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    this.child = child;
    this.exit = new Promise<void>((resolve) => child.once('close', () => resolve()));
    child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    child.on('error', () => this.fail());
    child.on('close', () => this.fail());
    await this.waitFor('', 'ready', 5000);
    this.startWatchdog();
  }

  onData(chunk: Buffer | string): void {
    this.lineBuffer += chunk.toString();
    if (this.lineBuffer.length > 256 * 1024) {
      this.fail();
      return;
    }
    for (;;) {
      const end = this.lineBuffer.indexOf('\n');
      if (end < 0) break;
      const line = this.lineBuffer.slice(0, end).trim();
      this.lineBuffer = this.lineBuffer.slice(end + 1);
      if (!line || line.length > 65536) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const event = asEvent(parsed);
      if (event) this.onEvent(event);
    }
  }

  onEvent(event: NativeMediaEvent): void {
    if (event.event === 'rtp_stats') {
      observeSourceRtpStats(event, this.sessions, this.now());
      logRtpStats(event, this.sessions, (name, fields) => this.log(name, fields));
      return;
    }
    if (event.event === 'ready') this.resolve('', 'ready', event);
    if (
      (event.event === 'relay_started' || event.event === 'relay_reset') &&
      typeof event.did === 'string'
    )
      this.resolve(event.did, event.event, event);
    if (event.event === 'relay_ready' && typeof event.did === 'string') {
      const session = this.sessions.get(event.did);
      if (session) {
        const readyAt = this.now();
        session.mediaReadyAt = readyAt;
        session.lastSourceRtpAt = readyAt;
        session.restarts = 0;
        session.readyResolve?.();
        session.readyResolve = undefined;
        this.log('source_media_ready', {
          cameraId: session.cameraId,
          sourceKind: session.sourceKind,
          startupMs: Math.max(0, readyAt - (session.producerStartedAt ?? session.startedAt)),
          audio: true,
          video: true,
        });
      }
    }
    this.viewerManager.onEvent(event);
    if (event.event === 'error') {
      const viewerId = isUuid(event.viewer_id) ? event.viewer_id : undefined;
      if (viewerId) this.reject(viewerId, 'viewer_offer');
      else if (typeof event.did === 'string') {
        this.reject(event.did, 'relay_started');
        this.reject(event.did, 'relay_reset');
        for (const viewer of this.viewers.values())
          if (viewer.session.id === event.did) this.reject(viewer.id, 'viewer_offer');
      }
    }
  }

  fail(): void {
    if (this.stopping) return;
    this.failed = true;
    this.ready = undefined;
    this.lineBuffer = '';
    this.stopWatchdog();
    for (const [key, waiter] of this.waiters) {
      this.waiters.delete(key);
      clearTimeout(waiter.timer);
      waiter.reject(new Error('camera_engine_unavailable'));
    }
    this.viewerManager.closeAll();
    stopSessionProducers(this.sessions, (child) => this.trackTermination(child));
  }

  send(value: Record<string, unknown>): void {
    const child = this.child;
    if (this.failed || this.stopping || !child || child.exitCode !== null || !child.stdin)
      throw new Error('camera_engine_unavailable');
    child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  waitFor(id: string, eventName: string, timeoutMs = 5000): Promise<NativeMediaEvent> {
    const key = `${id}:${eventName}`;
    if (this.waiters.has(key)) throw new Error('camera_engine_busy');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(key);
        reject(new Error('camera_engine_timeout'));
      }, timeoutMs);
      timer.unref?.();
      this.waiters.set(key, { resolve, reject, timer });
    });
  }

  resolve(id: string, eventName: string, value: NativeMediaEvent): void {
    const key = `${id}:${eventName}`;
    const waiter = this.waiters.get(key);
    if (!waiter) return;
    this.waiters.delete(key);
    clearTimeout(waiter.timer);
    waiter.resolve(value);
  }

  reject(id: string, eventName: string): void {
    const key = `${id}:${eventName}`;
    const waiter = this.waiters.get(key);
    if (!waiter) return;
    this.waiters.delete(key);
    clearTimeout(waiter.timer);
    waiter.reject(new Error('camera_media_failed'));
  }

  async command(
    value: Record<string, unknown>,
    eventName: string,
    timeoutMs = 5000,
  ): Promise<NativeMediaEvent> {
    const did = typeof value.did === 'string' ? value.did : '';
    const reply = this.waitFor(did, eventName, timeoutMs);
    try {
      this.send(value);
    } catch (error) {
      this.reject(did, eventName);
      throw error;
    }
    return reply;
  }

  async add(
    id: string,
    source: string,
    { sourceKind = 'rtsp', cameraId = id }: { sourceKind?: string; cameraId?: string } = {},
  ): Promise<void> {
    if (!isUuid(id) || typeof source !== 'string' || source.length > 4096)
      throw new Error('invalid_camera_session');
    if (!['rtsp', 'p2p-restream'].includes(sourceKind) || typeof cameraId !== 'string')
      throw new Error('invalid_camera_session');
    if (this.sessions.has(id)) throw new Error('camera_session_exists');
    const reservations: PortReservation[] = [];
    try {
      reservations.push(await reservePort('tcp'));
      reservations.push(await reservePort('udp'));
      reservations.push(await reservePort('udp'));
    } catch (error) {
      await Promise.allSettled(reservations.map(({ release }) => release()));
      throw error;
    }
    const session: NativeCameraSession = {
      id,
      cameraId,
      sourceKind,
      source,
      startedAt: this.now(),
      rtspPort: reservations[0].port,
      videoPort: reservations[1].port,
      audioPort: reservations[2].port,
      viewers: new Set(),
      stopped: false,
      restarts: 0,
      mediaReadyAt: 0,
      readyPromise: Promise.resolve(),
    };
    session.readyPromise = this.newReadyPromise(session);
    this.sessions.set(id, session);
    try {
      await Promise.all(reservations.map(({ release }) => release()));
      await this.command(
        {
          cmd: 'start_relay',
          did: id,
          rtsp_port: session.rtspPort,
          rtp_port: session.videoPort,
          audio_rtp_port: session.audioPort,
          rtsp_path: id,
        },
        'relay_started',
      );
      await this.startProducer(session, false);
    } catch {
      this.log('source_session_start_failed', { cameraId, sourceKind });
      await this.remove(id);
      throw new Error('camera_engine_unavailable');
    }
  }

  private newReadyPromise(session: NativeCameraSession): Promise<void> {
    return new Promise((resolve) => {
      session.readyResolve = resolve;
    });
  }

  producerArgs(session: NativeCameraSession): string[] {
    return producerArgs(session);
  }

  private async startProducer(session: NativeCameraSession, restart: boolean): Promise<void> {
    if (session.stopped || this.sessions.get(session.id) !== session) return;
    if (restart) {
      this.log('source_reader_restarting', {
        cameraId: session.cameraId,
        sourceKind: session.sourceKind,
        attempt: Math.max(1, session.restarts),
      });
      session.mediaReadyAt = 0;
      session.lastSourceRtpAt = undefined;
      if (!session.readyResolve) session.readyPromise = this.newReadyPromise(session);
      await this.command({ cmd: 'reset_relay', did: session.id }, 'relay_reset');
    }
    await spawnProducerProcess(session, this.producerArgs(session), {
      runtime: this.runtime,
      now: this.now,
      isActive: () => this.sessions.get(session.id) === session,
      log: (event, fields) => this.log(event, fields),
      onClose: () => this.scheduleProducerRestart(session),
    });
  }

  private scheduleProducerRestart(session: NativeCameraSession): void {
    if (session.restartTimer || session.stopped) return;
    const delay = Math.min(30000, 500 * 2 ** Math.min(session.restarts++, 6));
    session.restartTimer = setTimeout(() => {
      session.restartTimer = undefined;
      void this.startProducer(session, true).catch(() => {
        this.log('source_reader_restart_failed', {
          cameraId: session.cameraId,
          sourceKind: session.sourceKind,
        });
        this.scheduleProducerRestart(session);
      });
    }, delay);
    session.restartTimer.unref?.();
  }

  localRtsp(id: string): string {
    const session = this.sessions.get(id);
    if (!session) throw new Error('camera_session_not_found');
    return `rtsp://127.0.0.1:${session.rtspPort}/${id}`;
  }

  async waitUntilReady(session: NativeCameraSession): Promise<void> {
    if (session.mediaReadyAt && this.now() - session.mediaReadyAt < 30000) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        session.readyPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('camera_stream_warming')), this.readyTimeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  viewerArgs(session: NativeCameraSession, viewer: NativeCameraViewer): string[] {
    return viewerArgs(this.localRtsp(session.id), session, viewer);
  }

  offer(sessionId: string, owner: string, offer: string): ReturnType<NativeCameraViewers['offer']> {
    return this.viewerManager.offer(sessionId, owner, offer);
  }

  candidate(viewerId: string, owner: string, value: unknown): void {
    this.viewerManager.candidate(viewerId, owner, value);
  }

  closeViewer(viewerId: string, owner?: string): void {
    this.viewerManager.closeViewer(viewerId, owner);
  }

  async trackTermination(child: ChildProcess): Promise<void> {
    const task = terminateChildProcess(child).finally(() => this.terminating.delete(task));
    this.terminating.add(task);
    return task;
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    const timer = setInterval(() => this.checkProducers(), 5000);
    timer.unref?.();
    this.watchdogTimer = timer;
  }

  private stopWatchdog(): void {
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = undefined;
  }

  checkProducers(): void {
    if (this.failed || this.stopping) return;
    detectStalledProducers({
      sessions: this.sessions.values(),
      now: this.now(),
      startupStallMs: this.startupStallMs,
      idleStallMs: this.idleStallMs,
      onStalled: (session, reason) =>
        handleStalledProducer(session, reason, {
          log: (event, fields) => this.log(event, fields),
          onResetReady: (target) => {
            target.mediaReadyAt = 0;
            if (!target.readyResolve) target.readyPromise = this.newReadyPromise(target);
          },
          terminate: (child) => this.trackTermination(child),
        }),
    });
  }

  async remove(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    session.stopped = true;
    clearTimeout(session.restartTimer);
    this.sessions.delete(id);
    this.viewerManager.closeForSession(session);
    if (session.producer) await this.trackTermination(session.producer);
    try {
      this.send({ cmd: 'stop_relay', did: id });
    } catch {
      this.log('source_relay_stop_unavailable', { cameraId: session.cameraId });
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.exit ?? Promise.resolve();
    this.stopping = true;
    this.stopWatchdog();
    for (const id of Array.from(this.sessions.keys())) await this.remove(id);
    this.viewerManager.closeAll();
    await Promise.allSettled(this.terminating);
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.stdin?.write('{"cmd":"exit"}\n');
      const kill = setTimeout(() => child.kill('SIGKILL'), 1500);
      child.stdin?.end();
      await this.exit;
      clearTimeout(kill);
    }
    this.failed = true;
  }
}
