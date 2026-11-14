/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isUuid } from './native-args.js';
import type { NativeCameraSession, NativeMediaEvent, NativeMediaLog } from './native-types.js';

export function observeSourceRtpStats(
  event: NativeMediaEvent,
  sessions: Map<string, NativeCameraSession>,
  now: number,
): void {
  if (event.stage !== 'source' || typeof event.did !== 'string') return;
  const session = sessions.get(event.did);
  if (!session) return;
  const packets =
    typeof event.packets === 'number' && Number.isSafeInteger(event.packets) && event.packets >= 0
      ? event.packets
      : undefined;
  const bytes =
    typeof event.bytes === 'number' && Number.isSafeInteger(event.bytes) && event.bytes >= 0
      ? event.bytes
      : undefined;
  const advanced =
    (packets !== undefined && packets > (session.lastSourcePackets ?? -1)) ||
    (bytes !== undefined && bytes > (session.lastSourceBytes ?? -1));
  if (packets !== undefined) session.lastSourcePackets = packets;
  if (bytes !== undefined) session.lastSourceBytes = bytes;
  if (advanced) {
    session.lastSourceRtpAt = now;
    if (session.mediaReadyAt > 0) session.mediaReadyAt = now;
  }
}

export function logRtpStats(
  event: NativeMediaEvent,
  sessions: Map<string, NativeCameraSession>,
  log: NativeMediaLog,
): void {
  const session = typeof event.did === 'string' ? sessions.get(event.did) : undefined;
  if (
    !session ||
    !['source', 'viewer'].includes(String(event.stage)) ||
    !['video', 'audio'].includes(String(event.media))
  )
    return;
  const counts: Record<string, number> = {};
  for (const name of [
    'packets',
    'bytes',
    'sequence_gaps',
    'kernel_drops',
    'truncated',
    'source_restarts',
    'receive_buffer_bytes',
  ]) {
    const count = event[name];
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
      counts[name] = count;
  }
  log('rtp_ingress_stats', {
    cameraId: session.cameraId,
    ...(isUuid(event.viewer_id) ? { viewerId: event.viewer_id } : {}),
    stage: event.stage,
    media: event.media,
    ...counts,
  });
}
