/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
import { required, port } from '../support/values.js';

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Blobs } from '../../../src/nvr/index.js';
import { CameraRing } from '@haus/media';
import { createNode } from '../../../src/nvr/index.js';
import { sign } from '../../../src/nvr/index.js';

import { owner, other, input, fixture } from '../support/sessions.js';
test('simultaneous owners share one producer and cannot renew or release another owner', async (t) => {
  const f = await fixture(t);
  const [a, b] = await Promise.all([
    f.sessions.acquire(input()),
    f.sessions.acquire(input({ owner: other })),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(f.added.length, 1);
  assert.equal(f.rings.length, 1);
  assert.equal(JSON.stringify(a).includes('private-password'), false);
  assert.throws(() => f.sessions.renew(a.id, 'unrelated-owner-123456'), /not_found/);
  await assert.rejects(f.sessions.release(a.id, 'unrelated-owner-123456'), /not_found/);
  await f.sessions.release(a.id, owner);
  assert.equal(f.sessions.sessions.size, 1);
  await f.sessions.release(a.id, other);
  assert.equal(f.sessions.sessions.size, 0);
});
test('secret rotation uses a new producer while old leases remain independently owned', async (t) => {
  const f = await fixture(t),
    a = await f.sessions.acquire(input());
  const b = await f.sessions.acquire(
    input({
      source: {
        kind: 'p2p-restream',
        url: 'rtsp://name:new-password@192.168.1.9/stream',
      },
    }),
  );
  assert.notEqual(a.id, b.id);
  assert.equal(f.sessions.sessions.size, 2);
  await f.sessions.release(a.id, owner);
  assert.equal(f.sessions.sessions.has(b.id), true);
  assert.equal(required(f.sessions.byCamera.get('camera.fixture')).id, b.id);
});
test('capacity is reserved before asynchronous startup and expired leases release producers', async (t) => {
  const f = await fixture(t);
  await Promise.all([
    f.sessions.acquire(input()),
    f.sessions.acquire(input({ cameraId: 'camera.second' })),
  ]);
  await assert.rejects(f.sessions.acquire(input({ cameraId: 'camera.third' })), /busy/);
  f.advance(60001);
  await f.sessions.tick();
  assert.equal(f.sessions.sessions.size, 0);
  assert.equal(f.removed.length, 2);
});
test('legacy relays share admission and only one rotation slot transfers owners after readiness', async (t) => {
  const f = await fixture(t);
  f.sessions.otherStreams = () => 1;
  const old = await f.sessions.acquire(input());
  await assert.rejects(f.sessions.acquire(input({ cameraId: 'camera.second' })), /busy/);
  const replacement = await f.sessions.acquire(
    input({
      source: {
        kind: 'p2p-restream',
        url: 'rtsp://new:private-secret@192.168.1.9/live',
      },
    }),
  );
  assert.equal(f.sessions.sessions.size, 2);
  await assert.rejects(
    f.sessions.acquire(
      input({
        source: {
          kind: 'p2p-restream',
          url: 'rtsp://next:private-secret@192.168.1.9/live',
        },
      }),
    ),
    /busy/,
  );
  f.advance(59000);
  assert.equal(f.sessions.renew(old.id, owner).id, replacement.id);
  f.advance(2000);
  await f.sessions.tick();
  assert.equal(f.sessions.sessions.has(old.id), false);
  assert.equal(f.sessions.sessions.has(replacement.id), true);
});
test('video-only readiness is opt-in and absent audio never becomes a fabricated track', () => {
  let at = 100000;
  const ring = new CameraRing('/unused', 'rtsp://127.0.0.1/fixture', {
    now: () => at,
    requireAudio: false,
  });
  ring.metadata = { video: true, audio: false };
  ring.metadataAt = at;
  ring.freshAt = at;
  assert.equal(ring.ready(), true);
  ring.requireAudio = true;
  assert.equal(ring.ready(), false);
  ring.metadata.audio = true;
  assert.equal(ring.ready(), true);
  at += 10001;
  assert.equal(ring.ready(), false);
});
test('signed session RPC enforces owner isolation, pre-roll and secret-free status', async (t) => {
  const f = await fixture(t),
    key = 'fixture-camera-pairing-key-123456789';
  const blobs = new Blobs(join(f.root, 'blobs'));
  await blobs.initialize();
  const server = createNode({
    key,
    nodeId: 'fixture',
    blobs,
    cameras: f.sessions,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${port(server)}`;
  const rpc = async (path: string, value: unknown, method: 'POST' | 'DELETE' = 'POST') => {
    const text = JSON.stringify(value);
    return fetch(base + path, {
      method,
      body: text,
      headers: { ...sign(key, method, path, createHash('sha256').update(text).digest('hex')) },
    });
  };
  assert.equal(
    required(
      await fetch(base + '/v1/cameras/sessions', {
        method: 'POST',
        body: JSON.stringify(input()),
      }),
    ).status,
    401,
  );
  const opened = await required(await rpc('/v1/cameras/sessions', input())).json();
  const path = `/v1/cameras/sessions/${opened.id}`;
  assert.equal(required(await rpc(path + '/lease', { owner: other })).status, 404);
  assert.equal(required(await rpc(path + '/lease', { owner }, 'DELETE')).status, 405);
  const eventId = randomUUID();
  await rpc(path + '/recordings', {
    owner,
    eventId,
    startAt: 100000,
    endAt: 120000,
  });
  assert.equal(required(f.rings[0].jobs.get(eventId)).startAt, 92000);
  const event = {
    id: eventId,
    cameraId: 'camera.fixture',
    startAt: 100000,
    endAt: 125000,
    kinds: ['motion'],
  };
  assert.equal(
    required(
      await rpc(path + '/recordings', {
        owner,
        eventId,
        startAt: event.startAt,
        endAt: event.endAt,
        event,
      }),
    ).status,
    202,
  );
  assert.deepEqual(required(f.rings[0].jobs.get(eventId)).metadata, event);
  assert.equal(
    required(
      await rpc(path + '/recordings', {
        owner,
        eventId,
        startAt: event.startAt,
        endAt: event.endAt,
        event: { ...event, cameraId: 'camera.other' },
      }),
    ).status,
    400,
  );
  const status = await required(
    await fetch(base + '/v1/status', {
      headers: { ...sign(key, 'GET', '/v1/status') },
    }),
  ).json();
  assert.equal(status.rtspSessions.profile, 1);
  assert.equal(JSON.stringify(status).includes('private-password'), false);
});
