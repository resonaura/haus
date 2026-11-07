/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { binary, nativeWorker as worker } from '../support/native/worker.js';
import { freePort, availableReceiveBuffer } from '../support/native/ports.js';
import { rtspReader, waitUntil, delay } from '../support/native/reader.js';
import { rtp, fragmentedFrame } from '../support/native/rtp.js';

test(
  'native RTSP preserves every large H.264 IDR and P-frame RTP fragment across a receive burst',
  {
    skip: !binary || process.platform === 'win32',
    timeout: 15000,
  },
  async (t) => {
    const receiveBuffer = await availableReceiveBuffer();
    if (receiveBuffer < 4 * 1024 * 1024) {
      t.skip(
        `host limits SO_RCVBUF to ${receiveBuffer} bytes; this burst test requires 4 MiB including UDP packet overhead`,
      );
      return;
    }
    const source = worker();
    const sender = dgram.createSocket('udp4');
    let reader: Awaited<ReturnType<typeof rtspReader>> | undefined;
    t.onTestFinished(async () => {
      // Always unstop the worker, including assertion/UDP-send failures.
      source.child.kill('SIGCONT');
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
      '/track0',
      'Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n',
    );
    await connected.request('PLAY');

    const send = (packet: Buffer) =>
      new Promise<void>((resolve, reject) =>
        sender.send(packet, videoPort, '127.0.0.1', (error) => (error ? reject(error) : resolve())),
      );
    const initial = [
      rtp(Buffer.from([0x67, 0x42, 0, 0x28]), 0, 0),
      rtp(Buffer.from([0x68, 0xce, 6]), 1, 0),
      rtp(Buffer.from([0x65, 0x88, 0x84]), 2, 0),
    ];
    for (const packet of initial) await send(packet);
    await waitUntil(
      () => connected.packets.length === initial.length,
      'initial keyframe reached the RTSP reader',
    );

    // A short scheduler stall makes the receive-buffer regression deterministic,
    // independent of the CI machine's speed. This 1.8 MiB burst models a detailed
    // large camera IDR followed by dependent frames; it fits the configured buffer.
    // The pre-fix macOS worker delivered only 642–643 of the 1539 RTP packets.
    const burst = fragmentedFrame(5, 512, 3, 9000);
    for (let frame = 0; frame < 32; frame++)
      burst.push(...fragmentedFrame(1, 32, 515 + frame * 32, 18000 + frame * 6000));
    source.child.kill('SIGSTOP');
    await delay(25);
    try {
      for (const packet of burst) await send(packet);
    } finally {
      source.child.kill('SIGCONT');
    }
    const expected = [...initial, ...burst];
    await waitUntil(
      () => connected.packets.length >= expected.length,
      () =>
        `all ${expected.length} RTP fragments survived the UDP receive burst (received ${connected.packets.length})`,
    );
    assert.equal(connected.packets.length, expected.length, 'no RTP fragments were duplicated');
    for (let index = 0; index < expected.length; index++) {
      const actual = connected.packets[index];
      assert.deepEqual(
        actual.subarray(12),
        expected[index].subarray(12),
        `RTP payload preserved at fragment ${index}`,
      );
      assert.equal(
        actual[1],
        expected[index][1],
        `RTP payload type and frame marker preserved at fragment ${index}`,
      );
      assert.equal(
        actual.readUInt16BE(2),
        index,
        `outgoing RTP sequence is contiguous at fragment ${index}`,
      );
      if (index > 0) {
        assert.equal(
          (actual.readUInt32BE(4) - connected.packets[index - 1].readUInt32BE(4)) >>> 0,
          (expected[index].readUInt32BE(4) - expected[index - 1].readUInt32BE(4)) >>> 0,
          `source video RTP clock preserved at fragment ${index}, including frames received in one burst`,
        );
      }
    }
  },
);
