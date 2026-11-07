/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { HomeKitFragments } from '../dist/fragments.js';
import { HomeKitMedia } from '../dist/media.js';
import { probeMedia, runMediaProcess } from '@haus/media/pipeline';

const box = (type, data = Buffer.alloc(0)) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + data.length);
  header.write(type, 4);
  return Buffer.concat([header, data]);
};
test('HKSV parsing retains complete initialization and fragments across arbitrary pipe boundaries', () => {
  const packets = [],
    parser = new HomeKitFragments((bytes, initialization) =>
      packets.push({ bytes, initialization }),
    );
  const init = Buffer.concat([box('ftyp'), box('moov', Buffer.from('metadata'))]);
  const fragment = Buffer.concat([box('moof'), box('mdat', Buffer.alloc(127, 5))]);
  const bytes = Buffer.concat([init, fragment]);
  for (let index = 0; index < bytes.length; index += 7)
    parser.push(bytes.subarray(index, index + 7));
  assert.deepEqual(packets, [
    { bytes: init, initialization: true },
    { bytes: fragment, initialization: false },
  ]);
  assert.throws(
    () => new HomeKitFragments(() => {}).push(Buffer.alloc(8)),
    /invalid_homekit_fragment/,
  );
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'haus-homekit-'));
  const file = join(root, 'source.mp4');
  await runMediaProcess('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=15',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=500:sample_rate=16000',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-threads',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '15',
    '-c:a',
    'aac',
    '-y',
    file,
  ]);
  const diagnostics = [];
  const context = {
    owner: 'fixture-homekit-owner-12345',
    cameraId: 'camera.fixture',
    sessionId: randomUUID(),
    address: '127.0.0.1',
  };
  const media = new HomeKitMedia({
    input: async (value) => {
      assert.equal(value.cameraId, context.cameraId);
      return file;
    },
    inputProfile: { realtime: true, loop: true },
    rtpPortRange: [0, 0],
    maxEncoders: 3,
    spawnProcess: (command, args, options) => {
      const child = spawn(command, args, {
        ...options,
        stdio: [options.stdio[0], options.stdio[1], 'pipe'],
      });
      child.stderr.on('data', (bytes) => {
        diagnostics.push(String(bytes));
        if (diagnostics.length > 10) diagnostics.shift();
      });
      return child;
    },
  });
  t.after(async () => {
    await media.stop();
    await rm(root, { recursive: true, force: true });
  });
  return { root, media, context, diagnostics };
}
const configuration = {
  video: { width: 640, height: 360, fps: 15, bitrate: 500, profile: 1, level: 0 },
  fragmentLength: 1000,
  prebufferLength: 4000,
  audio: true,
  audioRate: 16000,
  audioBitrate: 32,
};
async function waitFor(predicate, timeout = 12000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (predicate()) return;
    await delay(50);
  }
  throw Error('Fixture did not become ready');
}

test(
  'real HKSV encoder supplies pre-event fMP4 with AAC, rejects stale privacy updates and removes audio when disabled',
  { timeout: 30000 },
  async (t) => {
    const { root, media, context, diagnostics } = await fixture(t);
    await media.command({ ...context, action: 'configure', configuration, generation: 1 });
    try {
      await waitFor(() => media.recorders.get(context.owner)?.fragments.length >= 5);
    } catch (error) {
      t.diagnostic(diagnostics.join('\n'));
      throw error;
    }
    const reader = await media.command({ ...context, action: 'open' });
    const parts = [Buffer.from(reader.data, 'base64')];
    let cursor = reader.cursor;
    for (let n = 0; n < 4; n++) {
      const part = await media.command({
        ...context,
        action: 'next',
        readerId: reader.readerId,
        cursor,
      });
      assert.ok(part.data);
      cursor = part.cursor;
      parts.push(Buffer.from(part.data, 'base64'));
    }
    const file = join(root, 'event.mp4');
    await writeFile(file, Buffer.concat(parts));
    const info = await probeMedia(file);
    assert.deepEqual([info.videoCodec, info.audioCodec], ['h264', 'aac']);
    await media.command({ ...context, action: 'close', readerId: reader.readerId });
    await media.command({ ...context, action: 'configure', configuration: null, generation: 3 });
    await assert.rejects(
      media.command({ ...context, action: 'configure', configuration, generation: 2 }),
      /superseded/,
    );
    await media.command({
      ...context,
      action: 'configure',
      configuration: { ...configuration, audio: false },
      generation: 4,
    });
    await waitFor(() => media.recorders.get(context.owner)?.fragments.length >= 1);
    const silent = await media.command({ ...context, action: 'open' });
    const part = await media.command({
      ...context,
      action: 'next',
      readerId: silent.readerId,
      cursor: silent.cursor,
    });
    const silentFile = join(root, 'silent.mp4');
    await writeFile(
      silentFile,
      Buffer.concat([Buffer.from(silent.data, 'base64'), Buffer.from(part.data, 'base64')]),
    );
    const silenceInfo = await probeMedia(silentFile);
    assert.deepEqual([silenceInfo.videoCodec, silenceInfo.audioCodec], ['h264', undefined]);
  },
);

