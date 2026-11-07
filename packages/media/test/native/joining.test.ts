/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { binary, nativeWorker as worker } from '../support/native/worker.js';
import { freePort } from '../support/native/ports.js';
import { rtspReader, waitUntil, delay } from '../support/native/reader.js';
import { rtp, fragmentedFrame } from '../support/native/rtp.js';
import { required } from '../support/values.js';
test(
  'late RTSP readers display a cached still and wait for a clean live IDR before dependent frames',
  {
    skip: !binary,
    timeout: 10000,
  },
  async (t) => {
    const source = worker();
    const sender = dgram.createSocket('udp4');
    let reader: Awaited<ReturnType<typeof rtspReader>> | undefined;
    t.onTestFinished(async () => {
      reader?.socket.destroy();
      sender.close();
      if (source.child.exitCode === null) {
        const closed = once(source.child, 'close');
        source.child.kill('SIGKILL');
        await closed;
      }
    });
    await source.event('ready');
    const rtspPort = await freePort(),
      videoPort = await freePort(true),
      audioPort = await freePort(true);
    const did = randomUUID();
    source.send({
      cmd: 'start_relay',
      did,
      rtsp_port: rtspPort,
      rtp_port: videoPort,
      audio_rtp_port: audioPort,
      rtsp_path: did,
    });
    await source.event('relay_started');
    const send = (packet: Buffer) =>
      new Promise<void>((resolve, reject) =>
        sender.send(packet, videoPort, '127.0.0.1', (error) => (error ? reject(error) : resolve())),
      );
    const cached = [
      rtp(Buffer.from([0x67, 0x42, 0, 0x28]), 0, 0),
      rtp(Buffer.from([0x68, 0xce, 6]), 1, 0),
      rtp(Buffer.from([0x65, 0x88, 0x84]), 2, 0),
    ];
    for (const packet of cached) await send(packet);
    // P1 and P2 advance the camera prediction chain before the reader joins.
    await send(rtp(Buffer.from([0x41, 1]), 3, 6000));
    await send(rtp(Buffer.from([0x41, 2]), 4, 12000));
    await delay(50);
    const connected = await rtspReader(rtspPort, did);
    reader = connected;
    await connected.request(
      'SETUP',
      '/track0',
      'Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n',
    );
    await connected.request('PLAY');
    await waitUntil(
      () => connected.packets.length >= cached.length + 1,
      'cached IDR should immediately prime the late reader',
    );
    assert.equal(connected.packets.length, cached.length + 1);
    assert.deepEqual(required(connected.packets.at(-1)).subarray(12), Buffer.from([9, 0xf0]));
    for (let index = 0; index < cached.length; index++)
      assert.deepEqual(connected.packets[index].subarray(12), cached[index].subarray(12));

    await send(rtp(Buffer.from([0x41, 3]), 5, 18000));
    // Joining in the middle of a fresh fragmented IDR must not unlock P-frames.
    const incomplete = fragmentedFrame(5, 3, 6, 24000);
    await send(incomplete[1]);
    await send(incomplete[2]);
    await send(rtp(Buffer.from([0x41, 4]), 9, 30000));
    await delay(100);
    assert.equal(
      connected.packets.length,
      cached.length + 1,
      'P-frames and orphan IDR fragments must wait for a complete clean IDR start',
    );

    const fresh = fragmentedFrame(5, 3, 10, 36000);
    for (const packet of fresh) await send(packet);
    const dependent = rtp(Buffer.from([0x41, 5]), 13, 42000);
    await send(dependent);
    await waitUntil(
      () => connected.packets.some((packet) => packet.subarray(12).equals(dependent.subarray(12))),
      'fresh IDR and its following P-frame should reach the reader',
    );
    const live = connected.packets.slice(cached.length + 1);
    // Parameter sets may be repeated immediately before the fresh IDR.
    const livePictures = live.filter((packet) => ![7, 8].includes(packet[12] & 0x1f));
    assert.equal(livePictures.length, fresh.length + 1);
    for (let index = 0; index < fresh.length; index++)
      assert.deepEqual(livePictures[index].subarray(12), fresh[index].subarray(12));
    assert.deepEqual(required(livePictures.at(-1)).subarray(12), dependent.subarray(12));
    assert.equal(
      (required(livePictures.at(-1)).readUInt32BE(4) -
        required(livePictures.at(-2)).readUInt32BE(4)) >>>
        0,
      6000,
      'the first dependent frame keeps its source video clock after the clean IDR, even when both arrive together',
    );
  },
);
