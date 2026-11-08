/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mkdir, writeFile, stat, utimes } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runMedia, type RecorderBuffer } from '@haus/hub/events';
import { Motion, type MotionJob } from '@haus/hub/camera';
import { fixture } from './recorder-fixture.js';

test(
  'a decoded primary returns after fallback without interrupting an active event or removing pre-roll',
  { timeout: 45000 },
  async () => {
    const { root, dir, recorder, store } = await fixture();
    const source = join(root, 'primary.mp4');
    await runMedia('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=160x90:r=10',
      '-t',
      '30',
      '-c:v',
      'libx264',
      '-g',
      '10',
      '-bf',
      '0',
      '-threads',
      '1',
      source,
    ]);
    const choices: boolean[] = [];
    recorder.ha.recordingInput = async (_camera, allowDirect) => {
      choices.push(allowDirect);
      return {
        url: source,
        kind: allowDirect ? 'rtsp' : 'ha',
        inputArguments: ['-re', ...(process.env.CI ? ['-loglevel', 'debug'] : [])],
      };
    };
    recorder.primaryRecovery.retryMs = 0;
    recorder.ha.primaryRecordingInput = (camera) =>
      camera ? recorder.ha.recordingInput!(camera, true) : undefined;
    const buffer: RecorderBuffer = {
      id: 'camera.test',
      dir,
      status: 'starting',
      stopped: false,
      directFailures: 3,
      directAttempt: Date.now(),
    };
    recorder.buffers.set(buffer.id, buffer);
    await recorder.startBuffer(buffer);
    let fixtureErrors = '',
      fixtureProgress = '';
    buffer.process?.stderr?.on('data', (chunk: Buffer | string) => {
      fixtureErrors = (fixtureErrors + String(chunk)).slice(-12000);
    });
    buffer.process?.stdout?.on('data', (chunk: Buffer | string) => {
      fixtureProgress = (fixtureProgress + String(chunk)).slice(-2000);
    });
    const deadline = performance.now() + 15000;
    while (buffer.status !== 'buffering' || !(await recorder.segments(buffer)).length) {
      assert.ok(
        performance.now() < deadline,
        `fallback must produce real pre-roll (${buffer.status}, ${buffer.lastError}): ${fixtureErrors}\n${fixtureProgress}`,
      );
      await pause(50);
    }
    const originalProcess = buffer.process,
      parts = await recorder.segments(buffer);
    const event = await recorder.trigger(buffer.id);
    await recorder.tick();
    assert.equal(recorder.primaryRecovery.active.size, 0);
    assert.equal(buffer.process, originalProcess);
    assert.deepEqual(choices, [false]);
    await store.finish(event.id, {
      status: 'interrupted',
      error: 'fixture completed',
    });
    recorder.active.delete(buffer.id);
    await recorder.tick();
    const probe = recorder.primaryRecovery.active.get(buffer)?.pending;
    assert.ok(probe, 'quiet fallback schedules one primary check');
    await probe;
    const recoveredDeadline = performance.now() + 15000;
    while (buffer.inputKind !== 'rtsp' || buffer.status !== 'buffering') {
      assert.ok(
        performance.now() < recoveredDeadline,
        'decoded primary resumes without the failure backoff',
      );
      await pause(50);
    }
    assert.notEqual(buffer.process, originalProcess);
    assert.deepEqual(choices, [false, true, true]);
    for (const part of parts) assert.ok((await stat(part.path)).size > 0);
  },
);

test('extends motion for a new object without losing previous labels and caps event duration', async () => {
  const { recorder, store } = await fixture();
  const [first, again] = await Promise.all([
    recorder.trigger('camera.test', 'motion', undefined, 1000),
    recorder.trigger('camera.test', 'pet', 'binary_sensor.pet', 2000),
  ]);
  assert.equal(first.id, again.id);
  assert.deepEqual(again.kinds, ['motion', 'pet']);
  await recorder.trigger('camera.test', 'person', undefined, 300000);
  assert.equal((await store.get(first.id))!.endAt, 301000);
  await store.finish(first.id, { status: 'failed' });
  const replacement = await recorder.trigger('camera.test', 'motion', undefined, 300500);
  assert.notEqual(replacement.id, first.id);
  await assert.rejects(async () => await recorder.trigger('camera.unknown'), /recording_disabled/);
});

