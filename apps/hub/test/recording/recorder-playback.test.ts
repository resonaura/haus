/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { listen, port, closeServer } from '../support/http.js';
import { test, onTestFinished } from 'vitest';
import { ChildProcess } from 'node:child_process';
import { mkdir, stat, readFile, copyFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createRtspServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { join } from 'node:path';
import { parseSegments, runMedia, type RecorderBuffer } from '@haus/hub/events';
import { fixture } from './recorder-fixture.js';

test(
  'starts an authenticated HLS camera and writes playable pre-roll segments',
  { timeout: 30000 },
  async () => {
    const { root, dir, recorder, config } = await fixture();
    const source = join(root, 'source');
    await mkdir(source);
    await runMedia('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=160x90:r=10',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=600:sample_rate=16000',
      '-c:a',
      'aac',
      '-t',
      '5',
      '-c:v',
      'libx264',
      '-g',
      '10',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'hls',
      '-hls_time',
      '1',
      '-hls_list_size',
      '0',
      join(source, 'index.m3u8'),
    ]);
    let authorized = 0;
    const server = createServer(async (req, res) => {
      if (req.headers.authorization !== 'Bearer test-only') {
        res.writeHead(401).end();
        return;
      }
      authorized++;
      const name = req.url?.slice(1) ?? '';
      if (!/^(index.m3u8|index\d+.ts)$/.test(name)) {
        res.writeHead(404).end();
        return;
      }
      try {
        res.end(await readFile(join(source, name)));
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    onTestFinished(() => closeServer(server));
    config.token = 'test-only';
    recorder.ha = {
      stream: async () => `http://127.0.0.1:${port(server)}/index.m3u8`,
    };
    const buffer: RecorderBuffer = { id: 'camera.test', dir, status: 'starting', stopped: false };
    recorder.buffers.set(buffer.id, buffer);
    await recorder.startBuffer(buffer);
    assert.notEqual(buffer.status, 'unavailable', buffer.lastError ?? '');
    for (let attempt = 0; attempt < 100 && !(await recorder.segments(buffer)).length; attempt++)
      await pause(50);
    if (buffer.process) await once(buffer.process, 'close');
    const segments = await recorder.segments(buffer);
    assert.equal(buffer.expectedAudio, true);
    const soundtrack = await runMedia('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name',
      '-of',
      'json',
      segments[0]!.path,
    ]);
    assert.equal(
      (JSON.parse(soundtrack.stdout) as { streams: Array<{ codec_name: string }> }).streams[0]!
        .codec_name,
      'aac',
    );
    assert.equal(
      new Set(segments.map((part) => part.path)).size,
      segments.length,
      'HLS batches never overwrite another pre-roll segment',
    );
    assert.ok(segments.reduce((sum, part) => sum + part.end - part.start, 0) >= 4900);
    assert.ok(authorized > 1, 'both playlist and segments carry authentication');
    assert.ok(segments.length > 0, 'camera produces finalized pre-roll segments');
    assert.ok((await stat(segments.at(-1)!.path)).size > 0);
  },
);

test('batched segments have unique sequence identities and duplicate paths are never replayed', () => {
  const prefix = 'b1792298711085-a1b2c3d4';
  const parts = parseSegments(
    `${prefix}-000000000.mp4,0,2\n${prefix}-000000001.mp4,2,4\n${prefix}-000000002.mp4,4,6\n${prefix}-000000002.mp4,4,6`,
    '/buffer',
  );
  assert.equal(parts.length, 3);
  assert.equal(new Set(parts.map((part) => part.path)).size, 3);
  assert.equal(parts[0]!.end, parts[1]!.start);
  assert.equal(parts[2]!.end - parts[0]!.start, 6000);
  assert.equal(
    parseSegments('20261017T120000.mp4,0,2\n20261017T120000.mp4,2,4', '/buffer').length,
    1,
  );
});

test(
  'direct recording preserves AAC and repeated direct failures select the HA fallback',
  { timeout: 30000 },
  async () => {
    const { root, dir, recorder } = await fixture();
    const source = join(root, 'direct.mp4');
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
      'sine=frequency=440:sample_rate=16000',
      '-t',
      '4',
      '-c:v',
      'libx264',
      '-g',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      source,
    ]);
    const choices: boolean[] = [];
    recorder.ha = {
      recordingInput: async (camera, allowDirect) => {
        assert.equal(camera.id, 'camera.test');
        choices.push(allowDirect);
        return {
          url: source,
          kind: allowDirect ? 'rtsp' : 'ha',
          inputArguments: [],
        };
      },
      stream: () => {
        throw new Error('HLS should not be requested for a direct source');
      },
    };
    const buffer: RecorderBuffer = { id: 'camera.test', dir, status: 'starting', stopped: false };
    recorder.buffers.set(buffer.id, buffer);
    await recorder.startBuffer(buffer);
    buffer.stopped = true;
    if (buffer.process) await once(buffer.process, 'close');
    assert.equal(buffer.expectedAudio, true);
    assert.equal(buffer.inputKind, 'rtsp');
    const parts = await recorder.segments(buffer);
    assert.ok(parts.length > 0);
    const info = await runMedia('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-count_packets',
      '-show_entries',
      'stream=nb_read_packets',
      '-of',
      'json',
      parts[0]!.path,
    ]);
    assert.ok(
      Number(
        (JSON.parse(info.stdout) as { streams: Array<{ nb_read_packets?: string }> }).streams[0]
          ?.nb_read_packets,
      ) > 0,
    );
    buffer.stopped = false;
    buffer.directFailures = 3;
    buffer.directAttempt = Date.now();
    await recorder.startBuffer(buffer);
    buffer.stopped = true;
    if (buffer.process) await once(buffer.process, 'close');
    assert.deepEqual(choices, [true, false]);
    assert.equal(buffer.inputKind, 'ha');
  },
);

