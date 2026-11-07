/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { expect, it } from 'vitest';
import { spawnRawVideoDecoder } from '../src/pipeline/frames.js';
import { MediaRuntime } from '../src/pipeline/tools.js';

it('uses injected tool paths and forces direct child execution', () => {
  let observed: { file: string; args: readonly string[]; options: SpawnOptions } | undefined;
  const spawnProcess = ((file: string, args: readonly string[], options: SpawnOptions) => {
    observed = { file, args, options };
    return new EventEmitter() as ChildProcess;
  }) as typeof import('node:child_process').spawn;
  const runtime = new MediaRuntime({
    tools: { ffmpeg: '/opt/haus/media/ffmpeg', ffprobe: '/opt/haus/media/ffprobe' },
    spawnProcess,
  });

  runtime.spawn('ffmpeg', ['-version'], { stdio: 'ignore' });

  expect(observed?.file).toBe('/opt/haus/media/ffmpeg');
  expect(observed?.args).toEqual(['-version']);
  expect(observed?.options).toMatchObject({ stdio: 'ignore', shell: false });
});

it('rejects empty or NUL-containing executable paths', () => {
  expect(() => new MediaRuntime({ tools: { ffmpeg: '  ' } })).toThrow('invalid_media_tool');
  expect(() => new MediaRuntime({ tools: { ffmpeg: 'ffmpeg\0unsafe' } })).toThrow(
    'invalid_media_tool',
  );
});

it('builds live raw-frame decode arguments inside the media package', () => {
  let observed: { file: string; args: readonly string[]; options: SpawnOptions } | undefined;
  const spawnProcess = ((file: string, args: readonly string[], options: SpawnOptions) => {
    observed = { file, args, options };
    return new EventEmitter() as ChildProcess;
  }) as typeof import('node:child_process').spawn;
  const runtime = new MediaRuntime({ tools: { ffmpeg: '/opt/media/ffmpeg' }, spawnProcess });

  spawnRawVideoDecoder({
    source: 'rtsp://192.168.1.10/camera',
    width: 320,
    height: 180,
    fps: 1,
    runtime,
  });

  expect(observed?.file).toBe('/opt/media/ffmpeg');
  expect(observed?.args).toContain('-rtsp_transport');
  expect(observed?.args).toContain('fps=1,scale=320:180:flags=area');
  expect(observed?.args).toContain('bgr24');
  expect(observed?.options.shell).toBe(false);
});

it('rejects invalid raw-frame decode profiles before spawning', () => {
  expect(() =>
    spawnRawVideoDecoder({ source: 'rtsp://camera', width: 0, height: 180, fps: 1 }),
  ).toThrow('invalid_media_decoder_profile');
});
