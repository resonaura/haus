/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { binary, nativeWorker } from '../support/native/worker.js';
import { freeTcpPort, freeUdpPort } from '../support/native/ports.js';

test(
  'Haus native media binary starts its loopback RTSP relay',
  { skip: !binary, timeout: 20000 },
  async (t) => {
    const worker = nativeWorker();
    t.onTestFinished(() => worker.close());
    await worker.waitFor('ready');
    const did = randomUUID();
    worker.send({
      cmd: 'start_relay',
      did,
      rtsp_port: await freeTcpPort(),
      rtp_port: await freeUdpPort(),
      audio_rtp_port: await freeUdpPort(),
      rtsp_path: did,
    });
    assert.equal((await worker.waitFor('relay_started')).did, did);
    await worker.close();
  },
);
