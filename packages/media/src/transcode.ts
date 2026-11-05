/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn } from 'node:child_process';

export interface MediaProcessRunOptions {
  timeout?: number;
  signal?: AbortSignal;
  maxOutput?: number;
  spawnProcess?: typeof spawn;
}

export interface MediaProcessResult {
  stdout: string;
  stderr: string;
}

export function runMediaProcess(
  command: string,
  args: string[],
  {
    timeout = 120000,
    signal,
    maxOutput = 256000,
    spawnProcess = spawn,
  }: MediaProcessRunOptions = {},
): Promise<MediaProcessResult> {
  return new Promise((resolve, reject) => {
    const process = spawnProcess(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      process.kill('SIGKILL');
    }, timeout);
    process.stdout?.on('data', (data: Buffer) => {
      if (stdout.length < maxOutput) stdout += data.toString();
    });
    process.stderr?.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-8000);
    });
    process.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    process.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`media_process_${code}`));
      }
    });
  });
}

export interface MediaProbeInfo {
  duration: number;
  videoCodec?: string;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
}

export async function probeMedia(
  filePath: string,
  options?: MediaProcessRunOptions,
): Promise<MediaProbeInfo> {
  const result = await runMediaProcess(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_name,codec_type,sample_rate,channels',
      '-of',
      'json',
      filePath,
    ],
    { timeout: 15000, ...options },
  );
  const info = JSON.parse(result.stdout) as {
    format?: { duration?: string | number };
    streams?: Array<{
      codec_name?: string;
      codec_type?: string;
      sample_rate?: string | number;
      channels?: number;
    }>;
  };
  const videoStream = info.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = info.streams?.find((stream) => stream.codec_type === 'audio');
  return {
    duration: Number(info.format?.duration) || 0,
    videoCodec: videoStream?.codec_name,
    audioCodec: audioStream?.codec_name,
    sampleRate: Number(audioStream?.sample_rate) || undefined,
    channels: audioStream?.channels,
  };
}

export async function probeRtspSource(
  input: { url: string; inputArguments?: string[] },
  signal?: AbortSignal,
  options?: { timeout?: number; spawnProcess?: typeof spawn },
): Promise<boolean> {
  signal?.throwIfAborted();
  const spawnProcess = options?.spawnProcess ?? spawn;
  const timeoutMs = options?.timeout ?? 15000;

  return new Promise<boolean>((resolve, reject) => {
    const child = spawnProcess(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        /^rtsps?:/.test(input.url) ? '-timeout' : '-rw_timeout',
        '8000000',
        ...(input.inputArguments || []),
        '-threads',
        '1',
        '-i',
        input.url,
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-an',
        '-progress',
        'pipe:1',
        '-f',
        'null',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let frame = false;
    let failed = false;
    let progress = '';

    const abort = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(abort, timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', abort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      progress += chunk.toString();
      let lineEnd: number;
      while ((lineEnd = progress.indexOf('\n')) !== -1) {
        const line = progress.slice(0, lineEnd).trim();
        progress = progress.slice(lineEnd + 1);
        const match = /^frame=\s*(\d+)$/.exec(line);
        if (match && Number(match[1]) > 0) {
          frame = true;
          abort();
        }
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (frame) {
        resolve(true);
      } else if (signal?.aborted && !failed) {
        reject(signal.reason ?? new Error('aborted'));
      } else {
        resolve(code === 0 && !failed);
      }
    });
  });
}

export async function extractVideoSnapshot(
  inputVideo: string,
  outputImage: string,
  options: {
    timestamp?: number;
    width?: number;
    timeout?: number;
    signal?: AbortSignal;
    spawnProcess?: typeof spawn;
  } = {},
): Promise<void> {
  const ss = String(Math.max(0, options.timestamp ?? 0));
  const scale = options.width ? `scale=${options.width}:-2:flags=area` : 'scale=640:-2:flags=area';

  await runMediaProcess(
    'ffmpeg',
    [
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-ss',
      ss,
      '-i',
      inputVideo,
      '-frames:v',
      '1',
      '-vf',
      scale,
      outputImage,
    ],
    {
      timeout: options.timeout ?? 20000,
      signal: options.signal,
      spawnProcess: options.spawnProcess,
    },
  );
}

export async function inspectAudioAlignment(
  filePath: string,
  expectedSeconds: number,
  options?: MediaProcessRunOptions,
): Promise<{ videoDuration?: number; audioTailSeconds?: number; audioTrimSeconds?: number }> {
  const info = await probeMedia(filePath, options);
  const video = info.duration;
  // Further audio alignment measurement with volumedetect
  if (!Number.isFinite(video) || video <= 0) return {};
  return { videoDuration: video };
}
