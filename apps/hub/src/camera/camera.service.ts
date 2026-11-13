/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { defaultMediaRuntime, type MediaRuntime } from '@haus/media/pipeline';
import { captureBufferFrame, captureRtspFrame } from './control/frame.js';
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
import { CAMERA_SNAPSHOTS, CAMERA_TALKBACK } from './tokens.js';
import { CameraSnapshots, type SnapshotCamera } from './control/snapshots.js';
import { customTalkback, type Talkback, type TalkbackCamera } from './control/talkback.js';
import { motionSettings } from './motion/settings.js';
import { HomeKitCameras, homekitSettings } from '../homekit/index.js';
import { Backups } from '../backup/backups.js';
import { RECORDING_BACKUPS, RECORDING_SESSIONS } from '../events/tokens.js';
import { NvrCameraSessions } from './sessions/sessions.js';
import { WarmStreams } from './control/warm.js';
import { CameraMediaCoordinator } from './control/media.js';
import { IntegratedCameraSources, type IntegratedCameraConfig } from './control/integrated.js';
import type { RecorderCamera, RecorderSensor } from '../events/recorder/types.js';

export type CameraConfig = IntegratedCameraConfig;

@Injectable()
export class DefaultCameraService implements CameraService {
  private readonly cameras: Map<string, CameraConfig>;
  private readonly mediaCoordinator: CameraMediaCoordinator;
  private readonly cachedSnapshots = new Map<string, CameraSnapshot & { checkedAt: number }>();
  private readonly pendingSnapshots = new Map<string, Promise<CameraSnapshot>>();
  private readonly mediaRuntime: MediaRuntime = defaultMediaRuntime;

  constructor(
    @Optional() private readonly store?: RecordingStore,
    @Optional() private readonly recorder?: Recorder,
    @Optional() @Inject(NativeCameraRuntime) private readonly nativeCameras?: NativeCameraRuntime,
    @Optional() @Inject(CAMERA_SNAPSHOTS) private readonly snapshots?: CameraSnapshots,
    @Optional() @Inject(CAMERA_TALKBACK) private readonly talkback?: Talkback,
    @Optional() private readonly homekit?: HomeKitCameras,
    @Optional() @Inject(RECORDING_BACKUPS) private readonly backups?: Backups,
    @Optional() @Inject(RECORDING_SESSIONS) private readonly sessions?: NvrCameraSessions,
    @Optional() private readonly warm?: WarmStreams,
    @Optional() private readonly integrated?: IntegratedCameraSources,
  ) {
    this.cameras = this.integrated?.cameras ?? new Map<string, CameraConfig>();
    this.mediaCoordinator = new CameraMediaCoordinator({
      sessions: this.sessions,
      warm: this.warm,
      recorder: this.recorder,
      nativeCameras: this.nativeCameras,
    });
  }

  private findAnyCamera(cameraId: string) {
    return (
      this.nativeCameras?.cameras().find((camera) => camera.id === cameraId) ??
      this.sessions?.camera(cameraId) ??
      this.cameras.get(cameraId)
    );
  }

  getCameraRtsp(cameraId: string): string | undefined {
    const cam = this.cameras.get(cameraId);
    const native = this.nativeCameras?.cameras().find((c) => c.id === cameraId);
    const sessionCam = this.sessions?.camera(cameraId);
    return (
      cam?.rtspUrl ??
      (native as { rtspUrl?: string } | undefined)?.rtspUrl ??
      (sessionCam as { rtspUrl?: string; nativeSource?: { url?: string } } | undefined)?.rtspUrl ??
      (sessionCam as { nativeSource?: { url?: string } } | undefined)?.nativeSource?.url
    );
  }

