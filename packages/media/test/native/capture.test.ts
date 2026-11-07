/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';

import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CameraRing } from '../../src/recording/ring.js';
import { describeRecording } from '../../src/recording/recording.js';
import { NativeCameraMedia } from '../../src/stream/native.js';
import { MediaRuntime } from '../../src/pipeline/tools.js';
import { binary, nativeWorker } from '../support/native/worker.js';
import { freeTcpPort, freeUdpPort } from '../support/native/ports.js';

import { required, textValue } from '../support/values.js';
import { cleanup, stopProcess } from '../support/process.js';
test(
  'prewarmed RTSP feeds an audio video pre-roll recording and native WebRTC answer',
  { skip: !binary, timeout: 60000 },
  async (t) => {
    const source = nativeWorker();
    const directory = await mkdtemp(join(tmpdir(), 'haus-native-camera-test-'));
    let generator: ChildProcess | undefined, ring: CameraRing | undefined;
    const engine = new NativeCameraMedia(directory, { binary });
    t.onTestFinished(() =>
      cleanup(
        () => ring?.stop(),
        () => engine.stop(),
        () => stopProcess(generator),
        () => source.close(),
        () => rm(directory, { recursive: true, force: true }),
      ),
    );

    await source.waitFor('ready');
    const sourceId = randomUUID(),
      sourcePort = await freeTcpPort(),
      sourceVideoPort = await freeUdpPort(),
      sourceAudioPort = await freeUdpPort();
    source.send({
      cmd: 'start_relay',
      did: sourceId,
      rtsp_port: sourcePort,
      rtp_port: sourceVideoPort,
      audio_rtp_port: sourceAudioPort,
      rtsp_path: sourceId,
    });
    assert.equal((await source.waitFor('relay_started')).did, sourceId);

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
        '15',
        '-keyint_min',
        '15',
        '-sc_threshold',
        '0',
        '-bsf:v',
        'dump_extra=freq=keyframe',
        '-f',
        'rtp',
        '-payload_type',
        '96',
        `rtp://127.0.0.1:${sourceVideoPort}?pkt_size=1200`,
        '-map',
        '1:a:0',
        '-vn',
        '-c:a',
        'aac',
        '-profile:a',
        'aac_low',
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
        `rtp://127.0.0.1:${sourceAudioPort}?pkt_size=1200`,
      ],
      { stdio: 'ignore' },
    );
    await once(generator, 'spawn');

    await engine.initialize('192.168.1.20');
    const cameraId = randomUUID();
    await engine.add(cameraId, `rtsp://127.0.0.1:${sourcePort}/${sourceId}`);
    await Promise.race([
      required(engine.sessions.get(cameraId)).readyPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('source prewarm timeout')), 15000),
      ),
    ]);

    ring = new CameraRing(join(directory, 'ring'), engine.localRtsp(cameraId), {
      requireAudio: true,
      recordAudio: true,
      retentionSeconds: 24,
    });
    await ring.start();
    const warmDeadline = Date.now() + 15000;
    while (!ring.ready() && Date.now() < warmDeadline) {
      await ring.sample();
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
    }
    assert.equal(
      ring.ready(),
      true,
      'RTSP video and AAC audio should be warm before the viewer opens',
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 2600));

    const eventStart = Date.now();
    const job = await ring.record({
      eventId: randomUUID(),
      startAt: eventStart - 1800,
      endAt: eventStart + 1800,
    });

    const offerStartedAt = Date.now();
    const answer = await engine.offer(
      cameraId,
      'fixture-owner-123456789',
      [
        'v=0',
        'o=- 1 1 IN IP4 127.0.0.1',
        's=-',
        't=0 0',
        'a=group:BUNDLE 0 1',
        'a=msid-semantic: WMS *',
        'm=video 9 UDP/TLS/RTP/SAVPF 96',
        'c=IN IP4 0.0.0.0',
        'a=ice-ufrag:fixture',
        'a=ice-pwd:fixturepassword012345678901',
        'a=fingerprint:sha-256 00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F',
        'a=setup:actpass',
        'a=mid:0',
        'a=recvonly',
        'a=rtcp-mux',
        'a=rtpmap:96 H264/90000',
        'a=fmtp:96 packetization-mode=1',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'c=IN IP4 0.0.0.0',
        'a=ice-ufrag:fixture',
        'a=ice-pwd:fixturepassword012345678901',
        'a=fingerprint:sha-256 00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F',
        'a=setup:actpass',
        'a=mid:1',
        'a=recvonly',
        'a=rtcp-mux',
        'a=rtpmap:111 opus/48000/2',
        '',
      ].join('\r\n'),
    );
    assert.ok(
      Date.now() - offerStartedAt < 5000,
      'an already prewarmed camera should not wait for a new source startup',
    );
    assert.equal(answer.answer.type, 'answer');
    assert.match(textValue(answer.answer.sdp), /H264\/90000/);
    assert.match(textValue(answer.answer.sdp), /opus\/48000/i);
    assert.match(textValue(answer.answer.sdp), /a=setup:(active|passive)\r?$/m);
    assert.doesNotMatch(textValue(answer.answer.sdp), /a=setup:actpass/);
    assert.equal(engine.viewers.size, 1);
    engine.closeViewer(answer.viewerId, 'fixture-owner-123456789');
    assert.equal(
      engine.sessions.has(cameraId),
      true,
      'closing the viewer must leave the warmed RTSP producer alive',
    );

    const jobId = job.id,
      recordingDeadline = Date.now() + 20000;
    while (
      ['recording', 'preparing'].includes(ring.jobs.get(jobId)?.state ?? '') &&
      Date.now() < recordingDeadline
    ) {
      await ring.sample();
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
    }
    const finished = required(ring.jobs.get(jobId));
    assert.equal(
      finished?.state,
      'ready',
      describeRecording(finished).error ?? 'pre-roll recording did not finalize',
    );
    assert.equal(required(finished.result).audio, true);
    assert.ok(required(finished.result).duration >= 3);
    assert.ok(
      required(finished.result).mediaStartAt <= eventStart + 1000,
      'recording should include video before the event',
    );
  },
);
