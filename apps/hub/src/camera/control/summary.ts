/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { customTalkback } from './talkback.js';
import { motionSettings, type MotionDetectionSettings } from '../motion/settings.js';
import type { CameraActivityStatus } from './activity.js';
import type { CameraSummary } from '../types.js';
import type { IntegratedCameraConfig } from './integrated.js';
import type { NativeCameraRegistryItem } from './sources.js';
import type { CameraSpotlightState } from './spotlight.js';
import type { CameraOperatingControls } from './operating.js';

export function formatIntegratedOperating(
  cam: IntegratedCameraConfig,
  available: boolean,
): CameraOperatingControls | undefined {
  if (!cam.operating || !cam.onOperatingChange) return undefined;
  const result: CameraOperatingControls = {};
  for (const control of ['indicator', 'nightVision'] as const) {
    const value = cam.operating[control];
    if (typeof value !== 'boolean') continue;
    result[control] = {
      id: `native:${cam.id}:${control}`,
      available,
      value,
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export interface CameraSettingsOverride {
  enabled?: boolean;
  talkback?: { url?: string; entityId?: string } | null;
  motionDetection?: MotionDetectionSettings;
  sensors?: string[];
  sensorIds?: string[] | null;
}

export interface CameraStatusPorts {
  motion?: { status(id: string): Record<string, unknown> };
  activity?: { status(id: string): CameraActivityStatus };
}

export function resolveMotionDetection(value: unknown): MotionDetectionSettings {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.enabled === 'boolean') {
      return {
        enabled: record.enabled,
        mode: record.mode === 'motion' ? 'motion' : 'objects',
      };
    }
  }
  return { enabled: false, mode: 'objects' };
}

export function asCameraOverride(value: unknown): CameraSettingsOverride {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as CameraSettingsOverride;
}

export function parseCameraPatch(update: Record<string, unknown>): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (update.enabled !== undefined) {
    if (typeof update.enabled !== 'boolean') throw new Error('invalid_enabled');
    changes.enabled = update.enabled;
  }
  if (update.talkback !== undefined) {
    changes.talkback = customTalkback(update.talkback, { states: [] });
  }
  if (update.motionDetection !== undefined) {
    changes.motionDetection = motionSettings(update.motionDetection);
  }
  if (update.sensors !== undefined) {
    if (!Array.isArray(update.sensors) || update.sensors.some((item) => typeof item !== 'string')) {
      throw new Error('invalid_sensors');
    }
    changes.sensors = update.sensors;
  }
  if (update.sensorIds !== undefined) {
    if (update.sensorIds === null) {
      changes.sensorIds = null;
    } else if (
      !Array.isArray(update.sensorIds) ||
      update.sensorIds.some((item) => typeof item !== 'string')
    ) {
      throw new Error('invalid_detectors');
    } else {
      changes.sensorIds = [...new Set(update.sensorIds)];
    }
  }
  return changes;
}

export function buildIntegratedCameraSummary(params: {
  cam: IntegratedCameraConfig;
  nativeCamera?: NativeCameraRegistryItem;
  override: CameraSettingsOverride;
  operating?: Record<string, unknown>;
  spotlight?: CameraSpotlightState;
  homekit?: Record<string, unknown>;
  talkAvailable: boolean;
  ports: CameraStatusPorts;
}): CameraSummary {
  const { cam, nativeCamera, override, operating, spotlight, homekit, talkAvailable, ports } =
    params;
  const available = nativeCamera
    ? Boolean(nativeCamera.available)
    : cam.providerAvailable !== false;
  const enabled =
    typeof override.enabled === 'boolean'
      ? override.enabled
      : typeof cam.enabled === 'boolean'
        ? cam.enabled
        : nativeCamera?.enabled === true;
  const motionDetection = resolveMotionDetection(
    override.motionDetection ?? cam.motionDetection ?? nativeCamera?.motionDetection,
  );
  const talkback = override.talkback !== undefined ? override.talkback : cam.talkback;
  const sensorIds =
    override.sensorIds !== undefined ? override.sensorIds : (cam.sensorIds ?? undefined);
  const sensors = override.sensors ?? cam.sensors;
  const integratedOperating = formatIntegratedOperating(cam, available);
  const nativeOperating = operating && Object.keys(operating).length > 0 ? operating : undefined;
  const resolvedOperating =
    nativeOperating || integratedOperating
      ? { ...integratedOperating, ...nativeOperating }
      : undefined;
  return {
    id: cam.id,
    name: cam.name,
    state: available ? 'online' : 'offline',
    available,
    enabled,
    ...(nativeCamera?.aliases?.length ? { aliases: nativeCamera.aliases } : {}),
    motionDetection,
    ...(ports.motion ? { motionStatus: ports.motion.status(cam.id) } : {}),
    ...(ports.activity ? { activity: ports.activity.status(cam.id) } : {}),
    ...(sensors !== undefined ? { sensors } : {}),
    ...(sensorIds !== undefined && sensorIds !== null ? { sensorIds } : {}),
    sensorMode: Array.isArray(sensorIds) ? 'manual' : 'automatic',
    ...(resolvedOperating ? { operating: resolvedOperating } : {}),
    spotlight,
    homekit,
    talkAvailable,
    talkbackConfigured: Boolean(talkback),
  };
}

export function buildNativeCameraSummary(params: {
  camera: NativeCameraRegistryItem;
  override: CameraSettingsOverride;
  operating?: Record<string, unknown>;
  spotlight?: CameraSpotlightState;
  homekit?: Record<string, unknown>;
  talkAvailable: boolean;
  ports: CameraStatusPorts;
}): CameraSummary {
  const { camera, override, operating, spotlight, homekit, talkAvailable, ports } = params;
  const available = Boolean(camera.available);
  const enabled =
    typeof override.enabled === 'boolean' ? override.enabled : camera.enabled === true;
  const motionDetection = resolveMotionDetection(
    override.motionDetection ?? camera.motionDetection,
  );
  const talkback = override.talkback !== undefined ? override.talkback : camera.talkback;
  const sensorIds = Array.isArray(override.sensorIds) ? override.sensorIds : undefined;
  return {
    id: camera.id,
    name: camera.name ?? camera.id,
    state: available ? 'online' : 'offline',
    available,
    enabled,
    aliases: camera.aliases ?? [],
    motionDetection,
    ...(ports.motion ? { motionStatus: ports.motion.status(camera.id) } : {}),
    ...(ports.activity ? { activity: ports.activity.status(camera.id) } : {}),
    sensors: camera.sensors,
    ...(sensorIds ? { sensorIds } : {}),
    sensorMode: camera.sensorMode ?? (sensorIds ? 'manual' : 'automatic'),
    operating,
    spotlight,
    homekit,
    talkAvailable,
    talkbackConfigured: Boolean(talkback),
  };
}
