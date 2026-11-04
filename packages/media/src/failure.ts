/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export const cameraFailureCodes = new Set([
  'camera_session_not_found',
  'camera_recording_not_found',
  'camera_recording_not_ready',
  'camera_ring_not_ready',
  'camera_session_busy',
  'camera_recording_busy',
  'camera_viewer_busy',
  'camera_stream_warming',
  'camera_webrtc_failed',
  'camera_session_unavailable',
  'camera_engine_unavailable',
  'camera_engine_timeout',
  'camera_media_failed',
  'invalid_camera_recording',
  'storage_full',
  'node_unavailable',
]);

export function cameraFailureCode(error: unknown) {
  const item =
    error && typeof error === 'object'
      ? (error as { code?: unknown; message?: unknown; name?: unknown })
      : {};
  const code = item.code ?? item.message;
  if (typeof code === 'string' && cameraFailureCodes.has(code)) return code;
  if (item.name === 'AbortError' || item.name === 'TimeoutError') return 'camera_request_timeout';
  return 'camera_request_failed';
}
