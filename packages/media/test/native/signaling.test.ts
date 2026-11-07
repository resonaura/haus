/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { binary, nativeWorker } from '../support/native/worker.js';
import { browserOffer } from '../support/native/offer.js';
import { textValue } from '../support/values.js';
test(
  'native browser signaling repeatedly emits a DTLS answer for both media tracks',
  { skip: !binary, timeout: 30000 },
  async (t) => {
    const worker = nativeWorker();
    t.onTestFinished(() => worker.close());
    await worker.waitFor((event) => event.event === 'ready');
    const roles: string[] = [];
    for (let attempt = 0; attempt < 10; ++attempt) {
      const viewerId = randomUUID();
      worker.send({
        cmd: 'start_viewer',
        viewer_id: viewerId,
        did: randomUUID(),
        sdp: browserOffer(),
      });
      const response = await worker.waitFor((event) => event.viewer_id === viewerId);
      assert.equal(response.event, 'viewer_offer', 'native viewer must answer');
      const sdp = textValue(response.sdp);
      assert.deepEqual(
        [...sdp.matchAll(/^a=mid:([^\r\n]+)/gm)].map((match) => match[1]),
        ['0', '1'],
        'answer must retain exactly the offered video and audio mids',
      );
      assert.equal(
        /^a=rtpmap:96 H264\/90000\r?$/m.test(sdp),
        true,
        'video must select the offered H264 payload type',
      );
      assert.equal(
        /^a=rtpmap:111 opus\/48000(?:\/2)?\r?$/im.test(sdp),
        true,
        'audio must select the offered Opus payload type',
      );
      const setup = [...sdp.matchAll(/^a=setup:([^\r\n]+)/gm)].map((match) => match[1]);
      assert.ok(setup.length > 0, 'answer must declare its DTLS role');
      roles.push(...setup);
      worker.send({ cmd: 'stop_viewer', viewer_id: viewerId });
    }
    assert.equal(
      roles.every((role) => role === 'active' || role === 'passive'),
      true,
      `every emitted answer needs a fixed DTLS role; received ${JSON.stringify(roles)}`,
    );
  },
);
