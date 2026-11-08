/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  Motion,
  motionSettings,
  type AnalysisNode,
  type AnalysisNodeHealth,
  type MotionCamera,
} from '../../../src/camera/motion/index.js';
import { recordingMetadata } from '../../../src/events/recording-metadata.js';

describe('Motion controller and settings', () => {
  it('never acquires a source or starts detection for an unknown persisted mode', async () => {
    let sources = 0;
    const motion = new Motion({
      ha: {
        stream: async () => {
          sources++;
          return 'rtsp://fixture.invalid/live';
        },
      },
      recorder: {},
      warm: { leases: new Map() },
      config: { recording_enabled: true },
      cluster: { nodes: () => [], health: new Map() },
    });
    motion.localSupported = true;
    // Legacy JavaScript callers can still supply an unsupported value at runtime.
    await Reflect.apply(motion.start, motion, [
      {
        id: 'camera.fixture',
        enabled: true,
        available: true,
        motionDetection: { enabled: true, mode: 'unsupported' },
      },
    ]);
    expect(sources).toBe(0);
    expect(motion.jobs.size).toBe(0);
    expect(motion.warm.leases.size).toBe(0);
    await motion.stop();
  });

  it('requires explicit opt-in for software detection and rejects unknown configuration', () => {
    expect(motionSettings({ enabled: false, mode: 'objects' })).toEqual({
      enabled: false,
      mode: 'objects',
    });
    for (const value of [
      null,
      {},
      { enabled: true, mode: 'other' },
      { enabled: true, mode: 'objects', url: 'private' },
    ]) {
      expect(() => motionSettings(value)).toThrow();
    }
    const event = {
      id: 'test',
      cameraId: 'camera.test',
      mediaStartAt: 100.2,
      startAt: 8100,
      endAt: 20000,
      duration: 20,
      kinds: ['person'],
      detections: Array(500).fill({ kind: 'person' }),
      playbackInfo: {
        audio: true,
        sourceGaps: Array(100).fill({ at: 2, duration: 3 }),
      },
    };
    const metadata = recordingMetadata(event);
    expect(metadata.mediaStartAt).toBe(100);
    expect((metadata.playbackInfo as { audio: boolean }).audio).toBe(true);
    expect(JSON.stringify(metadata).length).toBeLessThan(1000);
  });

  it('cancels a stuck source acquisition on shutdown without creating a worker or lease', async () => {
    const motion = new Motion({
      ha: { stream: () => new Promise(() => {}) },
      recorder: {},
      warm: { leases: new Map() },
      config: { recording_enabled: true },
      cluster: {
        nodes: () => [
          {
            id: 'node',
            url: 'https://node.invalid',
            key: 'fixture',
            enabled: true,
            roles: ['stream'],
          },
        ],
        health: new Map([
          [
            'node',
            {
              online: true,
              remote: {
                relayOrigin: 'http://helper.test',
                detectors: { supported: true, active: 0, max: 1 },
              },
            },
          ],
        ]),
      },
    });
    motion.sync([
      {
        id: 'camera.test',
        enabled: true,
        available: true,
        motionDetection: { enabled: true, mode: 'objects' },
      },
    ]);
    const pending = motion.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await motion.stop();
    await pending;
    expect(motion.jobs.size).toBe(0);
    expect(motion.warm.leases.size).toBe(0);
  });

  it('distributes by node capacity, deduplicates motion, and reassigns failed workers without leaking leases', async () => {
    let at = 1000000;
    let streams = 0;
    let detections = 0;
    const nodes: AnalysisNode[] = [];
    const health = new Map<string, AnalysisNodeHealth>();
    const servers: Server[] = [];

    const addNode = async (name: string, max: number) => {
      const jobs = new Map<string, Record<string, unknown>>();
      const worker = { failed: false, jobs };
      const server = createServer(async (req, res) => {
        if (req.method === 'POST') {
          for await (const _ of req) {
            // drain request body
          }
          const id = randomUUID();
          jobs.set(id, {});
          res.writeHead(201).end(JSON.stringify({ id }));
          return;
        }
        if (req.method === 'DELETE') {
          jobs.delete(req.url?.split('/').at(-1) ?? '');
          res.end('{}');
          return;
        }
        if (worker.failed) {
          res.writeHead(503).end('{}');
          return;
        }
        res.end(
          JSON.stringify({
            state: 'running',
            events: [{ sequence: 1, kind: 'person', at }],
          }),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      servers.push(server);
      const port = (server.address() as AddressInfo).port;
      const node: AnalysisNode = {
        id: name,
        name,
        enabled: true,
        roles: ['stream'],
        url: `http://127.0.0.1:${port}`,
        allowHttp: true,
        key: 'fixture-only-private-key-long-enough',
      };
      nodes.push(node);
      health.set(name, {
        online: true,
        remote: {
          relayOrigin: 'http://helper.test:8099',
          detectors: { supported: true, active: 0, max },
          resources: { pressured: false },
        },
      });
      return worker;
    };

    const warm = { leases: new Map(), resource: () => 'b'.repeat(24) };
    const motion = new Motion({
      ha: {
        stream: async () => {
          streams++;
          return 'http://ha.test/private';
        },
      },
      cluster: { nodes: () => nodes, health },
      recorder: { trigger: () => detections++ },
      warm,
      config: { recording_enabled: true },
      now: () => at,
    });

    try {
      const weak = await addNode('weak', 1);
      const strong = await addNode('strong', 2);
      const cameras: MotionCamera[] = Array.from({ length: 4 }, (_, index) => ({
        id: `camera.test_${index}`,
        enabled: true,
        available: true,
        motionDetection: { enabled: false, mode: 'objects' },
      }));
      motion.sync(cameras);
      await motion.tick();
      expect(streams).toBe(0);
      cameras.forEach((camera) => {
        camera.motionDetection!.enabled = true;
      });
      await motion.tick();
      expect(weak.jobs.size).toBe(1);
      expect(strong.jobs.size).toBe(2);
      expect(streams).toBe(3);
      await motion.tick();
      expect(detections).toBe(3);
      at += 4000;
      await motion.tick();
      expect(detections).toBe(3);
      weak.failed = true;
      const replacement = await addNode('replacement', 2);
      await motion.tick();
      expect(weak.jobs.size).toBe(0);
      expect(replacement.jobs.size).toBe(2);
      cameras.forEach((camera) => {
        camera.motionDetection!.enabled = false;
      });
      await motion.tick();
      expect(motion.jobs.size).toBe(0);
      expect(warm.leases.size).toBe(0);
    } finally {
      await motion.stop();
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.closeAllConnections();
              server.close(() => resolve());
            }),
        ),
      );
    }
  });
});
