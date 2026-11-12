/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { defaultMediaRuntime, type MediaRuntime } from '@haus/media/pipeline';
import { spawnHomeKitSnapshot } from '@haus/media/stream';
import type {
  CameraAccessResult,
  CameraService,
  CameraSnapshot,
  CameraSummary,
  DetectorSummary,
} from './types.js';
import { RecordingStore } from '../events/recording.store.js';
import { Recorder } from '../events/recorder/recorder.js';
import { NativeCameraRuntime } from './control/runtime.js';

export interface CameraConfig {
  id: string;
  name: string;
  rtspUrl?: string;
  snapshotUrl?: string;
  snapshotFetch?: () => Promise<Buffer | null>;
  onOperatingChange?: (control: 'indicator' | 'nightVision', value: boolean) => Promise<void>;
  enabled?: boolean;
  operating?: {
    indicator?: boolean;
    nightVision?: boolean;
  };
  homekit?: {
    paired?: boolean;
    setupUri?: string;
  };
}

@Injectable()
export class DefaultCameraService implements CameraService {
  private readonly cameras = new Map<string, CameraConfig>();
  private readonly warmKeepalives = new Map<string, Map<string, number>>();
  private readonly viewerSessions = new Map<string, Map<string, unknown>>();
  private readonly cachedSnapshots = new Map<string, { buffer: Buffer; at: number }>();
  private readonly pendingSnapshots = new Map<string, Promise<CameraSnapshot>>();
  private readonly mediaRuntime: MediaRuntime = defaultMediaRuntime;

  constructor(
    @Optional() private readonly store?: RecordingStore,
    @Optional() private readonly recorder?: Recorder,
    @Optional() @Inject(NativeCameraRuntime) private readonly nativeCameras?: NativeCameraRuntime,
  ) {}

  registerCamera(camera: CameraConfig): void {
    this.cameras.set(camera.id, camera);
  }

  async listCameras(): Promise<CameraSummary[]> {
    const list: CameraSummary[] = [];
    const native = new Map(
      (this.nativeCameras?.cameras() ?? []).map((camera) => [camera.id, camera]),
    );
    for (const cam of this.cameras.values()) {
      const nativeCamera = native.get(cam.id);
      native.delete(cam.id);
      list.push({
        id: cam.id,
        name: cam.name,
        state: nativeCamera
          ? nativeCamera.available
            ? 'online'
            : 'offline'
          : cam.enabled
            ? 'online'
            : 'offline',
        operating: nativeCamera ? this.nativeCameras?.operating(cam.id) : cam.operating,
        spotlight: nativeCamera ? this.nativeCameras?.spotlight(cam.id) : undefined,
        homekit: cam.homekit,
        talkAvailable: true,
      });
    }
    for (const camera of native.values()) {
      list.push({
        id: camera.id,
        name: camera.name ?? camera.id,
        state: camera.available ? 'online' : 'offline',
        operating: this.nativeCameras?.operating(camera.id),
        spotlight: this.nativeCameras?.spotlight(camera.id),
        talkAvailable: Boolean(camera.nativeTalkback),
      });
    }
    return list;
  }

  async listDetectors(): Promise<DetectorSummary[]> {
    return [
      { id: 'detector.coral', name: 'Google Coral EdgeTPU', kind: 'tpu' },
      { id: 'detector.cpu', name: 'CPU Motion Detector', kind: 'cpu' },
    ];
  }

