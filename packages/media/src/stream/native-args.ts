/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { NativeCameraSession, NativeCameraViewer } from './native-types.js';
import type { NativeMediaEvent } from './native-types.js';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asEvent = (value: unknown): NativeMediaEvent | undefined => {
  if (!isRecord(value) || typeof value.event !== 'string') return undefined;
  return { ...value, event: value.event };
};

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

export const safeMediaError = (value: unknown): string =>
  String(value ?? '')
    .replace(/rtsps?:\/\/[^\s'"<>]+/gi, '[redacted RTSP URL]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted IP]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-320);

export function producerArgs(session: NativeCameraSession): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-rtsp_transport',
    'tcp',
    '-timeout',
    '15000000',
    '-fflags',
    '+genpts+discardcorrupt',
    '-analyzeduration',
    '1000000',
    '-probesize',
    '1000000',
    '-i',
    session.source,
    '-map',
    '0:v:0',
    '-an',
    '-c:v',
    'copy',
    '-bsf:v',
    'dump_extra=freq=keyframe',
    '-f',
    'rtp',
    '-payload_type',
    '96',
    `rtp://127.0.0.1:${session.videoPort}?pkt_size=1200`,
    '-map',
    '0:a:0',
    '-vn',
    '-c:a',
    'aac',
    '-profile:a',
    'aac_low',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-b:a',
    '32k',
    '-f',
    'rtp',
    '-payload_type',
    '97',
    `rtp://127.0.0.1:${session.audioPort}?pkt_size=1200`,
  ];
}

export function viewerArgs(
  rtspUrl: string,
  session: NativeCameraSession,
  viewer: NativeCameraViewer,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-rtsp_transport',
    'tcp',
    '-timeout',
    '15000000',
    '-fflags',
    '+genpts+discardcorrupt',
    '-analyzeduration',
    '1000000',
    '-probesize',
    '1000000',
    '-i',
    rtspUrl,
    '-map',
    '0:v:0',
    '-an',
    '-c:v',
    'copy',
    '-bsf:v',
    'dump_extra=freq=keyframe',
    '-f',
    'rtp',
    '-payload_type',
    '96',
    `rtp://127.0.0.1:${viewer.videoPort}?pkt_size=1200`,
    '-map',
    '0:a:0',
    '-vn',
    '-c:a',
    'libopus',
    '-ar',
    '48000',
    '-ac',
    '1',
    '-b:a',
    '48k',
    '-application',
    'lowdelay',
    '-f',
    'rtp',
    '-payload_type',
    '111',
    `rtp://127.0.0.1:${viewer.audioPort}?pkt_size=1200`,
  ];
}

export function rewriteAnswer(sdp: unknown, advertiseHost: string): string {
  if (typeof sdp !== 'string' || sdp.length > 65536) throw new Error('camera_webrtc_failed');
  return sdp.replace(
    /^(a=candidate:\S+\s+\d+\s+\S+\s+\d+\s+)\S+(\s+\d+\s+typ host\b.*)$/gm,
    `$1${advertiseHost}$2`,
  );
}