test(
  'finalizes a real H264 buffer into a seekable local MP4 and thumbnail',
  { timeout: 30000 },
  async () => {
    const { dir, store, recorder } = await fixture();
    const at = Date.UTC(2026, 9, 17, 12);
    const name = '20261017T120000.mp4';
    await runMedia(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x90:rate=10',
        '-t',
        '12',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        join(dir, name),
      ],
      { timeout: 10000 },
    );
    await writeFile(join(dir, 'index.csv'), `${name},0,12\n`);
    await utimes(join(dir, name), new Date(at + 12000), new Date(at + 12000));
    recorder.buffers.set('camera.test', { id: 'camera.test', dir, status: 'stopped', stopped: true });
    const event = await recorder.trigger('camera.test', 'motion', undefined, at + 8000);
    await recorder.finish(event);
    const result = (await store.get(event.id))!;
    assert.equal(result.status, 'ready');
    assert.equal(result.mediaStartAt, at);
    assert.equal(result.detections[0]!.at - result.mediaStartAt!, 8000);
    assert.ok(result.duration >= 11.9);
    assert.ok(result.bytes > 1000);
    assert.equal(
      result.playbackVersion,
      0,
      'packet copies require a separately normalized native playback file',
    );
    assert.ok((await stat(store.path(event.id, 'jpg'))).size > 0);
    const hashes = async (path: string) => {
      const { stdout } = await runMedia('ffmpeg', [
        '-v',
        'error',
        '-i',
        path,
        '-map',
        '0:v:0',
        '-fps_mode',
        'passthrough',
        '-f',
        'framemd5',
        '-',
      ]);
      const frames = stdout
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => line.split(',').at(-1)!.trim());
      return createHash('sha256').update(frames.join('\n')).digest('hex');
    };
    assert.equal(
      await hashes(store.path(event.id)),
      await hashes(join(dir, name)),
      'compatible H264 pictures retain their exact decoded pixels and cadence',
    );
  },
);

test('a missing camera buffer records an honest failure rather than an empty playable clip', async () => {
  const { recorder, store } = await fixture();
  const event = await recorder.trigger('camera.test');
  await recorder.finish(event);
  assert.equal((await store.get(event.id))!.status, 'failed');
  assert.equal((await store.get(event.id))!.videoUrl, undefined);
});

test('non-H264 recording segments retain the compatible H264/AAC conversion', async () => {
  const { dir, store, recorder } = await fixture();
  const at = Date.now() - 2000;
  const name = `b${at}-a1b2c3d4-000000000.mp4`;
  await runMedia('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x90:rate=10:duration=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=500:sample_rate=16000:duration=2',
    '-c:v',
    'mpeg4',
    '-c:a',
    'aac',
    join(dir, name),
  ]);
  await writeFile(join(dir, 'index.csv'), `${name},0,2\n`);
  await utimes(join(dir, name), new Date(at + 2000), new Date(at + 2000));
  recorder.buffers.set('camera.test', { id: 'camera.test', dir, status: 'stopped', stopped: true });
  const event = await recorder.trigger('camera.test', 'motion', undefined, at + 1000);
  await recorder.finish(event);
  assert.equal((await store.get(event.id))!.status, 'ready');
  const { stdout } = await runMedia('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_name,codec_type',
    '-of',
    'json',
    store.path(event.id),
  ]);
  const { streams } = JSON.parse(stdout) as {
    streams: Array<{ codec_type: string; codec_name: string }>;
  };
  assert.equal(streams.find((stream) => stream.codec_type === 'video')!.codec_name, 'h264');
  assert.equal(streams.find((stream) => stream.codec_type === 'audio')!.codec_name, 'aac');
  await runMedia('ffmpeg', ['-v', 'error', '-i', store.path(event.id), '-f', 'null', '-']);
});