test(
  'both direct discovery and recorder reach an RTSP peer with Linux-compatible options',
  { timeout: 15000 },
  async () => {
    const { dir, recorder } = await fixture();
    const requests: string[] = [];
    const server = createRtspServer((socket) => {
      socket.once('data', (bytes) => {
        requests.push(bytes.toString());
        const cseq = /CSeq:\s*(\d+)/i.exec(bytes.toString())?.[1] ?? '1';
        socket.end(
          `RTSP/1.0 503 Service Unavailable\r\nCSeq: ${cseq}\r\nContent-Length: 0\r\n\r\n`,
        );
      });
      socket.on('error', () => {});
    });
    await listen(server);
    onTestFinished(() => closeServer(server));
    recorder.ha = {
      recordingInput: async () => ({
        url: `rtsp://127.0.0.1:${port(server)}/live`,
        kind: 'rtsp',
        inputArguments: ['-rtsp_transport', 'tcp'],
      }),
    };
    const buffer: RecorderBuffer = { id: 'camera.test', dir, status: 'starting', stopped: false };
    recorder.buffers.set(buffer.id, buffer);
    await recorder.startBuffer(buffer);
    buffer.stopped = true;
    if (buffer.process) await once(buffer.process, 'close');
    assert.ok(
      requests.length >= 2,
      'ffprobe and ffmpeg both negotiate RTSP instead of rejecting input options',
    );
    assert.ok(
      requests.every((request) => !request.includes('Bearer')),
      'HA token never enters the RTSP negotiation',
    );
  },
);

test(
  'prepares one hardware-compatible legacy copy and preserves the original',
  { timeout: 30000 },
  async () => {
    const { store, recorder } = await fixture();
    const event = await store.create('camera.test', 'manual', Date.now(), Date.now() + 2000);
    await runMedia('ffmpeg', [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=160x90:r=10',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      store.path(event.id),
    ]);
    const before = await readFile(store.path(event.id));
    // Version 3 also marked unnormalized 0.3.9 H264 packet copies as native
    // compatible. Do not trust that marker or overwrite the retained original.
    await store.finish(event.id, {
      duration: 2,
      bytes: before.length,
      playbackVersion: 3,
    });
    const legacy = (await store.get(event.id))!;
    let remoteCalls = 0;
    recorder.prepareRemote = async () => {
      remoteCalls++;
      throw new Error('node_unavailable');
    };
    const paths = await Promise.all([
      recorder.preparePlayback(legacy),
      recorder.preparePlayback(legacy),
    ]);
    assert.equal(paths[0], paths[1]);
    assert.equal(remoteCalls, 1);
    assert.notEqual(paths[0], store.path(event.id));
    assert.deepEqual(await readFile(store.path(event.id)), before);
    assert.ok((await store.get(event.id))!.playbackBytes > 0);
    assert.equal((await store.totals()).bytes, before.length + (await stat(paths[0])).size);
    assert.equal(await recorder.preparePlayback((await store.get(event.id))!), paths[0]);
    await runMedia('ffmpeg', ['-v', 'error', '-xerror', '-i', paths[0], '-f', 'null', '-']);
    await store.prune({ retention_days: 7, max_storage_gb: 0 }, Date.now() + 8 * 86400000);
    assert.equal(await store.get(event.id), null);
    await assert.rejects(stat(paths[0]), { code: 'ENOENT' });
  },
);

