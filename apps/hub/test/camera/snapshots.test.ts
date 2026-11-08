/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { CameraSnapshots } from '../../src/camera/index.js';

describe('CameraSnapshots', () => {
  it('accepts null device associations without borrowing another camera snapshot capability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-images-null-'));
    try {
      const ownUrl = 'http://192.168.1.2/api/cameras/fixture/snapshot/last-live';
      const otherUrl = 'http://192.168.1.2/api/cameras/other/snapshot/last-live';
      const jpeg = Buffer.from([255, 216, 1, 2, 255, 217]);
      const calls: string[] = [];
      const camera = { id: 'camera.fixture', available: true, deviceId: null };
      const snapshots = new CameraSnapshots({
        config: { data: root },
        sessions: {
          cluster: { nodes: () => [] },
          registry: () => ({
            entities: [camera.id, 'camera.other'].map((entity_id) => ({
              entity_id,
              device_id: null,
            })),
            states: [camera.id, 'camera.other'].map((entity_id) => ({
              entity_id,
              state: 'idle',
              attributes: {
                haus_snapshot_profile: 1,
                haus_snapshot_provider: 'aqara',
                haus_snapshot_url: entity_id === camera.id ? ownUrl : otherUrl,
              },
            })),
          }),
          ensure: async () => {
            throw Error('unexpected capture');
          },
          release: async () => {},
          advertiseHost: async () => '127.0.0.1',
        },
        bridgeCapture: async (source) => {
          calls.push(source.url);
          return { buffer: jpeg, at: 1000, stale: false };
        },
      });
      const image = await snapshots.snapshot(camera);
      assert.deepEqual(calls, [ownUrl]);
      assert.deepEqual(image.buffer, jpeg);
      assert.equal(image.at, 1000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('snapshots come from a leased RTSP source and retain the last JPEG across an outage and restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-images-'));
    try {
      let captures = 0;
      let releases = 0;
      let at = 10000;
      let fail = false;
      const camera = { id: 'camera.fixture', available: true };
      const options = {
        config: { data: root },
        now: () => at,
        sessions: {
          cluster: { nodes: () => [] },
          ensure: async () => ({
            id: 'fixture-session',
            node: { id: 'worker', url: 'http://192.168.1.2:8098', key: 'k' },
          }),
          release: async () => {
            releases++;
          },
          advertiseHost: async () => '192.168.1.2',
        },
        request: async (_node: unknown, path: string, input?: { data?: unknown }) => {
          const data = (input?.data ?? {}) as { action?: string; cameraId?: string };
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('bridge real frame avoids decoding, keeps original age on disk and never treats stale JPEG as fresh', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-bridge-image-'));
    try {
      let at = 40000;
      let reads = 0;
      const options = {
        config: { data: root },
        now: () => at,
        sessions: {
          cluster: { nodes: () => [] },
          ensure: async (): Promise<never> => {
            throw Error('must not decode bridge frame');
          },
          release: async () => {},
          advertiseHost: async () => '192.168.1.2',
        },
        bridgeSource: async () => ({
          version: 1 as const,
          provider: 'aqara' as const,
          url: 'fixture',
        }),
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
