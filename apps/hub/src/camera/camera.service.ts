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
import { loadCameraSnapshot, type CachedCameraSnapshot } from './control/frame.js';
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
import { CameraSnapshots } from './control/snapshots.js';
import { type Talkback, type TalkbackCamera } from './control/talkback.js';
import { HomeKitCameras, homekitSettings } from '../homekit/index.js';
import { Backups } from '../backup/backups.js';
import { RECORDING_BACKUPS, RECORDING_SESSIONS } from '../events/tokens.js';
import { NvrCameraSessions } from './sessions/sessions.js';
import { WarmStreams } from './control/warm.js';
import { CameraMediaCoordinator } from './control/media.js';
import { IntegratedCameraSources, type IntegratedCameraConfig } from './control/integrated.js';
import type { RecorderCamera, RecorderSensor } from '../events/recorder/types.js';
import { Motion } from './motion/motion.js';
import { CameraActivity } from './control/activity.js';
import { RecordingOwner } from '../events/owner.js';
import {
  asCameraOverride,
  buildIntegratedCameraSummary,
  buildNativeCameraSummary,
  parseCameraPatch,
} from './control/summary.js';

export type CameraConfig = IntegratedCameraConfig;

@Injectable()
export class DefaultCameraService implements CameraService {
  private readonly cameras: Map<string, CameraConfig>;
  private readonly mediaCoordinator: CameraMediaCoordinator;
  private readonly cachedSnapshots = new Map<string, CachedCameraSnapshot>();
  private readonly pendingSnapshots = new Map<string, Promise<CameraSnapshot>>();
  private readonly localSnapshotPreferredUntil = new Map<string, number>();
  private readonly memoryOverrides = new Map<string, Record<string, unknown>>();
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
    @Optional() @Inject(Motion) private readonly motion?: Motion,
    @Optional() @Inject(CameraActivity) private readonly activity?: CameraActivity,
    @Optional() @Inject(RecordingOwner) private readonly recordingOwner?: RecordingOwner,
  ) {
    this.cameras = this.integrated?.cameras ?? new Map<string, CameraConfig>();
    this.mediaCoordinator = new CameraMediaCoordinator({
      sessions: this.sessions,
      warm: this.warm,
      recorder: this.recorder,
      nativeCameras: this.nativeCameras,
    });
  }

  private async readOverrides(): Promise<Record<string, Record<string, unknown>>> {
    const persisted = (await this.store?.overrides().catch(() => ({}))) ?? {};
    const merged: Record<string, Record<string, unknown>> = {};
    for (const [id, value] of Object.entries(persisted)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        merged[id] = value as Record<string, unknown>;
      }
    }
    for (const [id, value] of this.memoryOverrides) {
      merged[id] = { ...merged[id], ...value };
    }
    return merged;
  }

  private findAnyCamera(cameraId: string) {
    return (
      this.nativeCameras
        ?.cameras()
        .find((camera) => camera.id === cameraId || camera.aliases?.includes(cameraId)) ??
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

  observeProviderAvailability(cameraId: string, available: boolean): void {
    const camera = this.cameras.get(cameraId);
    if (camera) camera.providerAvailable = available;
  }

  async listCameras(): Promise<CameraSummary[]> {
    const overrides = await this.readOverrides();
    const ports = { motion: this.motion, activity: this.activity };
    const list: CameraSummary[] = [];
    const native = new Map(
      (this.nativeCameras?.cameras(overrides) ?? []).map((camera) => [camera.id, camera]),
    );
    for (const cam of this.cameras.values()) {
      const nativeCamera = native.get(cam.id);
      native.delete(cam.id);
      const override = asCameraOverride(overrides[cam.id]);
      const talkAvailable = this.talkback
        ? await this.talkback.available(cam as unknown as TalkbackCamera, {
            states: [],
            devices: [],
          })
        : true;
      const hkStatus = this.homekit
        ? this.homekit.status(cam.id)
        : (cam.homekit as Record<string, unknown> | undefined);
      list.push(
        buildIntegratedCameraSummary({
          cam,
          nativeCamera,
          override,
          operating: nativeCamera ? this.nativeCameras?.operating(cam.id) : undefined,
          spotlight: nativeCamera ? this.nativeCameras?.spotlight(cam.id) : undefined,
          homekit: hkStatus,
          talkAvailable,
          ports,
        }),
      );
    }
    for (const camera of native.values()) {
      const override = asCameraOverride(overrides[camera.id]);
      const talkAvailable = this.talkback
        ? await this.talkback.available(camera as unknown as TalkbackCamera, {
            states: [],
            devices: [],
          })
        : Boolean(camera.nativeTalkback);
      const hkStatus = this.homekit ? this.homekit.status(camera.id) : undefined;
      list.push(
        buildNativeCameraSummary({
          camera,
          override,
          operating: this.nativeCameras?.operating(camera.id),
          spotlight: this.nativeCameras?.spotlight(camera.id),
          homekit: hkStatus,
          talkAvailable,
          ports,
        }),
      );
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

  getSnapshot(cameraId: string, force = false): Promise<CameraSnapshot> {
    if (!force) {
      const cached = this.cachedSnapshots.get(cameraId);
      if (cached && !cached.stale && cached.background && Date.now() - cached.checkedAt < 8_000) {
        return Promise.resolve({
          mime: cached.mime,
          buffer: cached.buffer,
          at: cached.at,
          stale: false,
        });
      }
    }
    const pending = this.pendingSnapshots.get(cameraId);
    if (pending) return pending;
    const task = this.loadSnapshot(cameraId, force)
      .then((snap) => {
        this.cachedSnapshots.set(cameraId, {
          ...snap,
          checkedAt: Date.now(),
          background: force ? !snap.stale : undefined,
        });
        return snap;
      })
      .catch((err) => {
        const stale = this.cachedSnapshots.get(cameraId);
        if (stale) {
          const fallback = { mime: stale.mime, buffer: stale.buffer, at: stale.at, stale: true };
          this.cachedSnapshots.set(cameraId, {
            ...fallback,
            checkedAt: Date.now(),
            background: false,
          });
          return fallback;
        }
        throw err;
      })
      .finally(() => this.pendingSnapshots.delete(cameraId));
    this.pendingSnapshots.set(cameraId, task);
    return task;
  }

  refreshSnapshot(cameraId: string): Promise<CameraSnapshot> {
    return this.getSnapshot(cameraId, true);
  }

  private loadSnapshot(cameraId: string, force = false): Promise<CameraSnapshot> {
    const target = this.findAnyCamera(cameraId);
    if (!target) return Promise.reject(new Error('camera_not_found'));
    const native = Boolean(this.nativeCameras?.cameras().some((c) => c.id === cameraId));
    const hasStreamNodes =
      this.sessions?.cluster
        ?.nodes()
        .some((node) => node.enabled && node.roles.includes('stream')) ?? false;
    const bufferDir =
      this.recorder?.buffers?.get(cameraId)?.dir ?? this.recorder?.bufferDirectory?.(cameraId);
    return loadCameraSnapshot({
      cameraId,
      force,
      target,
      cam: this.cameras.get(cameraId),
      native,
      nativeCameras: this.nativeCameras,
      snapshots: this.snapshots,
      mediaRuntime: this.mediaRuntime,
      rtsp: this.getCameraRtsp(cameraId),
      bufferDir,
      hasStreamNodes,
      cached: this.cachedSnapshots.get(cameraId),
      localSnapshotPreferredUntil: this.localSnapshotPreferredUntil,
    });
  }

  async updateCamera(cameraId: string, update: Record<string, unknown>): Promise<CameraSummary> {
    const cam = this.cameras.get(cameraId);
    const native = this.nativeCameras
      ?.cameras()
      .find((item) => item.id === cameraId || item.aliases?.includes(cameraId));
    if (!cam && !native) throw new Error('camera_not_found');
    const resolvedId = native?.id ?? cam!.id;
    const changes = parseCameraPatch(update);
    if (Object.keys(changes).length > 0) {
      if (this.store) {
        await this.store.patchCamera(resolvedId, changes);
      } else {
        this.memoryOverrides.set(resolvedId, {
          ...this.memoryOverrides.get(resolvedId),
          ...changes,
        });
      }
      this.backups?.markChanged();
    }
    if (cam) {
      Object.assign(cam, changes);
      if (typeof update.name === 'string') cam.name = update.name;
    }
    this.recordingOwner?.syncNow();
    const updated = (await this.listCameras()).find((item) => item.id === resolvedId);
    if (!updated) throw new Error('camera_not_found');
    return updated;
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
      eufySerial: cam?.eufySerial,
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
    const cam = this.cameras.get(cameraId);
    if (cam?.onOperatingChange && entityId === `native:${cam.id}:${control}`) {
      await cam.onOperatingChange(control, value);
      this.observeOperating(cameraId, control, value);
      return { accepted: true };
    }
    if (this.nativeCameras?.manages(cameraId)) {
      await this.nativeCameras.writeOperating(cameraId, control, entityId, value);
      return { accepted: true };
    }
    if (!cam) throw new Error('camera_not_found');
    if (cam.onOperatingChange) {
      await cam.onOperatingChange(control, value);
    }
    this.observeOperating(cameraId, control, value);
    return { accepted: true };
  }

  observeOperating(cameraId: string, control: 'indicator' | 'nightVision', value: boolean): void {
    const camera = this.cameras.get(cameraId);
    if (camera) camera.operating = { ...camera.operating, [control]: value };
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
    await this.store?.patchCamera(cameraId, { homekit: valid });
    this.backups?.markChanged();
    if (this.homekit) {
      await this.homekit.tick();
      return this.homekit.status(cameraId);
    }
    return { status: 'ok', cameraId, settings: valid };
  }
}
