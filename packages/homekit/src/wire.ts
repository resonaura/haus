/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  MediaCommand,
  Video,
  WireCrypto,
  RecordingSettings,
  MediaStartRequest,
} from './contracts.js';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw Error('invalid_homekit_context');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw Error('invalid_homekit_context');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('invalid_homekit_context');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw Error('invalid_homekit_context');
  return value;
}
function video(value: unknown): Video {
  const row = record(value);
  return {
    width: number(row.width),
    height: number(row.height),
    fps: number(row.fps),
    bitrate: number(row.bitrate),
    profile: number(row.profile),
    level: number(row.level),
  };
}
function crypto(value: unknown): WireCrypto {
  const row = record(value);
  return {
    port: number(row.port),
    srtpCryptoSuite: number(row.srtpCryptoSuite),
    key: text(row.key),
    salt: text(row.salt),
  };
}
function configuration(value: unknown): RecordingSettings | null {
  if (value === null) return null;
  const row = record(value);
  return {
    video: video(row.video),
    fragmentLength: number(row.fragmentLength),
    prebufferLength: number(row.prebufferLength),
    audio: boolean(row.audio),
    audioRate: number(row.audioRate),
    audioBitrate: number(row.audioBitrate),
  };
}
function start(value: unknown): MediaStartRequest {
  const row = record(value),
    v = record(row.video),
    a = record(row.audio);
  const { bitrate: _bitrate, ...settings } = video({ ...v, bitrate: v.max_bit_rate });
  return {
    sessionID: text(row.sessionID),
    video: {
      ...settings,
      max_bit_rate: number(v.max_bit_rate),
      pt: number(v.pt),
      mtu: number(v.mtu),
    },
    audio: {
      codec: text(a.codec),
      sample_rate: number(a.sample_rate),
      pt: number(a.pt),
      max_bit_rate: number(a.max_bit_rate),
      packet_time: number(a.packet_time),
    },
  };
}

/** Decode transport data; the media engine applies capability, range and ownership checks. */
export function mediaCommand(value: unknown): MediaCommand {
  const row = record(value);
  const context = {
    cameraId: text(row.cameraId),
    owner: text(row.owner),
    sessionId: text(row.sessionId),
    address: text(row.address),
  };
  switch (row.action) {
    case 'configure':
      return {
        ...context,
        action: row.action,
        generation: number(row.generation),
        configuration: configuration(row.configuration),
      };
    case 'open':
    case 'next':
    case 'close':
      return {
        ...context,
        action: row.action,
        ...(row.readerId === undefined ? {} : { readerId: text(row.readerId) }),
        ...(row.cursor === undefined ? {} : { cursor: number(row.cursor) }),
      };
    case 'prepare': {
      const request = record(row.request);
      return {
        ...context,
        action: row.action,
        request: {
          sessionID: text(request.sessionID),
          targetAddress: text(request.targetAddress),
          video: crypto(request.video),
          audio: crypto(request.audio),
        },
      };
    }
    case 'start':
      return {
        ...context,
        action: row.action,
        request: start(row.request),
        ...(row.talkback === undefined ? {} : { talkback: boolean(row.talkback) }),
        ...(row.microphoneMuted === undefined
          ? {}
          : { microphoneMuted: boolean(row.microphoneMuted) }),
        ...(row.microphoneVolume === undefined
          ? {}
          : { microphoneVolume: number(row.microphoneVolume) }),
        ...(row.speakerVolume === undefined ? {} : { speakerVolume: number(row.speakerVolume) }),
      };
    case 'stop':
    case 'talk':
      return { ...context, action: row.action, sessionID: text(row.sessionID) };
    case 'snapshot':
      return { ...context, action: row.action };
    case 'lease':
      return {
        ...context,
        action: row.action,
        ...(row.sessionID === undefined ? {} : { sessionID: text(row.sessionID) }),
      };
    default:
      throw Error('invalid_homekit_action');
  }
}
