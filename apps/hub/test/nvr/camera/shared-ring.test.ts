/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { CameraSessions } from '../../../src/nvr/camera/sessions.js';
import { engineFixture, ringFixture } from '../support/camera.js';
import { input, owner } from '../support/sessions.js';

test('CameraSessions feeds CameraRing from engine localRtsp to keep one upstream camera connection', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-shared-ring-'));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const ringSources: string[] = [];
  let addedId = '';
  const engine = engineFixture({
    async add(id) {
      addedId = id;
    },
    localRtsp(id) {
      return `rtsp://127.0.0.1:19554/${id}`;
    },
  });
  const sessions = new CameraSessions(root, engine, {
    ring: (_ringRoot, source) => {
      ringSources.push(source);
      return ringFixture(Date.now());
    },
  });
  await sessions.initialize();
  t.onTestFinished(() => sessions.close());

  await sessions.acquire({
    ...input(),
    cameraId: 'camera.front',
    owner,
    advertiseHost: '192.168.1.20',
  });

  assert.ok(addedId);
  assert.deepEqual(ringSources, [`rtsp://127.0.0.1:19554/${addedId}`]);
});
