/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { open } from 'node:fs/promises';
import {
  trustedCaptureParameters,
  trustedCaptureProvenance,
  type Provenance,
} from '@haus/kitsune/native';
import {
  inspectAudioAlignment,
  inspectPlaybackCadence,
  inspectSourceAudio,
  playbackArguments,
  probeMedia,
  probeOriginalPlaybackFile,
  runMediaProcess,
  type AudioAlignment,
} from '@haus/media/pipeline';

export {
  inspectAudioAlignment,
  inspectPlaybackCadence as inspectCadence,
  inspectSourceAudio as sourceHasAudio,
  playbackArguments,
  runMediaProcess as runMedia,
};

export interface ProbedMediaSummary {
  duration: number;
  codec?: string;
  audio: boolean;
}

export async function probe(path: string): Promise<ProbedMediaSummary> {
  const info = await probeMedia(path);
  return {
    duration: info.duration,
    codec: info.videoCodec,
    audio: Boolean(info.audioCodec),
  };
}

export interface VideoStreamParameters {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  has_b_frames?: number;
  duration?: string | number;
  start_time?: string | number;
}

export interface ProbedPacket {
  stream_index?: number;
  pts_time?: string | number;
  dts_time?: string | number;
  flags?: string;
}

export interface ProbedOriginalPlaybackInfo {
  streams?: VideoStreamParameters[];
  packets?: ProbedPacket[];
}

export type OriginalPlaybackProvenance =
  (Provenance & Record<string, unknown>) | Record<string, unknown>;

/** Packet timing is not a hardware-decoder proof. Only validated capture provenance admits originals. */
export function trustedOriginalParameters(
  video?: VideoStreamParameters,
  provenance?: OriginalPlaybackProvenance,
): boolean {
  if (provenance?.kind === 'haus-encoder' && provenance.profile === 1) return true;
  return trustedCaptureParameters(video, provenance as Provenance | undefined);
}

export function hasTrustedProvenance(provenance?: OriginalPlaybackProvenance): boolean {
  return (
    (provenance?.kind === 'haus-encoder' && provenance.profile === 1) ||
    trustedCaptureProvenance(provenance as Provenance | undefined)
  );
}

/** A seekable MP4 must expose its index before the first media payload. */
export async function hasFrontIndex(path: string): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    let offset = 0;
    const header = Buffer.alloc(16);
    for (let count = 0; count < 64 && offset + 8 <= size; count++) {
      const { bytesRead } = await file.read(header, 0, 16, offset);
      if (bytesRead < 8) return false;
      const type = header.toString('ascii', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      let bytes = header.readUInt32BE(0);
      if (bytes === 1) {
        if (bytesRead < 16) return false;
        const large = header.readBigUInt64BE(8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) return false;
        bytes = Number(large);
      }
      if (bytes < 8 || offset + bytes > size) return false;
      offset += bytes;
    }
    return false;
  } finally {
    await file.close();
  }
}

/** Packet-level admission is conservative: questionable media keeps the repair path. */
export function compatiblePackets(
  info: ProbedOriginalPlaybackInfo,
  alignment: AudioAlignment = {},
  provenance?: OriginalPlaybackProvenance,
): boolean {
  const video = info.streams?.find((s) => s.codec_type === 'video');
  const audio = info.streams?.find((s) => s.codec_type === 'audio');
  if (
    !trustedOriginalParameters(video, provenance) ||
    video?.codec_name !== 'h264' ||
    video.pix_fmt !== 'yuv420p' ||
    !video.profile ||
    !['Baseline', 'Constrained Baseline', 'Main', 'High'].includes(video.profile) ||
    (alignment.audioTrimSeconds ?? 0) > 0 ||
    (alignment.audioTailSeconds ?? 0) > 1
  ) {
    return false;
  }
  const duration = Number(video.duration);
  const start = Number(video.start_time);
  if (!(duration > 0) || !Number.isFinite(start) || Math.abs(start) > 0.15) return false;
  if (
    audio &&
    (audio.codec_name !== 'aac' ||
      !Number.isFinite(Number(audio.start_time)) ||
      Math.abs(Number(audio.start_time) - start) > 0.2 ||
      !Number.isFinite(Number(audio.duration)) ||
      Math.abs(Number(audio.duration) - duration) > 1)
  ) {
    return false;
  }
  const packets = (info.packets ?? []).filter((p) => p.stream_index === video.index);
  if (packets.length < 2 || !String(packets[0]?.flags).includes('K')) return false;
  let dts = -Infinity;
  const times: number[] = [];
  const keys: number[] = [];
  for (const packet of packets) {
    const pts = Number(packet.pts_time);
    const nextDts = Number(packet.dts_time);
    if (!Number.isFinite(pts) || !Number.isFinite(nextDts) || nextDts <= dts || pts < -0.15) {
      return false;
    }
    dts = nextDts;
    times.push(pts);
    if (String(packet.flags).includes('K')) keys.push(pts);
  }
  times.sort((a, b) => a - b);
  keys.sort((a, b) => a - b);
  const lastTime = times.at(-1);
  const lastKey = keys.at(-1);
  if (
    times[0] === undefined ||
    lastTime === undefined ||
    lastKey === undefined ||
    times[0] > 0.15 ||
    duration - lastTime > 0.5 ||
    times.some((at, i) => i > 0 && (at <= times[i - 1]! || at - times[i - 1]! > 0.5))
  ) {
    return false;
  }
  return keys.every((at, i) => i === 0 || at - keys[i - 1]! <= 2.5) && duration - lastKey <= 2.5;
}

export async function inspectOriginalPlayback(
  path: string,
  alignment: AudioAlignment = {},
  provenance?: OriginalPlaybackProvenance,
): Promise<boolean> {
  if (!hasTrustedProvenance(provenance)) return false;
  if (!(await hasFrontIndex(path))) return false;
  try {
    const info = (await probeOriginalPlaybackFile(path, {
      timeout: 15000,
      maxOutput: 4000000,
    })) as ProbedOriginalPlaybackInfo;
    return compatiblePackets(info, alignment, provenance);
  } catch {
    return false;
  }
}
