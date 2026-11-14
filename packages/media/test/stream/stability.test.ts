/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { test } from 'vitest';
import { HlsStreams } from '../../src/stream/hls.js';
import { NativeCameraMedia } from '../../src/stream/native.js';
import type { NativeCameraSession } from '../../src/stream/native-types.js';
import { MediaRuntime } from '../../src/pipeline/tools.js';
import { ProcessFixture, cleanup, spawnFixture } from '../support/process.js';
import { binary } from '../support/native/worker.js';

function sessionFixture(id: string, startedAt: number): NativeCameraSession {
  return {
    id,
    cameraId: 'camera.test',
    sourceKind: 'rtsp',
    source: 'rtsp://user:secret@192.168.1.50/live',
    startedAt,
    rtspPort: 18554,
    videoPort: 18556,
    audioPort: 18558,
    viewers: new Set(),
    stopped: false,
    restarts: 0,
    mediaReadyAt: 0,
    readyPromise: Promise.resolve(),
  };
}

test('HlsStreams prunes stopped/failed slots before stream_busy, redacts errors, and rejects early on stopped serve', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-hls-stability-'));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));

  const spawned: ProcessFixture[] = [];
  const streams = new HlsStreams(root, 'http://127.0.0.1:8123', {
    max: 1,
    spawnProcess: spawnFixture((_file, args) => {
      const child = new ProcessFixture();
      spawned.push(child);
      const playlist = args.at(-1);
      if (playlist?.endsWith('.m3u8')) {
        void writeFile(playlist, '#EXTM3U\n').catch(() => {});
      }
      return child;
    }),
  });
  t.onTestFinished(() => cleanup(() => streams.stop()));
  await streams.initialize();

  const tokenHex = 'a'.repeat(48);
  const first = await streams.start(`http://127.0.0.1:8123/cluster/source/${tokenHex}/cam1.m3u8`);
  spawned[0]!.stderr.write('Failed to open rtsp://admin:pw@10.0.0.4/stream from 10.0.0.4');
  spawned[0]!.exitCode = 1;
  spawned[0]!.emit('error', new Error('ffmpeg_failed'));
  const firstJob = streams.jobs.get(first.id)!;
  assert.equal(firstJob.state, 'failed');
  assert.ok(firstJob.lastError?.includes('[redacted RTSP URL]'));
  assert.equal(firstJob.lastError?.includes('pw@10.0.0.4'), false);

  let served = true;
  const server = createServer(async (_req, res) => {
    served = await streams.serve(first.id, 'index.m3u8', res);
    if (!served) res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const startedAt = Date.now();
  const reply = await fetch(`http://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  assert.equal(reply.status, 404);
  assert.equal(served, false);
  assert.ok(Date.now() - startedAt < 1000, 'stopped/failed index.m3u8 must fail immediately');

  const second = await streams.start(`http://127.0.0.1:8123/cluster/source/${tokenHex}/cam2.m3u8`);
  assert.notEqual(second.id, first.id);
  assert.equal(streams.jobs.has(first.id), false);
});

test('NativeCameraMedia checkProducers recovers hung startup and rtp_idle FFmpeg producers', () => {
  let at = 1_000_000;
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const engine = new NativeCameraMedia('/unused', {
    now: () => at,
    startupStallMs: 10000,
    idleStallMs: 12000,
    log: (event, fields) => logs.push({ event, fields }),
  });

  const startupId = randomUUID();
  const startupProc = new ProcessFixture();
  const startupSession = sessionFixture(startupId, at);
  startupSession.producer = startupProc;
  startupSession.producerStartedAt = at;
  engine.sessions.set(startupId, startupSession);

  at += 10001;
  engine.checkProducers();
  assert.equal(startupProc.exitCode, 0);
  assert.equal(
    logs.some(
      (entry) =>
        entry.event === 'source_reader_stalled' && entry.fields.reason === 'startup_timeout',
    ),
    true,
  );

  const idleId = randomUUID();
  const idleProc = new ProcessFixture();
  const idleSession = sessionFixture(idleId, at);
  idleSession.producer = idleProc;
  idleSession.producerStartedAt = at;
  engine.sessions.set(idleId, idleSession);
  engine.onEvent({ event: 'relay_ready', did: idleId });
  assert.equal(idleSession.mediaReadyAt, at);

  at += 5000;
  engine.onEvent({ event: 'rtp_stats', did: idleId, stage: 'source', media: 'video', packets: 25 });
  assert.equal(idleSession.lastSourceRtpAt, at);

  at += 12000;
  engine.checkProducers();
  assert.equal(idleProc.exitCode, 0);
  assert.equal(idleSession.mediaReadyAt, 0);
  assert.equal(
    logs.some(
      (entry) => entry.event === 'source_reader_stalled' && entry.fields.reason === 'rtp_idle',
    ),
    true,
  );
});

test(
  'NativeCameraMedia clears lineBuffer and session producers on daemon crash and recovers cleanly',
  { skip: !binary, timeout: 15000 },
  async (t) => {
    const children: ChildProcess[] = [];
    const spySpawn = spawnFixture((file, args, opts) => {
      const child = spawn(file, args, opts ?? {});
      children.push(child);
      return child;
    });
    const engine = new NativeCameraMedia('/unused', {
      runtime: new MediaRuntime({ tools: { camera: binary! }, spawnProcess: spySpawn }),
    });
    t.onTestFinished(() => cleanup(() => engine.stop()));

    await engine.initialize('192.168.1.50');
    engine.lineBuffer = '{"incomplete":';

    const leakedProducer = new ProcessFixture();
    const sid = randomUUID();
    const session = sessionFixture(sid, Date.now());
    session.producer = leakedProducer;
    engine.sessions.set(sid, session);

    const closed = new Promise<void>((resolve) => children[0]!.once('close', () => resolve()));
    children[0]!.kill('SIGKILL');
    await closed;

    assert.equal(engine.failed, true);
    assert.equal(engine.lineBuffer, '');
    assert.equal(engine.sessions.size, 0);
    assert.equal(leakedProducer.exitCode, 0);

    await engine.initialize('192.168.1.50');
    assert.equal(engine.failed, false);
    assert.equal(children.length, 2);
  },
);

test('NativeCameraMedia fail clears waiters even on malformed oversized lineBuffer', () => {
  const engine = new NativeCameraMedia('/unused');
  const producer = new ProcessFixture();
  const id = randomUUID();
  const session = sessionFixture(id, Date.now());
  session.producer = producer;
  engine.sessions.set(id, session);
  engine.onData('x'.repeat(256 * 1024 + 1));
  assert.equal(engine.failed, true);
  assert.equal(engine.lineBuffer, '');
  assert.equal(engine.sessions.size, 0);
  assert.equal(producer.exitCode, 0);
});
