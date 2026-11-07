/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { runMediaProcess } from './transcode.js';
import type { MediaProcessResult, MediaProcessRunOptions } from './transcode.js';

export interface PlaybackProfile {
  copyVideo?: boolean;
  audioTrimSeconds?: number;
  videoDuration?: number;
}

export function playbackArguments({
  copyVideo = false,
  audioTrimSeconds = 0,
  videoDuration,
}: PlaybackProfile = {}): string[] {
  const audioFilter =
    Number.isFinite(audioTrimSeconds) && audioTrimSeconds > 0
      ? `atrim=start=${audioTrimSeconds},asetpts=PTS-STARTPTS,aresample=async=1000:first_pts=0,apad`
      : 'aresample=async=1000:first_pts=0,apad';
  return [
    ...(copyVideo
      ? ['-c:v', 'copy']
      : [
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-threads',
          '2',
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
        ]),
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-af',
    audioFilter,
    '-shortest',
    ...(videoDuration !== undefined && Number.isFinite(videoDuration) && videoDuration > 0
      ? ['-t', String(videoDuration)]
      : []),
    '-movflags',
    '+faststart',
  ];
}

export interface PlaybackTranscodeOptions extends PlaybackProfile {
  input: string;
  output: string;
  concat?: boolean;
  recordAudio?: boolean;
  timeout?: number;
  signal?: AbortSignal;
  runtime?: MediaProcessRunOptions['runtime'];
}

/** Encodes prepared local playback with the fixed Haus cadence and codec profile. */
export function transcodePlayback({
  input,
  output,
  concat = false,
  recordAudio = true,
  copyVideo = false,
  audioTrimSeconds = 0,
  videoDuration,
  timeout,
  signal,
  runtime,
}: PlaybackTranscodeOptions): Promise<MediaProcessResult> {
  return runMediaProcess(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      ...(concat ? ['-f', 'concat', '-safe', '0'] : []),
      '-i',
      input,
      ...(recordAudio ? ['-c:a', 'aac', '-b:a', '96k'] : ['-an']),
      ...playbackArguments({ copyVideo, audioTrimSeconds, videoDuration }),
      output,
    ],
    { timeout, signal, runtime },
  );
}

export interface AudioAlignment {
  videoDuration?: number;
  audioTailSeconds?: number;
  audioTrimSeconds?: number;
}

/** Detect and measure only a proven silent audio lead before trimming a recording. */
export async function inspectAudioAlignment(
  path: string,
  expectedSeconds: number,
  options: MediaProcessRunOptions = {},
): Promise<AudioAlignment> {
  const result = await runMediaProcess(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', path],
    { timeout: 15000, ...options },
  );
  const streams =
    (
      JSON.parse(result.stdout) as {
        streams?: Array<{ codec_type?: string; duration?: string | number }>;
      }
    ).streams ?? [];
  const video = Number(streams.find((stream) => stream.codec_type === 'video')?.duration);
  const audio = Number(streams.find((stream) => stream.codec_type === 'audio')?.duration);
  const excess = audio - video;
  if (!Number.isFinite(video) || video <= 0) return {};
  if (!Number.isFinite(excess) || excess <= 3) return { videoDuration: video };
  const diagnostics = { videoDuration: video, audioTailSeconds: excess };
  if (
    !Number.isFinite(expectedSeconds) ||
    expectedSeconds <= 0 ||
    video < expectedSeconds * 0.5 ||
    video > expectedSeconds + 30 ||
    excess > 86400
  )
    return diagnostics;
  const measured = await runMediaProcess(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-t',
      String(Math.max(0, excess - 0.25)),
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-',
    ],
    { timeout: 30000, ...options },
  );
  const mean = Number(/mean_volume:\s*(-?[\d.]+) dB/.exec(measured.stderr)?.[1]);
  const peak = Number(/max_volume:\s*(-?[\d.]+) dB/.exec(measured.stderr)?.[1]);
  return Number.isFinite(mean) && Number.isFinite(peak) && mean <= -85 && peak <= -65
    ? { ...diagnostics, audioTrimSeconds: excess }
    : diagnostics;
}

export interface CadenceInspection {
  sourceGaps: Array<{ at: number; duration: number }>;
  largestGap: number;
}

export async function inspectPlaybackCadence(
  path: string,
  options: MediaProcessRunOptions = {},
): Promise<CadenceInspection> {
  const { stdout } = await runMediaProcess(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'packet=pts_time',
      '-of',
      'csv=p=0',
      path,
    ],
    { timeout: 30000, maxOutput: 2000000, ...options },
  );
  const points = stdout
    .split('\n')
    .filter((value) => value.trim())
    .map((value) => Number(value.trim().split(',')[0]))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  const gaps: Array<{ at: number; duration: number }> = [];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous !== undefined && current !== undefined && current - previous > 0.5)
      gaps.push({ at: previous, duration: current - previous });
  }
  return {
    sourceGaps: gaps.slice(0, 100),
    largestGap: gaps.reduce((maximum, gap) => Math.max(maximum, gap.duration), 0),
  };
}

export async function probeOriginalPlaybackFile(
  path: string,
  options: MediaProcessRunOptions = {},
): Promise<unknown> {
  const { stdout } = await runMediaProcess(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=index,codec_name,codec_type,profile,pix_fmt,start_time,duration,level,width,height,has_b_frames:packet=stream_index,pts_time,dts_time,flags',
      '-of',
      'json',
      path,
    ],
    { timeout: 15000, maxOutput: 4000000, ...options },
  );
  return JSON.parse(stdout) as unknown;
}