test(
  'real HomeKit Live sends SRTP video/audio from the advertised ports and decodes return audio',
  { timeout: 30000 },
  async (t) => {
    const { media, context, diagnostics } = await fixture(t);
    const sockets = [dgram.createSocket('udp4'), dgram.createSocket('udp4')];
    t.after(() =>
      sockets.forEach((socket) => {
        try {
          socket.close();
        } catch {}
      }),
    );
    for (const socket of sockets) {
      socket.bind(0, '127.0.0.1');
      await once(socket, 'listening');
    }
    const crypto = () => ({
      srtpCryptoSuite: 0,
      key: randomBytes(16).toString('hex'),
      salt: randomBytes(14).toString('hex'),
    });
    const sessionID = randomUUID();
    const prepared = {
      sessionID,
      targetAddress: '127.0.0.1',
      video: { ...crypto(), port: sockets[0].address().port },
      audio: { ...crypto(), port: sockets[1].address().port },
    };
    const result = await media.command({ ...context, action: 'prepare', request: prepared });
    const counts = [0, 0];
    const ports = [new Set(), new Set()];
    sockets.forEach((socket, index) =>
      socket.on('message', (data, remote) => {
        if ((data[1] & 127) === (index ? 110 : 99)) {
          counts[index]++;
          ports[index].add(remote.port);
        }
      }),
    );
    try {
      await media.command({
        ...context,
        action: 'start',
        talkback: true,
        request: {
          sessionID,
          type: 'start',
          video: { ...configuration.video, max_bit_rate: 500, mtu: 1200, pt: 99 },
          audio: { codec: 'OPUS', sample_rate: 16, max_bit_rate: 24, packet_time: 20, pt: 110 },
        },
      });
    } catch (error) {
      t.diagnostic(diagnostics.join('\n'));
      throw error;
    }
    const talk = await media.command({ ...context, action: 'talk', sessionID });
    const returned = [];
    talk.stream.on('data', (bytes) => returned.push(bytes));
    const key = Buffer.from(prepared.audio.key + prepared.audio.salt, 'hex').toString('base64');
    const sender = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-re',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=900:sample_rate=16000',
        '-t',
        '3',
        '-c:a',
        'libopus',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-b:a',
        '24k',
        '-payload_type',
        '110',
        '-f',
        'rtp',
        '-srtp_out_suite',
        'AES_CM_128_HMAC_SHA1_80',
        '-srtp_out_params',
        key,
        `srtp://127.0.0.1:${result.audio.port}?rtcpport=${result.audio.port}&pkt_size=400`,
      ],
      { stdio: 'ignore' },
    );
    t.after(() => sender.kill('SIGKILL'));
    try {
      await waitFor(
        () =>
          counts.every((count) => count > 15) &&
          returned.reduce((sum, b) => sum + b.length, 0) > 1000,
        10000,
      );
    } catch (error) {
      t.diagnostic(diagnostics.join('\n'));
      throw error;
    }
    assert.deepEqual([...ports[0]], [result.video.port]);
    assert.deepEqual([...ports[1]], [result.audio.port]);
    await media.command({ ...context, action: 'stop', sessionID });
    assert.equal(media.streams.size, 0);
  },
);
