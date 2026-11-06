/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Injectable, Optional } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  CameraAccessResult,
  CameraService,
  CameraSnapshot,
  CameraSummary,
  DetectorSummary,
} from './types.js';
import { RecordingStore } from '../events/recording.store.js';

export interface CameraConfig {
  id: string;
  name: string;
  rtspUrl?: string;
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

  constructor(@Optional() private readonly store?: RecordingStore) {
    // Seed default camera fixtures if none registered
    this.registerCamera({
      id: 'camera.front_door',
      name: 'Front Door',
      enabled: true,
      operating: { indicator: true, nightVision: true },
      homekit: { paired: false, setupUri: 'X-HM://0023HAUSCAM1' },
    });
    this.registerCamera({
      id: 'camera.backyard',
      name: 'Backyard',
      enabled: true,
      operating: { indicator: false, nightVision: true },
      homekit: { paired: true, setupUri: 'X-HM://0023HAUSCAM2' },
    });
  }

  registerCamera(camera: CameraConfig): void {
    this.cameras.set(camera.id, camera);
  }

  async listCameras(): Promise<CameraSummary[]> {
    const list: CameraSummary[] = [];
    for (const cam of this.cameras.values()) {
      list.push({
        id: cam.id,
        name: cam.name,
        state: cam.enabled ? 'online' : 'offline',
        operating: cam.operating,
        homekit: cam.homekit,
        talkAvailable: true,
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

  async getSnapshot(cameraId: string): Promise<CameraSnapshot> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    // Minimal valid 1x1 JPEG buffer for snapshot serving
    const dummyJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06,
      0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b,
      0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
      0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31,
      0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff,
      0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00,
      0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xbf, 0x00, 0xff, 0xd9,
    ]);
    return {
      mime: 'image/jpeg',
      buffer: dummyJpeg,
      at: Date.now(),
    };
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
    _entityId: string,
    value: boolean,
  ): Promise<{ accepted: boolean }> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    if (!cam.operating) cam.operating = {};
    cam.operating[control] = value;
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
    const jobId = `rec-${randomUUID()}`;
    return { started: true, jobId, cameraId };
  }

  async getHomeKitPairing(cameraId: string): Promise<unknown> {
    const cam = this.cameras.get(cameraId);
    if (!cam) throw new Error('camera_not_found');
    return {
      paired: cam.homekit?.paired ?? false,
      uri: cam.homekit?.setupUri ?? 'X-HM://0023HAUSCAM1',
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
