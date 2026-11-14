/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ChildProcess } from 'node:child_process';
import { defaultMediaRuntime } from '../pipeline/tools.js';
import type { MediaRuntime } from '../pipeline/tools.js';
import { mediaInputArguments, parseMediaInputProfile } from '../pipeline/input.js';

export interface RecordingCaptureOptions {
  source: string;
  token?: string;
  inputArguments?: readonly string[];
  recordAudio: boolean;
  expectedAudio?: boolean;
  segmentList: string;
  segmentPattern: string;
  runtime?: MediaRuntime;
}

/** Starts the bounded stream-copy segment producer used by rolling capture. */
export function spawnRecordingCapture({
  source,
  token,
  inputArguments = [],
  recordAudio,
  expectedAudio: _expectedAudio,
  segmentList,
  segmentPattern,
  runtime = defaultMediaRuntime,
}: RecordingCaptureOptions): ChildProcess {
  if (
    !source ||
    source.includes('\0') ||
    !segmentList ||
    segmentList.includes('\0') ||
    !segmentPattern ||
    segmentPattern.includes('\0') ||
    (token !== undefined && /[\r\n]/.test(token))
  )
    throw new Error('invalid_media_capture');
  const profile = parseMediaInputProfile(inputArguments);
  const args = [
    '-hide_banner',
    '-loglevel',
    profile.logLevel ?? 'error',
    '-nostdin',
    '-y',
    '-progress',
    'pipe:1',
    '-stats_period',
    '1',
    /^rtsps?:/i.test(source) ? '-timeout' : '-rw_timeout',
    '15000000',
    '-analyzeduration',
    '8000000',
    '-probesize',
    '8000000',
    '-fflags',
    '+discardcorrupt',
    ...mediaInputArguments(profile),
    ...(token ? ['-headers', `Authorization: Bearer ${token}\r\n`] : []),
    '-i',
    source,
    '-map',
    '0:v:0',
    ...(recordAudio ? ['-map', '0:a?', '-c:a', 'aac', '-b:a', '96k'] : ['-an']),
    '-c:v',
    'copy',
    '-f',
    'segment',
    '-segment_time',
    '2',
    '-reset_timestamps',
    '1',
    '-segment_list',
    segmentList,
    '-segment_list_type',
    'csv',
    '-segment_list_size',
    '512',
    segmentPattern,
  ];
  return runtime.spawn('ffmpeg', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TZ: 'UTC' },
  });
}
