/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CameraSnapshots } from '../lib/camera-snapshots.mjs';

test('snapshots come from a leased RTSP source and retain the last JPEG across an outage and restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-images-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let captures = 0,
    releases = 0,
    at = 10000,
    fail = false;
  const camera = { id: 'camera.fixture', available: true };
  const options = {
    config: { data: root },
    now: () => at,
    sessions: {
      ensure: async () => ({ id: 'fixture-session', node: { id: 'worker' } }),
      release: async () => releases++,
      advertiseHost: async () => '192.168.1.2',
    },
    request: async (_node, path, { data }) => {
      assert.equal(path, '/v1/homekit');
      assert.equal(data.action, 'snapshot');
      assert.equal(data.cameraId, camera.id);
      captures++;
      if (fail) throw Error('node down');
      return new Response(Buffer.from([255, 216, 1, 2, 255, 217]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    },
  };
  const snapshots = new CameraSnapshots(options);
  const [a, b] = await Promise.all([snapshots.snapshot(camera), snapshots.snapshot(camera)]);
  assert.equal(captures, 1);
  assert.equal(releases, 1);
  assert.deepEqual(a.buffer, b.buffer);
  fail = true;
  at += 4000;
  assert.equal((await snapshots.snapshot(camera)).stale, true);
  const restarted = new CameraSnapshots(options);
  assert.deepEqual((await restarted.snapshot(camera)).buffer, a.buffer);
  assert.equal((await restarted.snapshot(camera)).stale, true);
});

test('bridge real frame avoids decoding, keeps original age on disk and never treats stale JPEG as fresh', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-bridge-image-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let at = 40000,
    reads = 0;
  const options = {
    config: { data: root },
    now: () => at,
    sessions: {
      ensure: async () => {
        throw Error('must not decode bridge frame');
      },
      release: async () => {},
    },
    bridgeSource: async () => ({ version: 1, provider: 'aqara', url: 'fixture' }),
    bridgeCapture: async () => {
      reads++;
      return { buffer: Buffer.from([255, 216, 1, 2, 255, 217]), at: 10000, stale: true };
    },
  };
  const cache = new CameraSnapshots(options);
  assert.equal((await cache.snapshot({ id: 'camera.fixture' })).at, 10000);
  at += 1000;
  assert.equal((await cache.snapshot({ id: 'camera.fixture' })).stale, true);
  assert.equal(reads, 1);
  const restarted = new CameraSnapshots({
    ...options,
    bridgeCapture: async () => {
      throw Error('bridge down');
    },
  });
  assert.equal((await restarted.snapshot({ id: 'camera.fixture' })).at, 10000);
});
