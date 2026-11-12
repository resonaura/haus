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

export interface CameraMediaConfig {
  id: string;
  name?: string;
  rtspUrl?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface CameraMediaHost {
  sessions?: NvrCameraSessions;
  warm?: WarmStreams;
  recorder?: Recorder;
  nativeCameras?: NativeCameraRuntime;
}

export class CameraMediaCoordinator {
  private readonly warmKeepalives = new Map<string, Map<string, number>>();
  private readonly viewerSessions = new Map<string, Map<string, unknown>>();

  constructor(private readonly host: CameraMediaHost) {}

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
      return { active: res.warm === true, streamPath, ...res };
    }
    if (this.host.sessions) {
      const res = await this.host.sessions.touch(
        camera as unknown as WarmStreamCamera,
        owner,
        active,
        preview,
      );
      return { active: res.warm === true, streamPath, ...res };
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
  ): Promise<{ started: boolean; jobId: string; cameraId: string }> {
    const camera = this.findCamera(cameraId, cameras);
    if (!camera) throw new Error('camera_not_found');
    if (!this.host.recorder) throw new ServiceUnavailableException('recording_worker_unavailable');
    const event = await this.host.recorder.trigger(cameraId);
    return { started: true, jobId: event.id, cameraId: event.cameraId };
  }
}
