/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { binary, nativeWorker as worker } from '../support/native/worker.js';
import { freePort } from '../support/native/ports.js';
import { rtspReader, waitUntil } from '../support/native/reader.js';
import { rtp } from '../support/native/rtp.js';

test(
  'native RTSP preserves the AAC media clock through a burst and RTP timestamp wraparound',
  { skip: !binary, timeout: 10000 },
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
    const connected = await rtspReader(rtspPort, did);
    reader = connected;
    await connected.request(
      'SETUP',
      '/track1',
      'Transport: RTP/AVP/TCP;unicast;interleaved=2-3\r\n',
    );
    await connected.request('PLAY');
    // Each AAC access unit is 1024 samples at the advertised 16 kHz clock.
    // The first increment wraps the source RTP clock. Arrival-time timestamps
    // collapse these 2 seconds of buffered audio to only a few ticks.
    const expected = Array.from({ length: 32 }, (_, index) => {
      const payload = Buffer.alloc(36, index);
      payload.writeUInt16BE(16, 0); // AU-headers-length in bits.
      payload.writeUInt16BE(32 << 3, 2); // 32-byte AAC AU, index zero.
      const packet = rtp(payload, 300 + index, (0xffffff00 + index * 1024) >>> 0);
      packet[1] = 0x80 | 97;
      return packet;
    });
    for (const packet of expected) {
      await new Promise<void>((resolve, reject) =>
        sender.send(packet, audioPort, '127.0.0.1', (error) => (error ? reject(error) : resolve())),
      );
    }
    await waitUntil(
      () => connected.audioPackets.length >= expected.length,
      'all AAC access units should reach the RTSP reader',
    );
    assert.ok(
      connected.audioPackets.every((packet) => (packet[1] & 0x7f) === 97),
      'an AAC RTSP track must not inject PCMU silence with an unadvertised payload type',
    );
    assert.equal(connected.audioPackets.length, expected.length);
    for (let index = 0; index < expected.length; index++) {
      const actual = connected.audioPackets[index];
      assert.deepEqual(
        actual.subarray(12),
        expected[index].subarray(12),
        `AAC payload preserved at access unit ${index}`,
      );
      assert.equal(
        actual[1],
        expected[index][1],
        `AAC payload type and marker preserved at access unit ${index}`,
      );
      assert.equal(
        actual.readUInt16BE(2),
        index,
        `outgoing AAC sequence is contiguous at access unit ${index}`,
      );
      if (index > 0) {
        assert.equal(
          (actual.readUInt32BE(4) - connected.audioPackets[index - 1].readUInt32BE(4)) >>> 0,
          1024,
          `AAC source sample clock preserved at access unit ${index}`,
        );
      }
    }
  },
);