  registerCamera(camera: CameraConfig): void {
    const cached = this.cachedSnapshots.get(camera.id);
    if (cached) this.cachedSnapshots.set(camera.id, { ...cached, checkedAt: 0 });
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
      const isConfigured = Boolean(cam.talkback);
      const talkAvailable = this.talkback
        ? await this.talkback.available(cam as unknown as TalkbackCamera, {
            states: [],
            devices: [],
          })
        : true;
      const hkStatus = this.homekit
        ? this.homekit.status(cam.id)
        : (cam.homekit as Record<string, unknown> | undefined);
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
        homekit: hkStatus,
        talkAvailable,
        talkbackConfigured: isConfigured,
      });
    }
    for (const camera of native.values()) {
      const isConfigured = Boolean((camera as Record<string, unknown>).talkback);
      const talkAvailable = this.talkback
        ? await this.talkback.available(camera as unknown as TalkbackCamera, {
            states: [],
            devices: [],
          })
        : Boolean(camera.nativeTalkback);
      const hkStatus = this.homekit ? this.homekit.status(camera.id) : undefined;
      list.push({
        id: camera.id,
        name: camera.name ?? camera.id,
        state: camera.available ? 'online' : 'offline',
        operating: this.nativeCameras?.operating(camera.id),
        spotlight: this.nativeCameras?.spotlight(camera.id),
        homekit: hkStatus,
        talkAvailable,
        talkbackConfigured: isConfigured,
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
    const target = this.findAnyCamera(cameraId);
    if (!target) throw new Error('camera_not_found');
    const token = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + 3600000;
    return { token, expiresAt, clientId, cameraId };
  }

  getSnapshot(cameraId: string): Promise<CameraSnapshot> {
    const pending = this.pendingSnapshots.get(cameraId);
    if (pending) return pending;
    const task = this.loadSnapshot(cameraId)
      .then((snap) => {
        const entry = { ...snap, checkedAt: Date.now() };
        this.cachedSnapshots.set(cameraId, entry);
        return snap;
      })
      .catch((err) => {
        const stale = this.cachedSnapshots.get(cameraId);
        if (stale) return { mime: stale.mime, buffer: stale.buffer, at: stale.at, stale: true };
        throw err;
      })
      .finally(() => this.pendingSnapshots.delete(cameraId));
    this.pendingSnapshots.set(cameraId, task);
    return task;
  }

  private async loadSnapshot(cameraId: string): Promise<CameraSnapshot> {
    const target = this.findAnyCamera(cameraId);
    if (!target) throw new Error('camera_not_found');
    const native = this.nativeCameras?.cameras().find((c) => c.id === cameraId);
    const cam = this.cameras.get(cameraId);

    let sourceFailed = false;
    if (cam?.snapshotFetch) {
      try {
        const buf = await cam.snapshotFetch();
        if (buf?.length) return { mime: 'image/jpeg', buffer: buf, at: Date.now() };
      } catch {
        sourceFailed = true;
      }
    }

    if (native && this.nativeCameras) {
      try {
        return await this.nativeCameras.snapshot(cameraId);
      } catch {
        sourceFailed = true;
      }
    }

    const cached = this.cachedSnapshots.get(cameraId);
    if (!sourceFailed && cached && !cached.stale && Date.now() - cached.checkedAt < 5000) {
      return { mime: cached.mime, buffer: cached.buffer, at: cached.at, stale: false };
    }

    const rtsp = this.getCameraRtsp(cameraId);
    const hasStreamNodes =
      this.sessions?.cluster
        ?.nodes()
        .some((node) => node.enabled && node.roles.includes('stream')) ?? false;
    const bufferDir =
      this.recorder?.buffers?.get(cameraId)?.dir ?? this.recorder?.bufferDirectory?.(cameraId);

    if (rtsp && !hasStreamNodes) {
      const local = await this.tryLocalSnapshot(rtsp, bufferDir);
      if (local) return local;
      const cluster = await this.tryClusterSnapshot(target);
      if (cluster) return cluster;
    } else {
      const cluster = await this.tryClusterSnapshot(target);
      if (cluster) return cluster;
      const local = await this.tryLocalSnapshot(rtsp, bufferDir);
      if (local) return local;
    }

    if (cached) return { mime: cached.mime, buffer: cached.buffer, at: cached.at, stale: true };
    throw new Error('snapshot_unavailable');
  }

  private async tryClusterSnapshot(target: unknown): Promise<CameraSnapshot | null> {
    if (!this.snapshots) return null;
    try {
      const s = await this.snapshots.snapshot(target as unknown as SnapshotCamera);
      return { mime: s.mime, buffer: s.buffer, at: s.at, stale: s.stale };
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'snapshot_busy') throw err;
      return null;
    }
  }

  private async tryLocalSnapshot(
    rtsp: string | undefined,
    bufferDir: string | undefined,
  ): Promise<CameraSnapshot | null> {
    if (rtsp) {
      try {
        const buf = await captureRtspFrame(this.mediaRuntime, rtsp);
        if (buf.length > 0) return { mime: 'image/jpeg', buffer: buf, at: Date.now() };
      } catch {
        // fall through to buffer/cached fallbacks
      }
    }
    if (bufferDir) {
      try {
        const buf = await captureBufferFrame(this.mediaRuntime, bufferDir);
        if (buf.length > 0) return { mime: 'image/jpeg', buffer: buf, at: Date.now() };
      } catch {
        // fall through to cached fallback
      }
    }
    return null;
  }

  async updateCamera(cameraId: string, update: Record<string, unknown>): Promise<CameraSummary> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    if (typeof update.name === 'string') cam.name = update.name;
    if (typeof update.enabled === 'boolean') cam.enabled = update.enabled;

    const overrides = this.store
      ? ((await this.store.overrides().catch(() => ({}))) as Record<
          string,
          Record<string, unknown> | undefined
        >)
      : undefined;
    const old = (overrides?.[cameraId] ?? {}) as Record<string, unknown>;

    let talkbackConfigured = false;
    if (update.talkback !== undefined) {
      const talkbackResult = customTalkback(update.talkback, { states: [] });
      cam.talkback = talkbackResult;
      talkbackConfigured = Boolean(talkbackResult);
      if (this.store) {
        await this.store.setCamera(cameraId, { ...old, talkback: talkbackResult });
      }
    } else {
      talkbackConfigured = Boolean(cam.talkback);
    }
    if (update.motionDetection !== undefined) {
      const motion = motionSettings(update.motionDetection);
      cam.motionDetection = motion;
      if (this.store) {
        await this.store.setCamera(cameraId, { ...old, motionDetection: motion });
      }
    }
    if (update.sensors !== undefined) {
      if (!Array.isArray(update.sensors) || update.sensors.some((item) => typeof item !== 'string'))
        throw new Error('invalid_sensors');
      cam.sensors = update.sensors;
      if (this.store) {
        await this.store.setCamera(cameraId, { ...old, sensors: update.sensors });
      }
    }
    if (update.sensorIds !== undefined) {
      if (
        !Array.isArray(update.sensorIds) ||
        update.sensorIds.some((item) => typeof item !== 'string')
      )
        throw new Error('invalid_detectors');
      cam.sensorIds = [...new Set(update.sensorIds)];
      if (this.store) {
        await this.store.setCamera(cameraId, { ...old, sensorIds: [...new Set(update.sensorIds)] });
      }
    }

    const {
      talkback: _tb,
      nativeSource: _ns,
      nativeTalkback: _nt,
      kitsuneSource: _ks,
      ...safeCam
    } = cam;

    return {
      ...safeCam,
      id: cam.id,
      name: cam.name,
      state: cam.enabled ? 'online' : 'offline',
      operating: cam.operating,
      homekit: cam.homekit,
      talkbackConfigured,
    };
  }

  async talkbackStream(cameraId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = this.findAnyCamera(cameraId);
    if (!target) throw new Error('camera_not_found');
    if (!this.talkback) throw new Error('talkback_unavailable');

    const cam = this.cameras.get(cameraId);
    let talkbackOverride: { url?: string; entityId?: string } | null | undefined = cam?.talkback;
    if (talkbackOverride === undefined && this.store) {
      const overrides = (await this.store.overrides().catch(() => ({}))) as Record<
        string,
        { talkback?: { url?: string; entityId?: string } | null } | undefined
      >;
      talkbackOverride = overrides[cameraId]?.talkback;
    }
    const camera: TalkbackCamera = {
      ...(target as unknown as Record<string, unknown>),
      id: cameraId,
      talkback: talkbackOverride ?? cam?.talkback,
    };
    const registry = {
      states: [],
      devices: [],
    };
    await this.talkback.stream(camera, registry, req, res);
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
    offer?: unknown,
  ): Promise<unknown> {
    return this.mediaCoordinator.viewerOffer(cameraId, owner, viewerId, offer, this.cameras);
  }

  async closeViewer(cameraId: string, owner: string, viewerId: string): Promise<unknown> {
    return this.mediaCoordinator.closeViewer(cameraId, owner, viewerId, this.cameras);
  }

  async touchWarm(
    cameraId: string,
    owner: string,
    active: boolean,
    preview?: boolean,
  ): Promise<unknown> {
    return this.mediaCoordinator.touchWarm(cameraId, owner, active, preview, this.cameras);
  }

  async triggerRecording(cameraId: string): Promise<unknown> {
    return this.mediaCoordinator.triggerRecording(cameraId, this.cameras);
  }

  setStreamWarmer(warmer: (cameraId: string, active: boolean) => Promise<boolean> | boolean): void {
    this.mediaCoordinator.setStreamWarmer(warmer);
  }

  setMotionSensor(cameraId: string, sensor: RecorderSensor): void {
    this.mediaCoordinator.setMotionSensor(cameraId, sensor, this.cameras);
  }

  recordingCameras(): RecorderCamera[] {
    return this.mediaCoordinator.recordingCameras(this.cameras);
  }

  async getHomeKitPairing(cameraId: string): Promise<unknown> {
    const target = this.findAnyCamera(cameraId);
    if (!target) throw new Error('camera_not_found');
    if (this.homekit) {
      return await this.homekit.pairing(cameraId);
    }
    const cam = this.cameras.get(cameraId);
    return {
      id: cameraId,
      paired: cam?.homekit?.paired ?? false,
      uri: cam?.homekit?.setupUri ?? '',
    };
  }

  async manageHomeKitPairing(cameraId: string, action: 'close' | 'reset'): Promise<unknown> {
    const target = this.findAnyCamera(cameraId);
    if (!target) throw new Error('camera_not_found');
    if (this.homekit) {
      const res = await this.homekit.managePairing(cameraId, action);
      if (action === 'reset') this.backups?.markChanged();
      return res;
    }
    const cam = this.cameras.get(cameraId);
    if (cam) {
      if (!cam.homekit) cam.homekit = {};
      if (action === 'reset') cam.homekit.paired = false;
    }
    return { id: cameraId, paired: cam?.homekit?.paired ?? false, action };
  }

  async updateHomeKitSettings(cameraId: string, settings: unknown): Promise<unknown> {
    const target = this.findAnyCamera(cameraId);
    if (!target) throw new Error('camera_not_found');

    const valid = homekitSettings(settings);
    const cam = this.cameras.get(cameraId);
    if (cam) {
      cam.homekit = { ...cam.homekit, enabled: valid.enabled };
    }
    if (this.store) {
      const overrides = (await this.store.overrides().catch(() => ({}))) as Record<
        string,
        Record<string, unknown> | undefined
      >;
      const old = (overrides[cameraId] ?? {}) as Record<string, unknown>;
      await this.store.setCamera(cameraId, { ...old, homekit: valid });
    }
    this.backups?.markChanged();
    if (this.homekit) {
      await this.homekit.tick();
      return this.homekit.status(cameraId);
    }
    return { status: 'ok', cameraId, settings: valid };
  }
}