for (const placement of ['local', 'nvr'] as const)
  test(
    `delayed ${placement} Activity Assist preserves eight seconds before a hardware detection`,
    { timeout: 30000 },
    async () => {
      const { dir, store, recorder } = await fixture();
      const now = Date.now();
      const detectedAt = now - 29000;
      const mediaAt = detectedAt - 8000;
      const prefix = `b${mediaAt}-a1b2c3d4`;
      const name = `${prefix}-000000000.mp4`;
      await runMedia('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=160x90:r=10',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=400:sample_rate=16000',
        '-t',
        '12',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        join(dir, name),
      ]);
      await utimes(join(dir, name), new Date(mediaAt + 12000), new Date(mediaAt + 12000));
      await writeFile(join(dir, `${prefix}.csv`), `${name},0,12\n`);
      const expired = join(dir, `b${now - 100000}-b1b2c3d4-000000000.mp4`);
      await writeFile(expired, 'expired');
      await utimes(expired, new Date(now - 100000), new Date(now - 100000));
      const camera = recorder.cameras![0]!;
      camera.motionDetection = { enabled: true, mode: 'objects' };
      recorder.buffers.set(camera.id, { id: camera.id, dir, status: 'stopped', stopped: true });
      // A poll/prune occurs before an almost-30-second-old inference result arrives.
      await recorder.tick();
      assert.ok((await stat(join(dir, name))).size);
      await assert.rejects(stat(expired), { code: 'ENOENT' });
      const hardware = await recorder.trigger(
        camera.id,
        'motion',
        'binary_sensor.motion',
        detectedAt + 1000,
      );
      const motion = new Motion({ recorder, now: () => now });
      const job: MotionJob =
        placement === 'local'
          ? { local: true }
          : {
              node: {
                id: 'fixture-node',
                roles: ['analysis'],
                url: 'http://127.0.0.1:8788',
                key: 'fixture-node-key',
              },
            };
      motion.jobs.set(camera.id, job);
      await motion.deliver(camera, { kind: 'person', at: detectedAt }, job);
      const combined = (await store.get(hardware.id))!;
      assert.equal((await store.recording()).length, 1);
      assert.equal(combined.startAt, detectedAt);
      assert.deepEqual(combined.kinds, ['motion', 'person']);
      assert.equal(combined.detections[1]!.at, detectedAt);
      await recorder.finish(combined);
      const ready = (await store.get(hardware.id))!;
      assert.equal(ready.status, 'ready');
      assert.equal(ready.mediaStartAt, mediaAt);
      assert.equal(ready.startAt - ready.mediaStartAt!, 8000);
      assert.ok(ready.duration >= 11.9);
      assert.equal(ready.playbackInfo?.audio, true);
    },
  );

test(
  'restart recovers a pending event from its persisted pre-event ring without blocking new ingest',
  { timeout: 30000 },
  async () => {
    const { recorder, store } = await fixture();
    const dir = recorder.bufferDirectory('camera.test');
    await mkdir(dir, { recursive: true });
    const at = Date.now() - 12000,
      prefix = `b${at}-a1b2c3d4`,
      name = `${prefix}-000000000.mp4`;
    await runMedia('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=160x90:r=10',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=400:sample_rate=16000',
      '-t',
      '12',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      join(dir, name),
    ]);
    await utimes(join(dir, name), new Date(at + 12000), new Date(at + 12000));
    await writeFile(join(dir, `${prefix}.csv`), `${name},0,12\n`);
    const event = await store.create('camera.test', 'motion', at + 8000, at + 12000);
    await recorder.initialize();
    assert.ok(recorder.timer);
    assert.ok(recorder.finalizing.has(event.id));
    for (
      let index = 0;
      index < 100 && (await store.get(event.id))!.status === 'recording';
      index++
    )
      await pause(50);
    const recovered = (await store.get(event.id))!;
    assert.equal(recovered.status, 'ready');
    assert.ok(recovered.duration >= 11.9);
    assert.equal(recovered.startAt - recovered.mediaStartAt!, 8000);
    assert.equal(recovered.playbackInfo?.audio, true);
  },
);

test('a drifting source clock cannot hide pre-event footage from motion recordings', async () => {
  const { dir, recorder } = await fixture();
  const at = Date.now(),
    prefix = `b${at - 3600000}-a1b2c3d4`;
  const name = `${prefix}-000000400.mp4`;
  await writeFile(join(dir, name), 'completed-segment');
  await utimes(join(dir, name), new Date(at), new Date(at));
  // The RTP clock is an hour behind; the packet duration is still correct.
  await writeFile(join(dir, `${prefix}.csv`), `${name},800,802\n`);
  const [part] = await recorder.segments({ dir });
  assert.ok(part);
  assert.ok(Math.abs(part.end - at) < 2);
  assert.equal(part.end - part.start, 2000);
  assert.ok(part.start >= at - 8000);
});

test('held motion extends the tail without inventing detections and rotates at the clip limit', async () => {
  const { recorder, store } = await fixture();
  const now = Date.now();
  recorder.cameras![0]!.sensors = [{ id: 'binary_sensor.motion', kind: 'motion', active: true }];
  const first = await recorder.trigger(
    'camera.test',
    'motion',
    'binary_sensor.motion',
    now - 10000,
  );
  await recorder.tick();
  assert.equal((await store.get(first.id))!.detections.length, 1);
  assert.ok((await store.get(first.id))!.endAt >= now + 19000);
  const old = await store.create(
    'camera.test',
    'motion',
    now - 310000,
    now - 10000,
    'binary_sensor.motion',
  );
  recorder.active.set('camera.test', old);
  await recorder.tick();
  assert.notEqual(recorder.active.get('camera.test')!.id, old.id);
  assert.ok((await store.recording()).some((event) => event.id !== old.id));
});
