/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { defaultMediaRuntime, MediaRuntime } from '../pipeline/tools.js';
import type { MediaRuntime as MediaRuntimeType } from '../pipeline/tools.js';

export interface TalkbackPipeOptions {
  targetUrl: string;
  inputFormat?: string;
  outputFormat?: string;
  sampleRate?: number;
  channels?: number;
  bitrate?: string;
  codec?: string;
  spawnProcess?: typeof spawn;
  runtime?: MediaRuntimeType;
}

export function spawnTalkbackPipe({
  targetUrl,
  inputFormat = 'webm',
  outputFormat = 'flv',
  sampleRate = 16000,
  channels = 1,
  bitrate = '32k',
  codec = 'aac',
  spawnProcess,
  runtime = defaultMediaRuntime,
}: TalkbackPipeOptions): ChildProcess {
  const processRuntime = spawnProcess
    ? new MediaRuntime({ tools: runtime.tools, spawnProcess })
    : runtime;
  return processRuntime.spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-probesize',
      '32768',
      '-analyzeduration',
      '500000',
      '-f',
      inputFormat,
      '-i',
      'pipe:0',
      '-vn',
      '-c:a',
      codec,
      '-b:a',
      bitrate,
      '-ar',
      String(sampleRate),
      '-ac',
      String(channels),
      '-flush_packets',
      '1',
      '-f',
      outputFormat,
      targetUrl,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
}