test(
  'a stalled recorder is terminated, then forcibly reaped if it ignores shutdown',
  { timeout: 8000 },
  async () => {
    const { recorder, dir } = await fixture();
    const child = new ChildProcess();
    const signals: Array<NodeJS.Signals | number | undefined> = [];
    let code: number | null = null;
    Object.defineProperty(child, 'exitCode', { get: () => code });
    child.kill = (signal) => {
      signals.push(signal);
      if (signal === 'SIGKILL') {
        code = 137;
        child.emit('close');
      }
      return true;
    };
    recorder.buffers.set('camera.test', {
      id: 'camera.test',
      dir,
      stopped: false,
      process: child,
      lastAdvance: Date.now() - 31000,
      status: 'buffering',
    });
    await recorder.tick();
    assert.deepEqual(signals, ['SIGTERM']);
    await pause(3100);
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  },
);

test('a successful optional worker copy becomes authoritative playback without starting a local encoder', async () => {
  const { store, recorder } = await fixture();
  const event = await store.create('camera.test', 'manual', 1000, 3000);
  await runMedia('ffmpeg', [
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=160x90:r=20',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=16000',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-threads',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    store.path(event.id),
  ]);
  const original = await readFile(store.path(event.id));
  await store.finish(event.id, {
    duration: 2,
    bytes: original.length,
    playbackVersion: 0,
  });
  let calls = 0;
  recorder.prepareRemote = async () => false;
  recorder.encoding.run = async () => {
    throw new Error('Local encoder must remain idle');
  };
  await assert.rejects(
    recorder.preparePlayback((await store.get(event.id))!, -10, { remoteOnly: true }),
    /background_worker_unavailable/,
  );
  assert.deepEqual(await readFile(store.path(event.id)), original);
  recorder.prepareRemote = async (selected, options) => {
    calls++;
    assert.equal(selected.id, event.id);
    assert.equal(options.signal.aborted, false);
    assert.equal(recorder.processingStatus().remote, 1);
    assert.equal(recorder.processingStatus().activeKind, 'nvr-playback');
    await copyFile(store.path(event.id), options.output);
    return true;
  };
  recorder.encoding.run = async () => {
    throw new Error('Local encoder must remain idle');
  };
  await recorder.preparePlayback((await store.get(event.id))!, -10, {
    remoteOnly: true,
  });
  assert.equal(calls, 1);
  assert.equal(recorder.processingStatus().remote, 0);
  assert.equal((await store.get(event.id))!.playbackVersion, 4);
  assert.equal((await store.get(event.id))!.playbackInfo?.audio, true);
  assert.deepEqual(await readFile(store.path(event.id)), original);
});

test('a reached storage budget pauses new events and lets an in-flight event finish', async () => {
  const { recorder, store, config } = await fixture();
  config.max_storage_gb = 1;
  const current = await recorder.trigger('camera.test', 'motion');
  const previous = await store.create(
    'camera.other',
    'motion',
    Date.now() - 10000,
    Date.now() - 9000,
  );
  await store.finish(previous.id, { bytes: 2 * 1024 ** 3, duration: 1 });
  assert.equal((await recorder.trigger('camera.test', 'pet')).id, current.id);
  recorder.active.clear();
  await assert.rejects(
    async () => await recorder.trigger('camera.test'),
    /recording_storage_limit/,
  );
  assert.equal((await store.get(previous.id))!.bytes, 2 * 1024 ** 3);
  config.max_storage_gb = 0;
  assert.ok((await recorder.trigger('camera.test')).id);
});

test('verified originals bypass encoders and an explicit compatibility repair still preserves the source', async () => {
  const { recorder, store } = await fixture();
  const event = await store.create('camera.test', 'motion', Date.now() - 2000, Date.now());
  const originalPath = store.path(event.id);
  await runMedia('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x90:rate=20',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '20',
    '-bf',
    '0',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    originalPath,
  ]);
  const before = await readFile(originalPath);
  await store.finish(event.id, { bytes: before.length, duration: 2 });
  await store.setPlayback(event.id, 0, 0, {
    originalProvenance: { kind: 'haus-encoder', profile: 1 },
  });
  let remoteCalls = 0;
  recorder.prepareRemote = async () => {
    remoteCalls++;
    return false;
  };
  assert.equal(await recorder.preparePlayback((await store.get(event.id))!), originalPath);
  assert.equal(remoteCalls, 0);
  assert.equal((await store.get(event.id))!.playbackVersion, 4);
  assert.equal((await store.get(event.id))!.playbackBytes, 0);
  assert.equal((await store.get(event.id))!.playbackInfo?.originalCompatible, true);
  const repairing = recorder.preparePlayback((await store.get(event.id))!, 20, {
    forceCompatibility: true,
  });
  const [repaired, joined] = await Promise.all([
    repairing,
    recorder.preparePlayback((await store.get(event.id))!),
  ]);
  assert.equal(joined, repaired);
  assert.notEqual(repaired, originalPath);
  assert.equal(remoteCalls, 1);
  assert.ok((await store.get(event.id))!.playbackBytes > 0);
  assert.equal((await store.get(event.id))!.playbackInfo?.originalCompatible, false);
  assert.deepEqual(await readFile(originalPath), before);
});
