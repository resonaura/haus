/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { runMedia, type RecorderBuffer } from '../../../src/events/index.js';
import { lifecycleFixture } from './fixture.js';
const fixture = lifecycleFixture();

it('restart recovers a pending event from its persisted pre-event ring without blocking new ingest', async () => {
  const { recorder, store } = await fixture({ localCapture: true });
  recorder.config.record_audio = true;
  const dir = recorder.bufferDirectory('camera.test');
  await mkdir(dir, { recursive: true });
  const at = Date.now() - 12000;
  const prefix = `b${at}-a1b2c3d4`;
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
  expect(recorder.timer).toBeDefined();
  expect(recorder.finalizing.has(event.id)).toBe(true);
  await vi.waitFor(
    async () => {
      expect((await store.get(event.id))?.status).toBe('ready');
    },
    { timeout: 15000, interval: 50 },
  );
  const recovered = await store.get(event.id);
  if (!recovered) throw Error('missing recovered event');
  expect(recovered.duration).toBeGreaterThanOrEqual(11.9);
  expect(recovered.startAt - (recovered.mediaStartAt ?? Infinity)).toBe(8000);
  expect(recovered.playbackInfo?.audio).toBe(true);
}, 20000);

it('shutdown reaps a real FFmpeg capture and prevents reconnect after advancing media', async () => {
  const { recorder, root } = await fixture({ localCapture: true });
  const source = join(root, 'source.mp4');
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
  recorder.ha.recordingInput = async () => ({ url: source, kind: 'rtsp', inputArguments: ['-re'] });
  const buffer: RecorderBuffer = {
    id: 'camera.test',
    dir: recorder.bufferDirectory('camera.test'),
    status: 'starting',
    stopped: false,
  };
  recorder.buffers.set(buffer.id, buffer);
  await recorder.startBuffer(buffer);
  const child = buffer.process;
  if (!child) throw Error('missing capture process');
  const closed = once(child, 'close');
  await vi.waitFor(
    async () => {
      expect(buffer.status).toBe('buffering');
      expect((await recorder.segments(buffer)).length).toBeGreaterThan(0);
    },
    { timeout: 15000, interval: 50 },
  );
  await Promise.all([recorder.stop(), recorder.stop()]);
  await closed;
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  expect(buffer.process).toBeUndefined();
  expect(buffer.killTimer).toBeUndefined();
  expect(buffer.retry).toBeUndefined();
  expect(buffer.stopped).toBe(true);
}, 20000);
