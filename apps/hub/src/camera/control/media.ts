/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ServiceUnavailableException } from '@nestjs/common';
import type { NvrCameraSessions } from '../sessions/sessions.js';
import type { WarmStreams, WarmStreamCamera } from './warm.js';
import type { Recorder } from '../../events/recorder/recorder.js';
import type { NativeCameraRuntime } from './runtime.js';
import type { SessionCamera } from '../sessions/types.js';
import type { NvrCameraSource } from '../source-url.js';
import type { RecorderCamera, RecorderSensor } from '../../events/recorder/types.js';

export interface CameraMediaConfig {
  id: string;
  name?: string;
  rtspUrl?: string;
  enabled?: boolean;
  snapshotFetch?: unknown;
  motionDetection?: unknown;
  motionSensors?: RecorderSensor[];
  [key: string]: unknown;
}

export interface CameraMediaHost {
  sessions?: NvrCameraSessions;
  warm?: WarmStreams;
  recorder?: Recorder;
  nativeCameras?: NativeCameraRuntime;
  streamWarmer?: (cameraId: string, active: boolean) => Promise<boolean> | boolean;
}

export class CameraMediaCoordinator {
  private readonly warmKeepalives = new Map<string, Map<string, number>>();
  private readonly viewerSessions = new Map<string, Map<string, unknown>>();

  constructor(private readonly host: CameraMediaHost) {}

  setStreamWarmer(warmer: (cameraId: string, active: boolean) => Promise<boolean> | boolean): void {
    this.host.streamWarmer = warmer;
  }

  setMotionSensor(
    cameraId: string,
    sensor: RecorderSensor,
    cameras: Map<string, CameraMediaConfig>,
  ): void {
    const cam = cameras.get(cameraId);
    if (!cam) return;
    const prev = Array.isArray(cam.motionSensors) ? cam.motionSensors : [];
    cam.motionSensors = [...prev.filter((item) => item.id !== sensor.id), sensor];
  }

  recordingCameras(cameras: Map<string, CameraMediaConfig>): RecorderCamera[] {
    const list: RecorderCamera[] = [];
    for (const cam of cameras.values()) {
      const motion = cam.motionDetection as { enabled?: boolean; mode?: unknown } | undefined;
      list.push({
        id: cam.id,
        enabled: cam.enabled !== false,
        available: Boolean(cam.rtspUrl || cam.snapshotFetch || cam.available === true),
        ...(cam.rtspUrl && typeof cam.rtspUrl === 'string'
          ? { independentSource: true, kitsuneSource: { url: cam.rtspUrl, kind: 'rtsp' } }
          : {}),
        motionDetection: motion
          ? {
              enabled: motion.enabled !== false,
              mode: motion.mode === 'objects' ? 'objects' : 'motion',
            }
          : { enabled: true, mode: 'motion' },
        ...(cam.motionSensors?.length ? { sensors: cam.motionSensors } : {}),
      });
    }
    return list;
  }

  findCamera(
    cameraId: string,
    cameras: Map<string, CameraMediaConfig>,
  ): SessionCamera | CameraMediaConfig | undefined {
    const fromSessions = this.host.sessions?.camera(cameraId);
    if (fromSessions) return fromSessions;
    const native = this.host.nativeCameras?.cameras().find((c) => c.id === cameraId);
    if (native) {
      return {
        id: native.id,
        available: native.available,
        nativeProvider: native.nativeProvider,
        nativeSource: native.nativeSource as NvrCameraSource | undefined,
      };
    }
    return cameras.get(cameraId);
  }

