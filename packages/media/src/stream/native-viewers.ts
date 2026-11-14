/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { MediaRuntime } from '../pipeline/tools.js';
import type { NativeCameraSession, NativeCameraViewer, NativeMediaEvent } from './native-types.js';
import { isUuid, rewriteAnswer, safeMediaError, viewerArgs } from './native-args.js';

interface NativeCameraViewerHost {
  readonly sessions: Map<string, NativeCameraSession>;
  readonly runtime: MediaRuntime;
  readonly viewerLimit: number;
  readonly advertiseHost?: string;
  readonly failed: boolean;
  readonly stopping: boolean;
  now(): number;
  log(event: string, fields: Record<string, unknown>): void;
  send(value: Record<string, unknown>): void;
  waitFor(id: string, eventName: string, timeoutMs?: number): Promise<NativeMediaEvent>;
  resolve(id: string, eventName: string, event: NativeMediaEvent): void;
  reject(id: string, eventName: string): void;
  localRtsp(id: string): string;
  waitUntilReady(session: NativeCameraSession): Promise<void>;
  trackTermination(child: ChildProcess): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mediaPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;

/** Owns viewer signaling and per-viewer FFmpeg readers for the native camera engine. */
export class NativeCameraViewers {
  readonly viewers = new Map<string, NativeCameraViewer>();

  constructor(private readonly host: NativeCameraViewerHost) {}

  onEvent(event: NativeMediaEvent): void {
    const viewerId = isUuid(event.viewer_id) ? event.viewer_id : undefined;
    if (event.event === 'viewer_offer' && viewerId) {
      this.resolve(viewerId, 'viewer_offer', event);
      return;
    }
    if (event.event !== 'viewer_state' || !viewerId) return;
    const viewer = this.viewers.get(viewerId);
    if (!viewer) return;
    if (event.state === 'connected') {
      viewer.connected = true;
      clearTimeout(viewer.connectTimer);
      this.host.log('viewer_connected', {
        cameraId: viewer.session.cameraId,
        viewerId: viewer.id,
        handshakeMs: Math.max(0, this.host.now() - viewer.startedAt),
      });
      this.activateViewer(viewer);
    } else if (event.state === 'closed') {
      this.closeViewer(viewerId, viewer.owner);
    }
  }

  resolve(id: string, eventName: string, event: NativeMediaEvent): void {
    this.host.resolve(id, eventName, event);
  }

  reject(id: string, eventName: string): void {
    this.host.reject(id, eventName);
  }

  async offer(
    sessionId: string,
    owner: string,
    offer: string,
  ): Promise<{ viewerId: string; answer: Record<string, unknown>; candidates: unknown[] }> {
    const session = this.host.sessions.get(sessionId);
    if (!session || this.host.failed || this.host.stopping)
      throw new Error('camera_engine_unavailable');
    if (
      typeof offer !== 'string' ||
      offer.length > 65536 ||
      !offer.startsWith('v=0') ||
      !/^m=video /m.test(offer) ||
      !/^m=audio /m.test(offer) ||
      !/a=rtpmap:\d+\s+opus\/48000/i.test(offer) ||
      /^a=(?:sendonly|sendrecv)$/m.test(offer)
    )
      throw new Error('invalid_camera_offer');
    if (this.viewers.size >= this.host.viewerLimit) throw new Error('camera_viewer_busy');
    const readinessStartedAt = this.host.now();
    try {
      await this.host.waitUntilReady(session);
    } catch (error) {
      this.host.log('viewer_wait_failed', {
        cameraId: session.cameraId,
        sourceKind: session.sourceKind,
        waitedMs: Math.max(0, this.host.now() - readinessStartedAt),
        reason:
          error instanceof Error && error.message === 'camera_stream_warming'
            ? 'warming_timeout'
            : 'media_unavailable',
      });
      throw error;
    }
    const viewer: NativeCameraViewer = {
      id: randomUUID(),
      session,
      owner,
      startedAt: this.host.now(),
      videoPort: 0,
      audioPort: 0,
      closed: false,
      connected: false,
      signaled: false,
      restarts: 0,
    };
    const response = this.host.waitFor(viewer.id, 'viewer_offer', 8000);
    this.viewers.set(viewer.id, viewer);
    session.viewers.add(viewer.id);
    try {
      this.host.send({
        cmd: 'start_viewer',
        viewer_id: viewer.id,
        did: sessionId,
        sdp: offer,
      });
      const answer = await response;
      if (!mediaPort(answer.rtp_port) || !mediaPort(answer.audio_rtp_port))
        throw new Error('camera_webrtc_failed');
      viewer.videoPort = answer.rtp_port;
      viewer.audioPort = answer.audio_rtp_port;
      viewer.signaled = true;
      if (!viewer.connected) {
        viewer.connectTimer = setTimeout(() => this.closeViewer(viewer.id, viewer.owner), 15000);
        viewer.connectTimer.unref?.();
      }
      this.activateViewer(viewer);
      return {
        viewerId: viewer.id,
        answer: {
          type: 'answer',
          sdp: rewriteAnswer(answer.sdp, this.host.advertiseHost ?? ''),
        },
        candidates: [],
      };
    } catch {
      this.closeViewer(viewer.id, owner);
      throw new Error('camera_webrtc_failed');
    }
  }