  async bootstrapAccess(cameraId: string, clientId: string): Promise<CameraAccessResult> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    const token = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + 3600000;
    return { token, expiresAt, clientId, cameraId };
  }

  getSnapshot(cameraId: string): Promise<CameraSnapshot> {
    const pending = this.pendingSnapshots.get(cameraId);
    if (pending) return pending;
    const task = this.loadSnapshot(cameraId).finally(() => {
      this.pendingSnapshots.delete(cameraId);
    });
    this.pendingSnapshots.set(cameraId, task);
    return task;
  }

  private async loadSnapshot(cameraId: string): Promise<CameraSnapshot> {
    const cam = this.cameras.get(cameraId);
    const native = this.nativeCameras?.cameras().find((camera) => camera.id === cameraId);
    if (!cam && !native) throw new Error('camera_not_found');

    if (native && this.nativeCameras) {
      try {
        const snapshot = await this.nativeCameras.snapshot(cameraId);
        this.cachedSnapshots.set(cameraId, { buffer: snapshot.buffer, at: snapshot.at });
        return snapshot;
      } catch {
        // Keep a previously validated frame available while the provider recovers.
      }
    }

    if (cam?.snapshotFetch) {
      try {
        const buf = await cam.snapshotFetch();
        if (buf && buf.length > 0) {
          const at = Date.now();
          this.cachedSnapshots.set(cameraId, { buffer: buf, at });
          return { mime: 'image/jpeg', buffer: buf, at };
        }
      } catch {
        // Fall back to cached or RTSP capture
      }
    }

    if (cam?.rtspUrl) {
      try {
        const buf = await this.captureRtspSnapshot(cam.rtspUrl);
        if (buf && buf.length > 0) {
          const at = Date.now();
          this.cachedSnapshots.set(cameraId, { buffer: buf, at });
          return { mime: 'image/jpeg', buffer: buf, at };
        }
      } catch {
        // Fall back to a previously captured frame below
      }
    }

    const cached = this.cachedSnapshots.get(cameraId);
    if (cached) {
      return { mime: 'image/jpeg', buffer: cached.buffer, at: cached.at, stale: true };
    }

    throw new Error('snapshot_unavailable');
  }

  private async captureRtspSnapshot(rtspUrl: string, timeoutMs = 6000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawnHomeKitSnapshot(this.mediaRuntime, rtspUrl);
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(new Error('rtsp_snapshot_timeout'));
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`rtsp_snapshot_exit_${code}`));
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async updateCamera(cameraId: string, update: Record<string, unknown>): Promise<CameraSummary> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    if (typeof update.name === 'string') cam.name = update.name;
    if (typeof update.enabled === 'boolean') cam.enabled = update.enabled;
    return {
      id: cam.id,
      name: cam.name,
      state: cam.enabled ? 'online' : 'offline',
      operating: cam.operating,
      homekit: cam.homekit,
    };
  }

  async setOperating(
    cameraId: string,
    control: 'indicator' | 'nightVision',
    entityId: string,
    value: boolean,
  ): Promise<{ accepted: boolean }> {
    if (this.nativeCameras?.manages(cameraId)) {
      await this.nativeCameras.writeOperating(cameraId, control, entityId, value);
      return { accepted: true };
    }
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    if (!cam.operating) cam.operating = {};
    cam.operating[control] = value;
    if (cam.onOperatingChange) {
      await cam.onOperatingChange(control, value);
    }
    return { accepted: true };
  }

  async setSpotlight(
    cameraId: string,
    entityId: string,
    value: unknown,
  ): Promise<{ accepted: boolean }> {
    if (!this.nativeCameras?.manages(cameraId)) throw Error('spotlight_unavailable');
    await this.nativeCameras.writeSpotlight(cameraId, entityId, value);
    return { accepted: true };
  }

  async viewerOffer(
    cameraId: string,
    owner: string,
    viewerId: string,
    _offer?: unknown,
  ): Promise<unknown> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    let sessions = this.viewerSessions.get(cameraId);
    if (!sessions) {
      sessions = new Map();
      this.viewerSessions.set(cameraId, sessions);
    }
    sessions.set(`${owner}:${viewerId}`, { startedAt: Date.now() });
    return {
      type: 'answer',
      sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=HausViewer\r\nt=0 0\r\n',
    };
  }

  async closeViewer(cameraId: string, owner: string, viewerId: string): Promise<unknown> {
    const sessions = this.viewerSessions.get(cameraId);
    sessions?.delete(`${owner}:${viewerId}`);
    return { closed: true };
  }

  async touchWarm(
    cameraId: string,
    owner: string,
    active: boolean,
    _preview?: boolean,
  ): Promise<unknown> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    let keepalives = this.warmKeepalives.get(cameraId);
    if (!keepalives) {
      keepalives = new Map();
      this.warmKeepalives.set(cameraId, keepalives);
    }
    if (active) {
      keepalives.set(owner, Date.now());
    } else {
      keepalives.delete(owner);
    }
    return { active: keepalives.size > 0 };
  }

  async triggerRecording(cameraId: string): Promise<unknown> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    if (!this.recorder) throw new ServiceUnavailableException('recording_worker_unavailable');
    const event = await this.recorder.trigger(cameraId);
    return { started: true, jobId: event.id, cameraId: event.cameraId };
  }

  async getHomeKitPairing(cameraId: string): Promise<unknown> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    return {
      paired: cam.homekit?.paired ?? false,
      uri: cam.homekit?.setupUri ?? '',
    };
  }

  async manageHomeKitPairing(cameraId: string, action: 'close' | 'reset'): Promise<unknown> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    if (!cam.homekit) cam.homekit = {};
    if (action === 'reset') {
      cam.homekit.paired = false;
    }
    return { paired: cam.homekit.paired ?? false, action };
  }

  async updateHomeKitSettings(cameraId: string, settings: unknown): Promise<unknown> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    return { status: 'ok', cameraId, settings };
  }
}