  async viewerOffer(
    cameraId: string,
    owner: string,
    viewerId: string,
    offer: unknown,
    cameras: Map<string, CameraMediaConfig>,
  ): Promise<unknown> {
    const camera = this.findCamera(cameraId, cameras);
    if (!camera) throw new Error('camera_not_found');

    const sdpOffer =
      typeof offer === 'string' ? offer : ((offer as { sdp?: string })?.sdp ?? offer);

    if (this.host.sessions) {
      const res = await this.host.sessions.viewer(
        camera as SessionCamera,
        owner,
        viewerId,
        sdpOffer,
      );
      return {
        ...res,
        type: res.answer?.type ?? 'answer',
        sdp: res.answer?.sdp ?? '',
      };
    }

    let sessions = this.viewerSessions.get(cameraId);
    if (!sessions) {
      sessions = new Map();
      this.viewerSessions.set(cameraId, sessions);
    }
    sessions.set(`${owner}:${viewerId}`, { startedAt: Date.now() });
    return {
      type: 'answer',
      sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=HausViewer\r\nt=0 0\r\n',
      answer: {
        type: 'answer',
        sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=HausViewer\r\nt=0 0\r\n',
      },
      candidates: [],
    };
  }

  async closeViewer(
    cameraId: string,
    owner: string,
    viewerId: string,
    cameras: Map<string, CameraMediaConfig>,
  ): Promise<unknown> {
    const camera = this.findCamera(cameraId, cameras);
    if (!camera) throw new Error('camera_not_found');

    if (this.host.sessions) {
      return await this.host.sessions.closeViewer(cameraId, owner, viewerId);
    }

    const sessions = this.viewerSessions.get(cameraId);
    sessions?.delete(`${owner}:${viewerId}`);
    return { closed: true };
  }

  async touchWarm(
    cameraId: string,
    owner: string,
    active: boolean,
    preview: boolean | undefined,
    cameras: Map<string, CameraMediaConfig>,
  ): Promise<unknown> {
    const camera = this.findCamera(cameraId, cameras);
    if (!camera) throw new Error('camera_not_found');

    const streamPath = `/api/cameras/${cameraId}/live/index.m3u8`;
    if (this.host.warm) {
      const res = await this.host.warm.touch(
        camera as unknown as WarmStreamCamera,
        owner,
        active,
        preview,
      );
      if (res.warm !== true && this.host.streamWarmer) {
        const warmed = await this.host.streamWarmer(cameraId, active);
        if (!active && warmed) return { active: false, warm: false, streamPath };
        if (active && warmed) return { active: true, warm: true, source: 'hub', streamPath };
      }
      return { active: res.warm === true, streamPath, ...res };
    }
    if (this.host.sessions) {
      const res = await this.host.sessions.touch(
        camera as unknown as WarmStreamCamera,
        owner,
        active,
        preview,
      );
      if (res.warm !== true && this.host.streamWarmer) {
        const warmed = await this.host.streamWarmer(cameraId, active);
        if (!active && warmed) return { active: false, warm: false, streamPath };
        if (active && warmed) return { active: true, warm: true, source: 'hub', streamPath };
      }
      return { active: res.warm === true, streamPath, ...res };
    }
    if (this.host.streamWarmer) {
      const warmed = await this.host.streamWarmer(cameraId, active);
      if (warmed) {
        return {
          active: active && warmed,
          warm: active && warmed,
          source: 'hub',
          streamPath,
        };
      }
      return {
        active: false,
        warm: false,
        reason: 'stream_unavailable',
      };
    }

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
    return {
      active: keepalives.size > 0,
      warm: keepalives.size > 0,
      streamPath: `/api/cameras/${cameraId}/live/index.m3u8`,
    };
  }

  async triggerRecording(
    cameraId: string,
    cameras: Map<string, CameraMediaConfig>,
  ): Promise<
    Awaited<ReturnType<Recorder['trigger']>> & { started: boolean; jobId: string; cameraId: string }
  > {
    const camera = this.findCamera(cameraId, cameras);
    if (!camera) throw new Error('camera_not_found');
    if (!this.host.recorder) throw new ServiceUnavailableException('recording_worker_unavailable');
    const event = await this.host.recorder.trigger(cameraId);
    return { ...event, started: true, jobId: event.id, cameraId: event.cameraId };
  }
}