  candidate(viewerId: string, owner: string, value: unknown): void {
    const viewer = this.viewers.get(viewerId);
    if (
      !viewer ||
      viewer.owner !== owner ||
      !isRecord(value) ||
      typeof value.candidate !== 'string' ||
      value.candidate.length > 2048 ||
      typeof value.sdpMid !== 'string' ||
      value.sdpMid.length > 64 ||
      !value.candidate.startsWith('candidate:')
    )
      throw new Error('invalid_camera_candidate');
    this.host.send({
      cmd: 'viewer_candidate',
      viewer_id: viewerId,
      candidate: value.candidate,
      mid: value.sdpMid,
    });
  }

  private async startViewerProcess(viewer: NativeCameraViewer): Promise<void> {
    if (viewer.closed || this.viewers.get(viewer.id) !== viewer) return;
    const child = this.host.runtime.spawn(
      'ffmpeg',
      viewerArgs(this.host.localRtsp(viewer.session.id), viewer.session, viewer),
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8192);
    });
    viewer.process = child;
    viewer.processStartedAt = this.host.now();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('camera_viewer_spawn_timeout')), 5000);
      timer.unref?.();
      child.once('spawn', () => {
        clearTimeout(timer);
        resolve();
      });
      child.once('error', () => {
        clearTimeout(timer);
        reject(new Error('camera_viewer_spawn_failed'));
      });
    });
    child.once('close', () => {
      if (viewer.process === child) viewer.process = undefined;
      if (!viewer.closed && this.viewers.get(viewer.id) === viewer) {
        if (
          viewer.processStartedAt !== undefined &&
          this.host.now() - viewer.processStartedAt >= 10000
        ) {
          viewer.restarts = 0;
        }
        this.host.log('viewer_reader_closed', {
          cameraId: viewer.session.cameraId,
          viewerId: viewer.id,
          exitCode: Number.isInteger(child.exitCode) ? child.exitCode : null,
          signal: typeof child.signalCode === 'string' ? child.signalCode : null,
          detail: safeMediaError(stderr) || undefined,
        });
        if (viewer.restarts++ >= 4) this.closeViewer(viewer.id, viewer.owner);
        else {
          const timer = setTimeout(
            () => {
              viewer.restartTimer = undefined;
              void this.startViewerProcess(viewer).catch(() => {
                this.host.log('viewer_reader_restart_failed', {
                  cameraId: viewer.session.cameraId,
                  viewerId: viewer.id,
                });
                this.closeViewer(viewer.id, viewer.owner);
              });
            },
            Math.min(4000, 250 * 2 ** viewer.restarts),
          );
          timer.unref?.();
          viewer.restartTimer = timer;
        }
      }
    });
  }

  private activateViewer(viewer: NativeCameraViewer): void {
    if (
      viewer.closed ||
      !viewer.connected ||
      !viewer.signaled ||
      viewer.process ||
      viewer.starting ||
      this.viewers.get(viewer.id) !== viewer
    )
      return;
    viewer.starting = this.startViewerProcess(viewer)
      .catch(() => {
        this.host.log('viewer_reader_start_failed', {
          cameraId: viewer.session.cameraId,
          viewerId: viewer.id,
        });
        this.closeViewer(viewer.id, viewer.owner);
      })
      .finally(() => {
        viewer.starting = undefined;
      });
  }

  closeForSession(session: NativeCameraSession): void {
    for (const viewerId of session.viewers) this.closeViewer(viewerId);
  }

  closeViewer(id: string, owner?: string): void {
    const viewer = this.viewers.get(id);
    if (!viewer || (owner !== undefined && owner !== viewer.owner)) return;
    viewer.closed = true;
    this.host.log('viewer_closed', {
      cameraId: viewer.session.cameraId,
      viewerId: id,
    });
    clearTimeout(viewer.connectTimer);
    this.viewers.delete(id);
    viewer.session.viewers.delete(id);
    this.reject(id, 'viewer_offer');
    clearTimeout(viewer.restartTimer);
    const child = viewer.process;
    viewer.process = undefined;
    if (child)
      void this.host.trackTermination(child).catch(() => {
        this.host.log('viewer_reader_stop_failed', {
          cameraId: viewer.session.cameraId,
          viewerId: id,
        });
      });
    try {
      this.host.send({ cmd: 'stop_viewer', viewer_id: id });
    } catch {
      this.host.log('viewer_stop_unavailable', {
        cameraId: viewer.session.cameraId,
        viewerId: id,
      });
    }
  }

  closeAll(): void {
    for (const id of Array.from(this.viewers.keys())) this.closeViewer(id);
  }
}
