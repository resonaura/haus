/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { createHash } from 'node:crypto';
import type { Diagnostic } from './contracts.js';

export type CameraSourceStage = 'stream-selection' | 'media-input' | 'source-validation';

const knownReasons = new Set([
  'invalid_camera_source',
  'kitsune_invalid_media',
  'kitsune_invalid_stream_selection',
  'kitsune_media_adapter_required',
  'kitsune_no_video_stream',
  'kitsune_plugin_call_timeout',
  'kitsune_plugin_offline',
  'kitsune_stream_options_unavailable',
  'kitsune_video_unavailable',
]);

export function cameraSourceFailure(stage: CameraSourceStage, error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const reason = knownReasons.has(message)
    ? message
    : stage === 'stream-selection'
      ? 'stream_selection_failed'
      : stage === 'media-input'
        ? 'media_input_failed'
        : 'source_validation_failed';
  return { stage, reason };
}

function cameraTarget(pluginId: string, deviceId: string) {
  const digest = createHash('sha256').update(pluginId).update('\0').update(deviceId).digest('hex');
  return `camera-${digest.slice(0, 24)}`;
}

export function cameraSourceDiagnostic(
  pluginId: string,
  deviceId: string,
  event: 'camera_source_unavailable' | 'camera_source_restored',
  failure?: ReturnType<typeof cameraSourceFailure>,
): Diagnostic {
  return {
    component: 'kitsune:runtime',
    event,
    pluginId,
    target: cameraTarget(pluginId, deviceId),
    message: failure ? `stage=${failure.stage}; reason=${failure.reason}` : 'source validated',
  };
}

export class CameraSourceDiagnostics {
  private failures = new Map<string, string>();

  constructor(private readonly report: (event: Diagnostic) => void) {}

  failed(pluginId: string, deviceId: string, stage: CameraSourceStage, error: unknown) {
    const failure = cameraSourceFailure(stage, error);
    const key = pluginId + '\0' + deviceId;
    const signature = `${failure.stage}:${failure.reason}`;
    if (this.failures.get(key) === signature) return;
    this.failures.set(key, signature);
    this.report(cameraSourceDiagnostic(pluginId, deviceId, 'camera_source_unavailable', failure));
  }

  restored(pluginId: string, deviceId: string) {
    if (this.failures.delete(pluginId + '\0' + deviceId))
      this.report(cameraSourceDiagnostic(pluginId, deviceId, 'camera_source_restored'));
  }

  forget(pluginId: string, deviceId: string) {
    this.failures.delete(pluginId + '\0' + deviceId);
  }
}
