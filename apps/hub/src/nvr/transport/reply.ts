/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { body, json } from '../http.js';

export function reply(res: ServerResponse, status: number, value: unknown): true {
  json(res, status, value);
  return true;
}
export async function objectBody(
  req: IncomingMessage,
  max = 65536,
): Promise<Record<string, unknown>> {
  const value = await body(req, max);
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw Error('invalid_body');
  return value as Record<string, unknown>;
}
const codes: Readonly<Record<string, number>> = {
  media_not_found: 404,
  blob_changed: 409,
  blob_in_use: 409,
  digest_mismatch: 400,
  verification_busy: 503,
  verification_timeout: 504,
  camera_session_not_found: 404,
  camera_recording_not_found: 404,
  camera_recording_not_ready: 409,
  camera_ring_not_ready: 409,
  camera_session_busy: 503,
  camera_recording_busy: 503,
  camera_viewer_busy: 503,
  camera_session_unavailable: 503,
  camera_engine_unavailable: 503,
  camera_engine_timeout: 503,
  camera_media_failed: 503,
  camera_stream_warming: 503,
  camera_webrtc_failed: 503,
};
export function failure(req: IncomingMessage, res: ServerResponse, error: unknown): void {
  if (res.headersSent || res.destroyed) {
    res.destroy();
    return;
  }
  const message = error instanceof Error ? error.message : '';
  let path: string;
  try {
    path = new URL(req.url ?? '/', 'http://node.invalid').pathname;
  } catch {
    path = '';
  }
  const status =
    /^\/v1\/blobs\/[a-f0-9]{64}\/verify$/.test(path) && message === 'digest_mismatch'
      ? 409
      : codes[message];
  json(
    res,
    status ??
      (/^(invalid_|digest_|body_)/.test(message)
        ? 400
        : /storage_full|busy/.test(message)
          ? 507
          : 503),
    {
      error:
        status || /^(invalid_|digest_|body_|storage_full|transfer_busy)/.test(message)
          ? message
          : 'node_unavailable',
    },
  );
}
