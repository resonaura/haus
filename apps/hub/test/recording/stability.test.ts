/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { test } from 'vitest';
import { cameraProcess } from '@haus/media/pipeline';
import { defaults } from '@haus/hub/runtime';
import {
  maintainCaptureBuffers,
  startCaptureBuffer,
  type BufferRuntimeContext,
} from '../../src/events/recorder/buffer.js';
import { cleanStaleRecorderTemps, finalizeRecordedEvent } from '../../src/events/recorder/finalize.js';
import { MediaQueue } from '../../src/events/recorder/queue.js';
import { PrimarySourceRecovery } from '../../src/events/recorder/recovery.js';
import type { RecorderBuffer, RecorderStore } from '../../src/events/recorder/types.js';
import { openTestRecordingStore } from '../support/recording.js';

test('startCaptureBuffer deduplicates concurrent starts and clears pending retry timers', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-hub-buffer-start-'));
  const media = join(root, 'media');
  const dir = join(root, 'buf');
  await mkdir(media);
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));

  let inputCalls = 0;
  let releaseInput!: () => void;
  let notifyStarted!: () => void;
  const inputStarted = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const buffer: RecorderBuffer = {
    id: 'camera.dedup',
    dir,
    status: 'reconnecting',
    stopped: true,
    retry: setTimeout(() => {
      throw new Error('stale retry timer should have been cleared');
    }, 10000),
  };

  const ctx: BufferRuntimeContext = {
    config: { ...defaults, data: root, media },
    ha: {
      recordingInput: async () => {
        inputCalls += 1;
        notifyStarted();
        await new Promise<void>((resolve) => {
          releaseInput = resolve;
        });
        return { url: 'rtsp://127.0.0.1:8554/cam', kind: 'rtsp' };
      },
    },
    store: {} as RecorderStore,
    primaryRecovery: new PrimarySourceRecovery(),
    buffers: new Map([[buffer.id, buffer]]),
    active: new Map(),
    playbackAbort: new AbortController(),
    stopped: false,
    onChange() {},
    terminateBuffer() {},
    startBuffer: async () => {},
  };

  buffer.stopped = false;
  const first = startCaptureBuffer(ctx, buffer);
  const second = startCaptureBuffer(ctx, buffer);
  assert.equal(buffer.retry, undefined);
  assert.equal(first, second);
  await inputStarted;
  buffer.stopped = true;
  releaseInput();
  await Promise.all([first, second]);
  assert.equal(inputCalls, 1);
  assert.equal(buffer.starting, undefined);
});

test('maintainCaptureBuffers ignores unlinked expired files and evicts oldest unpinned segments before storage-limit', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-hub-buffer-cap-'));
  const dir = join(root, 'buf');
  await mkdir(dir, { recursive: true });
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));

  const now = 1_700_000_100_000;
  const expired = join(dir, 'b1700000000000-aaaaaaaa-000000000.mp4');
  const unpinned = join(dir, 'b1700000000000-aaaaaaaa-000000001.mp4');
  const newest = join(dir, 'b1700000000000-aaaaaaaa-000000002.mp4');
  await writeFile(expired, Buffer.alloc(4096));
  await writeFile(unpinned, Buffer.alloc(4096));
  await writeFile(newest, Buffer.alloc(1024));
  await utimes(expired, new Date(now - 90000), new Date(now - 90000));
  await utimes(unpinned, new Date(now - 5000), new Date(now - 5000));
  await utimes(newest, new Date(now - 1000), new Date(now - 1000));

  const proc = new ChildProcess();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  const buffer: RecorderBuffer = {
    id: 'camera.cap',
    dir,
    status: 'buffering',
    stopped: false,
    process: proc,
    lastAdvance: now,
    lastSegmentAt: now,
  };
  let terminated = false;
  const ctx: BufferRuntimeContext = {
    config: {
      ...defaults,
      data: root,
      media: root,
      pre_roll_seconds: 8,
      max_buffer_gb: 2048 / 1024 ** 3,
    },
    ha: {},
    store: {} as RecorderStore,
    primaryRecovery: new PrimarySourceRecovery(),
    buffers: new Map([[buffer.id, buffer]]),
    active: new Map(),
    playbackAbort: new AbortController(),
    stopped: false,
    onChange() {},
    terminateBuffer() {
      terminated = true;
    },
    startBuffer: async () => {},
  };

  await maintainCaptureBuffers(ctx, [], now);
  assert.equal(terminated, false);
  assert.equal(buffer.status, 'buffering');
  assert.equal(await stat(expired).catch(() => null), null);
  assert.equal(await stat(unpinned).catch(() => null), null);
  assert.ok(await stat(newest));
});

test('finalizeRecordedEvent salvages corrupt tail and cleanStaleRecorderTemps removes temp files', { timeout: 20000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-hub-finalize-'));
  const data = join(root, 'data');
  const media = join(root, 'media');
  const dir = join(root, 'buf');
  await mkdir(data);
  await mkdir(media);
  await mkdir(dir);
  const store = await openTestRecordingStore(join(data, 'db.sqlite'), media);
  t.onTestFinished(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });

  await writeFile(join(data, 'stale.concat'), 'stale');
  await writeFile(join(media, `${randomUUID()}.partial.mp4`), 'stale');
  await cleanStaleRecorderTemps(data, media);
  assert.equal(await stat(join(data, 'stale.concat')).catch(() => null), null);

  const validPath = join(dir, 'b1700000000000-aaaaaaaa-000000000.mp4');
  const emptyPath = join(dir, 'b1700000000000-aaaaaaaa-000000001.mp4');
  const corruptPath = join(dir, 'b1700000000000-aaaaaaaa-000000002.mp4');
  await cameraProcess('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x90:rate=15',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=16000',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    validPath,
  ]);
  await writeFile(emptyPath, Buffer.alloc(0));
  await writeFile(corruptPath, Buffer.from('corrupt-mp4-fragment'));

  const startAt = 1_700_000_000_000;
  const event = await store.create('camera.salvage', 'motion', startAt, startAt + 2000);
  await finalizeRecordedEvent(
    {
      config: { ...defaults, data, media, record_audio: true, max_event_seconds: 60 },
      store,
      buffers: new Map([[event.cameraId, { id: event.cameraId, dir, status: 'buffering', stopped: false }]]),
      cameras: [{ id: event.cameraId, enabled: true, available: true }],
      encoding: new MediaQueue(),
      playbackAbort: new AbortController(),
      stopped: false,
      onChange() {},
      segments: async () => [
        { path: validPath, start: startAt, end: startAt + 1000 },
        { path: emptyPath, start: startAt + 1000, end: startAt + 1500 },
        { path: corruptPath, start: startAt + 1500, end: startAt + 2000 },
      ],
      preparePlayback: async () => '',
    },
    event,
  );

  const saved = await store.get(event.id);
  assert.ok(saved);
  assert.equal(saved.status, 'ready');
  assert.ok(saved.bytes > 0);
  assert.ok(await stat(store.path(event.id)));
});
