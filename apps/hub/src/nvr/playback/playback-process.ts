/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/** Only local MP4 inputs and a fixed playback profile reach FFmpeg. */
function mediaProcess(
  command: string,
  args: string[],
  { signal, timeout = 30000 }: { signal?: AbortSignal; timeout?: number } = {},
): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((complete, fail) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    let failed = false;
    const abort = (): void => {
      failed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(abort, timeout);
    timer.unref();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('error', () => {
      failed = true;
    });
    child.stdout.on('data', (data: Buffer) => {
      if (output.length + data.length > 1000000) abort();
      else output += data;
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (code === 0 && !failed) complete(output);
      else fail(new Error(signal?.aborted ? 'media_aborted' : 'media_process_failed'));
    });
  });
}

interface ProbeStreams {
  streams?: unknown;
  format?: unknown;
}

interface VideoStreamShape {
  codec_type: string;
  width: number;
  height: number;
  duration: unknown;
}

/** Mirrors `Number(...)` semantics of the original including null→0 and undefined→NaN. */
const toNumber = (value: unknown): number => {
  if (value === undefined) return Number.NaN;
  return Number(value);
};

export interface MediaProbe {
  duration: number;
  containerDuration: number;
  audioDuration: number;
  width: number;
  height: number;
  audio: boolean;
}

interface StreamShape {
  codec_type: unknown;
  duration: unknown;
}

const isVideoStream = (stream: unknown): stream is VideoStreamShape =>
  typeof stream === 'object' &&
  stream !== null &&
  (stream as Record<string, unknown>).codec_type === 'video' &&
  typeof (stream as Record<string, unknown>).width === 'number' &&
  typeof (stream as Record<string, unknown>).height === 'number';

const isStream = (stream: unknown): stream is StreamShape =>
  typeof stream === 'object' && stream !== null;

async function metadata(path: string, signal?: AbortSignal): Promise<MediaProbe> {
  const raw = await mediaProcess(
    'ffprobe',
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file',
      '-f',
      'mov',
      '-enable_drefs',
      '0',
      '-use_absolute_path',
      '0',
      '-show_entries',
      'format=duration:stream=codec_type,width,height,duration',
      '-of',
      'json',
      path,
    ],
    { signal },
  );
  let data: unknown;
  try {
    data = JSON.parse(raw) as ProbeStreams;
  } catch {
    throw new Error('invalid_media');
  }
  const streams =
    typeof data === 'object' && data !== null && Array.isArray((data as ProbeStreams).streams)
      ? ((data as { streams: unknown[] }).streams)
      : [];
  const video = streams.find(isVideoStream);
  const format =
    typeof data === 'object' && data !== null && (data as ProbeStreams).format !== undefined && (data as ProbeStreams).format !== null
      ? data.format
      : {};
  const duration = toNumber(video?.duration ?? (format as Record<string, unknown>).duration);
  if (
    !video ||
    !Number.isFinite(duration) ||
    duration < 0.1 ||
    duration > 600 ||
    !(video.width > 0 && video.height > 0) ||
    video.width > 4096 ||
    video.height > 4096 ||
    video.width * video.height > 3840 * 2160 ||
    video.width % 2 ||
    video.height % 2
  )
    throw new Error('invalid_media');
  return {
    duration,
    containerDuration: toNumber((format as Record<string, unknown>).duration),
    audioDuration: toNumber(streams.find(isAudio)?.duration),
    width: video.width,
    height: video.height,
    audio: streams.some(isStreamAudio),
  };
}

const isAudio = (stream: unknown): boolean =>
  isStream(stream) && (stream as Record<string, unknown>).codec_type === 'audio';

const isStreamAudio = (stream: unknown): boolean =>
  isStream(stream) && (stream as Record<string, unknown>).codec_type === 'audio';
