/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

import { NativeCameraMedia } from '../../src/stream/native.js';
import { MediaRuntime } from '../../src/pipeline/tools.js';
import { binary, nativeWorker } from '../support/native/worker.js';
import { freeTcpPort, freeUdpPort } from '../support/native/ports.js';
import { sessionFixture, viewerFixture } from '../support/native/session.js';
import { required } from '../support/values.js';

test(
  'a cached long-GOP picture starts the production viewer with audio before the next IDR',
  { skip: !binary, timeout: 20000 },
  async (t) => {
    const source = nativeWorker();
    const video = dgram.createSocket('udp4'),
      audio = dgram.createSocket('udp4');
    let generator: ChildProcess | undefined,
      reader: ChildProcess | undefined,
      decoder: ChildProcess | undefined;
    t.onTestFinished(async () => {
      video.close();
      audio.close();
      for (const child of [decoder, reader, generator, source.child]) {
        if (!child || child.exitCode !== null || child.signalCode !== null) continue;
        const closed = once(child, 'close');
        child.kill('SIGKILL');
        await closed;
      }
    });
    await Promise.all(
      [video, audio].map(
        (socket) => new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve)),
      ),
    );
    await source.waitFor('ready');
    const id = randomUUID(),
      rtspPort = await freeTcpPort(),
      videoPort = await freeUdpPort(),
      audioPort = await freeUdpPort();
    source.send({
      cmd: 'start_relay',
      did: id,
      rtsp_port: rtspPort,
      rtp_port: videoPort,
      audio_rtp_port: audioPort,
      rtsp_path: id,
    });
    await source.waitFor('relay_started');
    generator = new MediaRuntime().spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-re',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=640x360:rate=15',
        '-re',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:sample_rate=16000',
        '-map',
        '0:v:0',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'zerolatency',
        '-pix_fmt',
        'yuv420p',
        '-g',
        '180',
        '-keyint_min',
        '180',
        '-sc_threshold',
        '0',
        '-bsf:v',
        'dump_extra=freq=keyframe',
        '-f',
        'rtp',
        '-payload_type',
        '96',
        `rtp://127.0.0.1:${videoPort}?pkt_size=1200`,
        '-map',
        '1:a:0',
        '-vn',
        '-c:a',
        'aac',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-b:a',
        '32k',
        '-f',
        'rtp',
        '-payload_type',
        '97',
        `rtp://127.0.0.1:${audioPort}?pkt_size=1200`,
      ],
      { stdio: 'ignore' },
    );
    await once(generator, 'spawn');
    await source.waitFor('relay_ready');
    const engine = new NativeCameraMedia('unused', { log: () => {} });
    const session = sessionFixture(id, { rtspPort });
    engine.sessions.set(id, session);
    let firstVideo = false,
      firstAudio = false,
      diagnostic = '';
    video.on('message', () => {
      firstVideo = true;
    });
    audio.on('message', () => {
      firstAudio = true;
    });
    const start = Date.now();
    reader = new MediaRuntime().spawn(
      'ffmpeg',
      engine.viewerArgs(
        session,
        viewerFixture(session, {
          videoPort: video.address().port,
          audioPort: audio.address().port,
        }),
      ),
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    required(reader.stderr).on('data', (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk).slice(-4000);
    });
    while ((!firstVideo || !firstAudio) && reader.exitCode === null && Date.now() - start < 4500)
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.ok(
      firstVideo && firstAudio,
      `Cached picture and sound must start without a fresh camera IDR: ${diagnostic}`,
    );
    assert.equal(reader.exitCode, null, 'The production viewer must remain alive after probing');
    assert.equal(diagnostic, '');

    // Packet arrival alone does not establish a usable first picture. Decode
    // the cached IDR before the source's next twelve-second keyframe as well.
    const inputArgs = engine.viewerArgs(
      session,
      viewerFixture(session, {
        videoPort: video.address().port,
        audioPort: audio.address().port,
      }),
    );
    decoder = new MediaRuntime().spawn(
      'ffmpeg',
      [
        '-threads',
        '1',
        ...inputArgs.slice(0, inputArgs.indexOf('-map')),
        '-map',
        '0:v:0',
        '-an',
        '-frames:v',
        '1',
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let bytes = 0,
      decodeError = '';
    required(decoder.stdout).on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    required(decoder.stderr).on('data', (chunk: Buffer) => {
      decodeError = (decodeError + chunk).slice(-4000);
    });
    const decodeStarted = Date.now();
    while (bytes < 640 * 360 * 3 && decoder.exitCode === null && Date.now() - decodeStarted < 4500)
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.equal(
      bytes,
      640 * 360 * 3,
      `Cached IDR must decode before another source IDR: ${decodeError}`,
    );
    assert.equal(decodeError, '');
  },
);
