/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { test } from 'vitest';
import { spawnRecordingCapture } from '../../src/recording/capture.js';
import { finalizeRecording, type CameraRecordingJob } from '../../src/recording/recording.js';
import { pruneRingStorage } from '../../src/recording/ring-files.js';
import { CameraRing } from '../../src/recording/ring.js';
import { cameraMetadata, cameraProcess } from '../../src/pipeline/process.js';
import { MediaRuntime } from '../../src/pipeline/tools.js';
import { ProcessFixture, cleanup, spawnFixture } from '../support/process.js';

test('CameraRing restarts stalled FFmpeg reader via watchdog without failing ring', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-ring-stall-'));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));

  const spawned: ProcessFixture[] = [];
  const runtime = new MediaRuntime({
    spawnProcess: spawnFixture(() => {
      const child = new ProcessFixture();
      spawned.push(child);
      return child;
    }),
  });
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const ring = new CameraRing(root, 'rtsp://127.0.0.1:8554/camera', {
    runtime,
    readerStallMs: 25,
    log: (event, fields) => logs.push({ event, fields }),
  });
  t.onTestFinished(() => cleanup(() => ring.stop()));

  await ring.start();
  assert.equal(spawned.length, 1);

  const deadline = Date.now() + 2000;
  while (spawned.length < 2 && Date.now() < deadline) {
    await pause(15);
  }
  assert.ok(spawned.length >= 2, 'stalled reader must trigger restart');
  assert.equal(
    logs.some((entry) => entry.event === 'camera_ring_reader_stalled'),
    true,
  );
  assert.equal(ring.failed, false);
});

test('pruneRingStorage evicts old unpinned segments and orphans before maxBytes cap', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-ring-prune-'));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));

  const base = 1_700_000_000_000;
  for (const name of [
    '000000001.ts',
    '000000002.ts',
    '000000003.ts',
    '000000004.ts',
    '000000099.ts',
  ]) {
    await writeFile(join(root, name), Buffer.alloc(1024, 1));
    await utimes(join(root, name), new Date(base - 30000), new Date(base - 30000));
  }
  await writeFile(join(root, 'segments-000.csv'), 'old\n');
  await utimes(join(root, 'segments-000.csv'), new Date(base - 30000), new Date(base - 30000));

  const job: CameraRecordingJob = {
    id: 'job-1',
    root: join(root, 'job-1'),
    startAt: base - 4000,
    endAt: base - 2000,
    state: 'recording',
    parts: new Map(),
    createdAt: base - 4000,
    bytes: 0,
    maxBytes: 10 * 1024 * 1024,
    capacity: 0,
    reservations: [],
  };

  const rows = [
    {
      name: '000000001.ts',
      from: 0,
      to: 2,
      run: 'segments-001.csv',
      startAt: base - 25000,
      endAt: base - 23000,
    },
    {
      name: '000000002.ts',
      from: 2,
      to: 4,
      run: 'segments-001.csv',
      startAt: base - 15000,
      endAt: base - 13000,
    },
    {
      name: '000000003.ts',
      from: 4,
      to: 6,
      run: 'segments-001.csv',
      startAt: base - 4000,
      endAt: base - 2000,
    },
    {
      name: '000000004.ts',
      from: 6,
      to: 8,
      run: 'segments-001.csv',
      startAt: base - 1000,
      endAt: base,
    },
  ];

  const { retained, ringBytes } = await pruneRingStorage({
    root,
    entries: [
      '000000001.ts',
      '000000002.ts',
      '000000003.ts',
      '000000004.ts',
      '000000099.ts',
      'segments-000.csv',
    ],
    rows,
    jobs: [job],
    retentionSeconds: 60,
    maxBytes: 2560,
    now: base,
    latestName: '000000004.ts',
  });

  assert.deepEqual(
    retained.map((part) => part.name),
    ['000000003.ts', '000000004.ts'],
  );
  assert.equal(ringBytes, 2048);
  assert.equal(await stat(join(root, '000000001.ts')).catch(() => null), null);
  assert.equal(await stat(join(root, '000000099.ts')).catch(() => null), null);
  assert.equal(await stat(join(root, 'segments-000.csv')).catch(() => null), null);
});

test(
  'finalizeRecording salvages healthy segments when a trailing segment is corrupt',
  { timeout: 20000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'haus-finalize-salvage-'));
    const jobDir = join(root, 'job');
    await mkdir(jobDir);
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));

    for (const [index, name] of ['000000001.ts', '000000002.ts'].entries()) {
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
        '-output_ts_offset',
        String(index),
        join(jobDir, name),
      ]);
    }
    await writeFile(join(jobDir, '000000003.ts'), Buffer.from('corrupt-tail-bytes'));

    const startAt = 1_700_000_000_000;
    const job: CameraRecordingJob = {
      id: 'salvage-1',
      root: jobDir,
      startAt,
      endAt: startAt + 2000,
      state: 'recording',
      parts: new Map([
        [
          '000000001.ts',
          {
            name: '000000001.ts',
            from: 0,
            to: 1,
            run: 'segments.csv',
            startAt,
            endAt: startAt + 1000,
          },
        ],
        [
          '000000002.ts',
          {
            name: '000000002.ts',
            from: 1,
            to: 2,
            run: 'segments.csv',
            startAt: startAt + 1000,
            endAt: startAt + 2000,
          },
        ],
        [
          '000000003.ts',
          {
            name: '000000003.ts',
            from: 2,
            to: 2.5,
            run: 'segments.csv',
            startAt: startAt + 2000,
            endAt: startAt + 2500,
          },
        ],
      ]),
      createdAt: startAt,
      bytes: 1024,
      maxBytes: 10 * 1024 * 1024,
      capacity: 10 * 1024 * 1024,
      reservations: [],
    };

    let readyCalls = 0;
    await finalizeRecording(job, {
      abort: new AbortController(),
      requireAudio: true,
      recordAudio: true,
      run: (file, args, opts) => cameraProcess(file, args, opts),
      probe: (file, opts) => cameraMetadata(file, opts),
      now: () => startAt + 3000,
      onRecordingReady: async () => {
        readyCalls += 1;
      },
      onRecordingFailed: (failedJob, err) => {
        throw new Error(`unexpected failure for ${failedJob.id}: ${String(err)}`);
      },
      log: () => {},
    });

    assert.equal(job.state, 'ready');
    assert.equal(readyCalls, 1);
    assert.ok(job.result);
    assert.ok(job.result.bytes > 0);
    assert.ok(job.result.duration >= 1.5);
  },
);

test('spawnRecordingCapture tolerates optional audio and discards corrupt input packets', () => {
  let capturedArgs: string[] = [];
  const runtime = new MediaRuntime({
    spawnProcess: spawnFixture((_file, args) => {
      capturedArgs = [...args];
      return new ProcessFixture();
    }),
  });

  spawnRecordingCapture({
    source: 'rtsp://127.0.0.1:8554/cam',
    recordAudio: true,
    expectedAudio: false,
    segmentList: '/tmp/seg.csv',
    segmentPattern: '/tmp/seg-%09d.mp4',
    runtime,
  });

  const fflagsIndex = capturedArgs.indexOf('-fflags');
  assert.ok(fflagsIndex >= 0);
  assert.equal(capturedArgs[fflagsIndex + 1], '+discardcorrupt');
  assert.ok(capturedArgs.includes('0:a?'));
});
