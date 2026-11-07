/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { defaultMediaRuntime, MediaRuntime } from './tools.js';
import type { MediaToolName } from './tools.js';

export interface CameraProcessOptions {
  signal?: AbortSignal;
  timeout?: number;
  spawnProcess?: typeof spawn;
  runtime?: MediaRuntime;
}

export interface CameraMetadataResult {
  audio: boolean;
  video: boolean;
  width?: number;
  height?: number;
  duration?: number;
}

export async function cameraProcess(
  file: MediaToolName,
  args: string[],
  {
    signal,
    timeout = 15000,
    spawnProcess,
    runtime = defaultMediaRuntime,
  }: CameraProcessOptions = {},
): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const processRuntime = spawnProcess
      ? new MediaRuntime({ tools: runtime.tools, spawnProcess })
      : runtime;
    const child = processRuntime.spawn(file, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '',
      failed = false;
    const kill = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(kill, timeout);
    signal?.addEventListener('abort', kill, { once: true });
    child.on('error', () => {
      failed = true;
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      if (output.length + chunk.length > 1000000) kill();
      else output += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      if (code === 0 && !failed) resolve(output);
      else reject(new Error('camera_media_failed'));
    });
  });
}

export async function cameraMetadata(
  file: string,
  options?: CameraProcessOptions,
): Promise<CameraMetadataResult> {
  const value = JSON.parse(
    await cameraProcess(
      'ffprobe',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-count_packets',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height,duration,nb_read_packets',
        '-of',
        'json',
        file,
      ],
      options,
    ),
  ) as {
    streams?: Array<{
      codec_type?: string;
      nb_read_packets?: string | number;
      width?: number;
      height?: number;
    }>;
    format?: { duration?: string | number };
  };
  const video = value.streams?.find((row) => row.codec_type === 'video');
  return {
    audio:
      value.streams?.some(
        (row) => row.codec_type === 'audio' && Number(row.nb_read_packets) > 0,
      ) === true,
    video: Boolean(video) && Number(video?.nb_read_packets) > 0,
    width: video?.width,
    height: video?.height,
    duration: Number(value.format?.duration),
  };
}

export async function cameraFileDigest(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}
