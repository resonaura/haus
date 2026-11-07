/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { NvrOptions } from './types.js';
export async function nvrStatus(
  options: NvrOptions,
  active: number,
): Promise<Record<string, unknown>> {
  const {
    nodeId,
    instanceId,
    roles = ['storage', 'stream'],
    homekit,
    peers,
    host,
    cameraAccess,
    continuity,
    cameraRecordings,
    cameraActivity,
    streams,
    blobs,
    storageUsage,
    settings,
    maxStreams = 4,
    capacity,
    detectors,
    playback,
    cameras,
  } = options;
  return {
    protocol: 1,
    nodeId,
    instanceId,
    roles,
    features: {
      homekitMedia: Boolean(homekit),
      rtspPeer: Boolean(peers),
      monitoringOnly: true,
      hostTelemetry: Boolean(host),
      directCameraAccess: Boolean(roles.includes('stream') && cameraAccess),
      cameraAccessPolicy: roles.includes('stream') && cameraAccess ? 1 : 0,
      cameraContinuity: roles.includes('stream') && continuity ? 1 : 0,
      cameraRecordingRecovery: roles.includes('stream') && cameraRecordings ? 1 : 0,
      autonomousCameraActivity: roles.includes('stream') && cameraActivity ? 1 : 0,
    },
    relayOrigin: streams?.origin,
    storage: {
      ...(await blobs.status()),
      ...(storageUsage ? { usage: storageUsage.status() } : {}),
    },
    ...(settings ? { settings: settings.status() } : {}),
    ...(host ? { host: host.status() } : {}),
    streams: {
      active: streams?.size ?? 0,
      max: !roles.includes('stream') || capacity?.pressured ? 0 : maxStreams,
    },
    media: {
      active: active,
      max: roles.length ? Math.max(4, maxStreams * 2) : 0,
    },
    ...(capacity ? { resources: capacity.status() } : {}),
    ...(detectors ? { detectors: detectors.status() } : {}),
    ...(playback ? { playback: playback.status() } : {}),
    ...(cameras ? { rtspSessions: cameras.status() } : {}),
    ...(homekit ? { homekit: homekit.status() } : {}),
    ...(continuity ? { cameraContinuity: continuity.status() } : {}),
    ...(cameraActivity ? { cameraActivity: cameraActivity.status() } : {}),
  };
}
