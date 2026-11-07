/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { defaultMediaRuntime, MediaRuntime } from './tools.js';
import type { MediaRuntime as MediaRuntimeType } from './tools.js';

export interface RawVideoDecoderOptions {
  source: string;
  width: number;
  height: number;
  fps: number;
  headers?: string;
  runtime?: MediaRuntimeType;
  spawnProcess?: typeof spawn;
}

/** Starts a bounded RGB frame decoder for consumers that process live video. */
export function spawnRawVideoDecoder({
  source,
  width,
  height,
  fps,
  headers,
  runtime = defaultMediaRuntime,
  spawnProcess,
}: RawVideoDecoderOptions): ChildProcess {
  if (
    !source ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > 4096 ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 4096 ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    fps > 60
  )
    throw new Error('invalid_media_decoder_profile');
  const processRuntime = spawnProcess
    ? new MediaRuntime({ tools: runtime.tools, spawnProcess })
    : runtime;
  return processRuntime.spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-filter_threads',
      '1',
      /^rtsps?:/.test(source) ? '-timeout' : '-rw_timeout',
      '15000000',
      '-threads',
      '1',
      '-skip_frame',
      'nokey',
      ...(headers ? ['-headers', headers] : []),
      ...(/^rtsps?:/.test(source) ? ['-rtsp_transport', 'tcp'] : ['-live_start_index', '-1']),
      '-i',
      source,
      '-an',
      '-vf',
      `fps=${fps},scale=${width}:${height}:flags=area`,
      '-threads',
      '1',
      '-pix_fmt',
      'bgr24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}
