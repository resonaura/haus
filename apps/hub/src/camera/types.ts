/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CameraSpotlightState } from './control/spotlight.js';

export interface CameraSnapshot {
  mime: string;
  buffer: Buffer;
  at: number;
  stale?: boolean;
}

export interface CameraSummary {
  id: string;
  name: string;
  state?: string;
  motionStatus?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  homekit?: Record<string, unknown>;
  operating?: Record<string, unknown>;
  spotlight?: CameraSpotlightState;
  talkAvailable?: boolean;
  talkbackConfigured?: boolean;
  [key: string]: unknown;
}

export interface DetectorSummary {
  id: string;
  name: string;
  kind: string;
}

export interface CameraAccessResult {
  token: string;
  expiresAt: number;
  [key: string]: unknown;
}

export interface CameraService {
  listCameras(): Promise<CameraSummary[]>;
  listDetectors(): Promise<DetectorSummary[]>;
  bootstrapAccess(cameraId: string, clientId: string): Promise<CameraAccessResult>;
  getSnapshot(cameraId: string): Promise<CameraSnapshot>;
  updateCamera(cameraId: string, update: Record<string, unknown>): Promise<CameraSummary>;
  setOperating(
    cameraId: string,
    control: 'indicator' | 'nightVision',
    entityId: string,
    value: boolean,
  ): Promise<{ accepted: boolean }>;
  setSpotlight(cameraId: string, entityId: string, value: unknown): Promise<{ accepted: boolean }>;
  viewerOffer(cameraId: string, owner: string, viewerId: string, offer?: unknown): Promise<unknown>;
  closeViewer(cameraId: string, owner: string, viewerId: string): Promise<unknown>;
  touchWarm(cameraId: string, owner: string, active: boolean, preview?: boolean): Promise<unknown>;
  triggerRecording(cameraId: string): Promise<unknown>;
  getHomeKitPairing(cameraId: string): Promise<unknown>;
  manageHomeKitPairing(cameraId: string, action: 'close' | 'reset'): Promise<unknown>;
  updateHomeKitSettings(cameraId: string, settings: unknown): Promise<unknown>;
  talkbackStream?(cameraId: string, req: IncomingMessage, res: ServerResponse): Promise<void>;
  getCameraRtsp?(cameraId: string): string | undefined;
}
