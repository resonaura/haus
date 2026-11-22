/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Injectable } from '@nestjs/common';
import type { RecorderCamera, RecorderSensor } from '../../events/recorder/types.js';

export interface IntegratedCameraConfig {
  id: string;
  name: string;
  rtspUrl?: string;
  eufySerial?: string;
  snapshotUrl?: string;
  snapshotFetch?: () => Promise<Buffer | null>;
  onOperatingChange?: (control: 'indicator' | 'nightVision', value: boolean) => Promise<void>;
  enabled?: boolean;
  providerAvailable?: boolean;
  talkback?: { url?: string; entityId?: string } | null;
  motionDetection?: unknown;
  sensors?: string[];
  sensorIds?: string[];
  motionSensors?: RecorderSensor[];
  operating?: {
    indicator?: boolean;
    nightVision?: boolean;
  };
  homekit?: {
    paired?: boolean;
    setupUri?: string;
    enabled?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

@Injectable()
export class IntegratedCameraSources {
  readonly cameras = new Map<string, IntegratedCameraConfig>();

  getRtsp(cameraId: string): string | undefined {
    return this.cameras.get(cameraId)?.rtspUrl;
  }

  setMotionSensor(cameraId: string, sensor: RecorderSensor): void {
    const cam = this.cameras.get(cameraId);
    if (!cam) return;
    const prev = Array.isArray(cam.motionSensors) ? cam.motionSensors : [];
    const next = prev.filter((item) => item.id !== sensor.id);
    next.push(sensor);
    cam.motionSensors = next;
  }

  recordingCameras(overrides: Record<string, Record<string, unknown>> = {}): RecorderCamera[] {
    const list: RecorderCamera[] = [];
    for (const cam of this.cameras.values()) {
      const override = overrides[cam.id];
      const rawMotion = (override?.motionDetection ?? cam.motionDetection) as
        { enabled?: boolean; mode?: unknown } | undefined;
      const enabled =
        typeof override?.enabled === 'boolean' ? override.enabled : cam.enabled === true;
      list.push({
        id: cam.id,
        enabled,
        available:
          cam.providerAvailable !== false &&
          Boolean(cam.rtspUrl || cam.snapshotFetch || cam.available === true),
        ...(cam.rtspUrl
          ? { independentSource: true, kitsuneSource: { url: cam.rtspUrl, kind: 'rtsp' } }
          : {}),
        motionDetection: rawMotion
          ? {
              enabled: rawMotion.enabled === true,
              mode: rawMotion.mode === 'motion' ? 'motion' : 'objects',
            }
          : { enabled: false, mode: 'objects' },
        ...(cam.motionSensors?.length ? { sensors: cam.motionSensors } : {}),
      });
    }
    return list;
  }
}
