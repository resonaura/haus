/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';

export type MediaSpawnOptions = Omit<SpawnOptions, 'shell'>;

export type MediaToolName = 'ffmpeg' | 'ffprobe' | 'camera';

export interface MediaToolchain {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  readonly camera: string;
}

export interface MediaRuntimeOptions {
  tools?: Partial<MediaToolchain>;
  spawnProcess?: typeof spawn;
}

function toolPath(
  explicit: string | undefined,
  primary: string | undefined,
  legacy: string | undefined,
  fallback: string,
): string {
  const value = explicit ?? primary ?? legacy ?? fallback;
  if (!value.trim() || value.includes('\0')) throw new Error('invalid_media_tool');
  return value;
}

/** Centralizes tool paths and process creation; engines receive this runtime once. */
export class MediaRuntime {
  readonly tools: MediaToolchain;
  readonly spawnProcess: typeof spawn;

  constructor({ tools = {}, spawnProcess = spawn }: MediaRuntimeOptions = {}) {
    this.tools = Object.freeze({
      ffmpeg: toolPath(
        tools.ffmpeg,
        process.env.HAUS_FFMPEG_BIN,
        process.env.FFMPEG_PATH,
        'ffmpeg',
      ),
      ffprobe: toolPath(
        tools.ffprobe,
        process.env.HAUS_FFPROBE_BIN,
        process.env.FFPROBE_PATH,
        'ffprobe',
      ),
      camera: toolPath(
        tools.camera,
        process.env.HAUS_CAMERA_MEDIA_BIN,
        undefined,
        'haus-camera-media',
      ),
    });
    this.spawnProcess = spawnProcess;
  }

  spawn(tool: MediaToolName, args: readonly string[], options: MediaSpawnOptions): ChildProcess {
    return this.spawnProcess(this.tools[tool], [...args], { ...options, shell: false });
  }
}

export const defaultMediaRuntime = new MediaRuntime();
