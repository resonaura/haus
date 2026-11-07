/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { resolve } from 'node:path';
import { defaultMediaRuntime } from './tools.js';
import type { MediaRuntime, MediaToolName } from './tools.js';

/** Only local MP4 inputs and a fixed playback profile reach FFmpeg. */
function mediaProcess(
  command: MediaToolName,
  args: string[],
  {
    signal,
    timeout = 30000,
    runtime = defaultMediaRuntime,
  }: { signal?: AbortSignal; timeout?: number; runtime?: MediaRuntime } = {},
): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((complete, fail) => {
    const child = runtime.spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
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
    child.stdout?.on('data', (data: Buffer) => {
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

interface ProbeDocument {
  streams?: unknown;
  format?: unknown;
}

interface VideoStream {
  codec_type: string;
  width: number;
  height: number;
  duration: unknown;
}

/** Mirrors `Number(...)` semantics including null→0 and undefined→NaN. */
const toNumber = (value: unknown): number => (value === undefined ? Number.NaN : Number(value));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isVideoStream = (stream: unknown): stream is VideoStream =>
  isObject(stream) &&
  stream.codec_type === 'video' &&
  typeof stream.width === 'number' &&
  typeof stream.height === 'number';

const isAudioStream = (stream: unknown): boolean =>
  isObject(stream) && stream.codec_type === 'audio';

export interface MediaProbe {
  duration: number;
  containerDuration: number;
  audioDuration: number;
  width: number;
  height: number;
  audio: boolean;
}

async function metadata(
  path: string,
  signal?: AbortSignal,
  runtime: MediaRuntime = defaultMediaRuntime,
): Promise<MediaProbe> {
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
    { signal, runtime },
  );
  let data: unknown;
  try {
    data = JSON.parse(raw) as ProbeDocument;
  } catch {
    throw new Error('invalid_media');
  }
  const streams = isObject(data) && Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find(isVideoStream);
  const format =
    isObject(data) && data.format !== undefined && data.format !== null ? data.format : {};
  const formatValue = isObject(format) ? format : {};
  const duration = toNumber(video?.duration ?? formatValue.duration);
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
  const audioStream = streams.find(isAudioStream);
  return {
    duration,
    containerDuration: toNumber(formatValue.duration),
    audioDuration: toNumber(isObject(audioStream) ? audioStream.duration : undefined),
    width: video.width,
    height: video.height,
    audio: streams.some(isAudioStream),
  };
}

export interface NormalizeRecordingInput {
  input: string;
  output: string;
  audioTrimSeconds: number;
  maxBytes: number;
  signal?: AbortSignal;
  memoryBudget?: number;
  runtime?: MediaRuntime;
}

export type PlaybackPrepared = {
  duration: number;
  width: number;
  height: number;
  audio: boolean;
};
export async function normalizeRecording({
  input,
  output,
  audioTrimSeconds,
  maxBytes,
  signal,
  memoryBudget = Number.POSITIVE_INFINITY,
  runtime = defaultMediaRuntime,
}: NormalizeRecordingInput): Promise<PlaybackPrepared> {
  if (resolve(input) === resolve(output)) throw new Error('invalid_media');
  const source = await metadata(input, signal, runtime);
  // Conservative frame/lookahead allowance; retain source resolution or decline.
  if (source.width * source.height * 96 > memoryBudget) throw new Error('media_capacity');
  const audio =
    audioTrimSeconds > 0
      ? 'atrim=start=' +
        audioTrimSeconds +
        ',asetpts=PTS-STARTPTS,aresample=async=1000:first_pts=0,apad'
      : 'aresample=async=1000:first_pts=0,apad';
  await mediaProcess(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-protocol_whitelist',
      'file',
      '-f',
      'mov',
      '-enable_drefs',
      '0',
      '-use_absolute_path',
      '0',
      '-threads',
      '2',
      '-i',
      input,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-threads',
      '2',
      '-filter_threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-vf',
      'fps=20:start_time=0',
      '-fps_mode',
      'cfr',
      '-g',
      '40',
      '-keyint_min',
      '20',
      '-sc_threshold',
      '0',
      '-bf',
      '0',
      '-video_track_timescale',
      '90000',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-af',
      audio,
      '-shortest',
      // Older packaged FFmpeg can otherwise retain a long source audio tail
      // despite -shortest when the audio filter pads missing samples.
      '-t',
      String(source.duration),
      '-movflags',
      '+faststart',
      '-fs',
      String(maxBytes),
      output,
    ],
    {
      signal,
      timeout: Math.min(480000, Math.max(120000, source.duration * 5000)),
      runtime,
    },
  );
  const result = await metadata(output, signal, runtime);
  if (
    result.width !== source.width ||
    result.height !== source.height ||
    Math.abs(result.duration - source.duration) > 1 ||
    !Number.isFinite(result.containerDuration) ||
    result.containerDuration > result.duration + 0.2 ||
    (result.audio &&
      (!Number.isFinite(result.audioDuration) || result.audioDuration > result.duration + 0.2)) ||
    (source.audio && !result.audio)
  )
    throw new Error('invalid_prepared_media');
  return {
    duration: result.duration,
    width: result.width,
    height: result.height,
    audio: result.audio,
  };
}
