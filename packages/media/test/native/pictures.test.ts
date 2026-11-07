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
  'late readers receive complete cached H264 pictures with current parameter timestamps',
  { skip: !binary, timeout: 10000 },
  async (t) => {
    const source = worker(),
      sender = dgram.createSocket('udp4');
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
      audioPort = await freePort(true),
      did = randomUUID();
    source.send({
      cmd: 'start_relay',
      did,
      rtsp_port: rtspPort,
      rtp_port: videoPort,
      audio_rtp_port: audioPort,
      rtsp_path: did,
    });
    await source.event('relay_started');
    const audio = rtp(Buffer.from([0, 16, 0, 8, 0]), 0, 16000);
    audio[1] = 0x80 | 97;
    await new Promise<void>((resolve, reject) =>
      sender.send(audio, audioPort, '127.0.0.1', (error) => (error ? reject(error) : resolve())),
    );
    const partialIdr = rtp(Buffer.from([0x7c, 0x45, 0x99]), 0, 8000);
    await new Promise<void>((resolve, reject) =>
      sender.send(partialIdr, videoPort, '127.0.0.1', (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    await delay(25);
    assert.ok(
      !source.events.some((event) => event.event === 'relay_ready'),
      'an IDR tail without parameters or a complete cached picture is not playable media',
    );
    const sps = Buffer.from([0x67, 0x42, 0x00, 0x28]),
      pps = Buffer.from([0x68, 0xce, 0x06]);
    const length = (value: Buffer) => {
      const bytes = Buffer.alloc(2);
      bytes.writeUInt16BE(value.length);
      return bytes;
    };
    const stap = rtp(
      Buffer.concat([Buffer.from([0x78]), length(sps), sps, length(pps), pps]),
      0,
      9000,
      false,
    );
    const slices = [...fragmentedFrame(5, 2, 1, 1800000), ...fragmentedFrame(5, 2, 3, 1800000)];
    slices[1][1] &= 0x7f; // FU end ends the first slice, not the whole picture.
    for (const packet of [stap, ...slices, rtp(Buffer.from([0x41, 0x99]), 5, 15000)])
      await new Promise<void>((resolve, reject) =>
        sender.send(packet, videoPort, '127.0.0.1', (error) => (error ? reject(error) : resolve())),
      );
    await source.event('relay_ready');
    const connected = await rtspReader(rtspPort, did);
    reader = connected;
    const describe = await connected.request('DESCRIBE');
    assert.match(describe, /profile-level-id=420028/);
    assert.ok(
      describe.includes(
        'sprop-parameter-sets=' + sps.toString('base64') + ',' + pps.toString('base64'),
      ),
      'SDP parameter sets contain individual NAL units, never the STAP header',
    );
    await connected.request(
      'SETUP',
      '/track0',
      'Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n',
    );
    await connected.request('PLAY');
    await waitUntil(
      () => connected.packets.length >= 7,
      'both cached IDR slices reached the late reader',
    );
    assert.deepEqual(
      connected.packets.map((packet) => packet.subarray(12)),
      [sps, pps, ...slices.map((packet) => packet.subarray(12)), Buffer.from([9, 0xf0])],
    );
    assert.equal(
      required(connected.packets.at(-1))[1] & 0x80,
      0,
      'AUD is a delimiter, not a fabricated picture',
    );
    for (let index = 1; index < connected.packets.length; index++)
      assert.equal(
        connected.packets[index].readUInt16BE(2),
        connected.packets[index - 1].readUInt16BE(2) + 1,
      );
    assert.equal(
      new Set(connected.packets.map((packet) => packet.readUInt32BE(4))).size,
      1,
      'cached parameter sets must use the cached picture timestamp, not their older source GOP',
    );
  },
);
