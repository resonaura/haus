/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { expect, it } from 'vitest';
import { inspectSourceAudio } from '../src/pipeline/source.js';
import { MediaRuntime } from '../src/pipeline/tools.js';
import { spawnRecordingCapture } from '../src/recording/capture.js';

it('builds a protected segment-capture process from a validated input profile', () => {
  let observed: { file: string; args: readonly string[]; options: SpawnOptions } | undefined;
  const spawnProcess = ((file: string, args: readonly string[], options: SpawnOptions) => {
    observed = { file, args, options };
    return new EventEmitter() as unknown as ChildProcess;
  }) as typeof import('node:child_process').spawn;
  const runtime = new MediaRuntime({
    tools: { ffmpeg: '/opt/media/ffmpeg' },
    spawnProcess,
  });

  spawnRecordingCapture({
    source: 'rtsp://192.168.1.10/live',
    token: 'fixture-token',
    inputArguments: ['-rtsp_transport', 'tcp'],
    recordAudio: true,
    expectedAudio: false,
    segmentList: '/recordings/camera/index.csv',
    segmentPattern: '/recordings/camera/clip-%09d.mp4',
    runtime,
  });

  expect(observed?.file).toBe('/opt/media/ffmpeg');
  expect(observed?.args).toContain('-rtsp_transport');
  expect(observed?.args).toContain('0:a?');
  expect(observed?.args).toContain('Authorization: Bearer fixture-token\r\n');
  expect(observed?.options.shell).toBe(false);
});

it('rejects arbitrary FFmpeg input switches before spawning', () => {
  expect(() =>
    spawnRecordingCapture({
      source: 'rtsp://192.168.1.10/live',
      inputArguments: ['-i', '/etc/passwd'],
      recordAudio: false,
      segmentList: '/recordings/index.csv',
      segmentPattern: '/recordings/clip-%09d.mp4',
    }),
  ).toThrow('invalid_media_input_profile');
});

it('probes live source audio without replaying real-time input options', async () => {
  let observed: { file: string; args: readonly string[]; options: SpawnOptions } | undefined;
  const spawnProcess = ((file: string, args: readonly string[], options: SpawnOptions) => {
    observed = { file, args, options };
    const child = new EventEmitter() as unknown as ChildProcess;
    const stdout = new EventEmitter();
    Object.assign(child, { stdout, stderr: new EventEmitter(), kill: () => true });
    setTimeout(() => {
      stdout.emit('data', Buffer.from('{"streams":[{"codec_type":"audio"}]}'));
      child.emit('close', 0);
    }, 0);
    return child;
  }) as typeof import('node:child_process').spawn;
  const runtime = new MediaRuntime({
    tools: { ffprobe: '/opt/media/ffprobe' },
    spawnProcess,
  });

  await expect(
    inspectSourceAudio(
      'http://192.168.1.10/live.m3u8',
      'fixture-token',
      undefined,
      ['-live_start_index', '-1', '-re'],
      { runtime },
    ),
  ).resolves.toBe(true);

  expect(observed?.file).toBe('/opt/media/ffprobe');
  expect(observed?.args).toContain('-live_start_index');
  expect(observed?.args).not.toContain('-re');
  expect(observed?.options.shell).toBe(false);
});
