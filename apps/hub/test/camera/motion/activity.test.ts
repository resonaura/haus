/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import {
  AutonomousActivity,
  type ActivityEventPayload,
  type AnalysisNode,
  type AnalysisNodeHealth,
  type MotionCamera,
} from '../../../src/camera/motion/index.js';
import { RecordingStore } from '../../../src/events/recording.store.js';
import { CameraCatalog, openCatalog, Transactions } from '../../../src/storage/index.js';

const defaultConfig = {
  recording_enabled: true,
  record_audio: true,
  pre_roll_seconds: 4,
  post_roll_seconds: 8,
  max_event_seconds: 120,
};

async function openActivityStore(root: string): Promise<{
  store: RecordingStore;
  source: DataSource;
  cameraCatalog: CameraCatalog;
  close: () => Promise<void>;
}> {
  await mkdir(join(root, 'media'), { recursive: true });
  const database = join(root, 'db.sqlite');
  const source = await openCatalog(database);
  const transactions = new Transactions(source);
  const store = new RecordingStore(source, join(root, 'media'), transactions);
  const cameraCatalog = new CameraCatalog(transactions);
  await cameraCatalog.initialize();
  return {
    store,
    source,
    cameraCatalog,
    close: async () => {
      await store.close();
      await transactions.drain();
      if (source.isInitialized) await source.destroy();
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function queryOne(source: DataSource, sql: string): Promise<Record<string, unknown>> {
  const rows = (await source.manager.query(sql)) as Array<Record<string, unknown>>;
  return rows[0] ?? {};
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('AutonomousActivity controller', () => {
  it('restores a full assigned worker, fences new-event adoption and unifies retried native triggers without command replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-activity-controller-'));
    const { store, cameraCatalog, close } = await openActivityStore(root);
    let at = Date.now();
    const camera: MotionCamera = {
      id: 'camera.fixture',
      enabled: true,
      available: true,
      motionDetection: { enabled: true, mode: 'objects' },
      playbackSource: { platform: 'mqtt', manufacturer: 'Aqara' },
    };
    const registry = {
      cameras: [camera],
      states: [
        {
          entity_id: 'sensor.fixture_p2p_rtsp_stream',
          state: 'rtsp://u:private@192.168.1.9:8556/live',
        },
      ],
      entities: [],
    };
    const nodes: AnalysisNode[] = [
      { id: 'a', url: 'https://a.invalid', key: 'fixture-a', enabled: true, roles: ['stream'] },
      { id: 'b', url: 'https://b.invalid', key: 'fixture-b', enabled: true, roles: ['stream'] },
    ];
    const cluster = {
      nodes: () => nodes,
      health: new Map<string, AnalysisNodeHealth>(
        nodes.map((node) => [
          node.id,
          {
            online: true,
            remote: {
              features: { autonomousCameraActivity: 1 },
              cameraActivity: { cameras: [] },
            },
          },
        ]),
      ),
    };
    const sessions = {
      registry: () => registry,
      camera: (id: string) => registry.cameras.find((item) => item.id === id),
      advertiseHost: async () => '192.168.1.5',
    };
    const plans = new Map<string, Array<Record<string, unknown>>>();
    const requests: Array<{ node: string; path: string; method?: string }> = [];
    const captures = new Map<string, string>();
    let lostAck = true;
    let interrupted: Array<{ event: ActivityEventPayload; state: string; error: string }> = [];
    let holdNextPut = false;
    const putStarted = deferred();
    const releasePut = deferred();

    const json = async (
      node: AnalysisNode,
      path: string,
      options: { method?: string; data?: unknown } = {},
    ) => {
      requests.push({ node: node.id, path, method: options.method });
      if (path === '/v1/camera-activity/interrupted') {
        return { items: interrupted };
      }
      if (path.startsWith('/v1/camera-activity/interrupted/') && options.method === 'POST') {
        interrupted = interrupted.filter((value) => value.event.id !== path.split('/').at(-1));
        return { acknowledged: true };
      }
      if (path === '/v1/camera-activity/trigger') {
        const triggerData = options.data as { requestId: string };
        if (!captures.has(triggerData.requestId)) {
          captures.set(triggerData.requestId, randomUUID());
        }
        if (lostAck) {
          lostAck = false;
          throw new Error('ack_lost');
        }
        return { recordedEventId: captures.get(triggerData.requestId) };
      }
      if (options.method === 'PUT') {
        const payload = options.data as { cameras: Array<Record<string, unknown>> };
        if (holdNextPut && payload.cameras.length) {
          holdNextPut = false;
          putStarted.resolve();
          await releasePut.promise;
        }
        plans.set(node.id, payload.cameras);
        cluster.health.get(node.id)!.remote!.cameraActivity = {
          cameras: payload.cameras.map((plan) => ({
            ...(plan as { cameraId: string; policyId: string; expiresAt: number }),
            admitted: true,
            ready: true,
            state: 'running',
            calibrated: true,
            lastResultAt: at,
            events: [],
          })),
        };
      }
      return cluster.health.get(node.id)!.remote!.cameraActivity;
    };

    let activity = new AutonomousActivity({
      store,
      catalog: cameraCatalog,
      config: { ...defaultConfig },
      cluster,
      sessions,
      now: () => at,
      json,
    });

    try {
      camera.motionDetection!.enabled = false;
      await expect(activity.ensure(camera, nodes[0]!)).rejects.toThrow(/unavailable/);
      expect(requests.length).toBe(0);

      camera.motionDetection!.enabled = true;
      const first = await activity.ensure(camera, nodes[0]!);
      expect((plans.get('a')?.[0]?.source as { kind?: string } | undefined)?.kind).toBe(
        'p2p-restream',
      );
      expect((first as { mode?: string }).mode).toBe('objects');
      expect(activity.priorNode(camera)?.id).toBe('a');

      await activity.stop();
      activity = new AutonomousActivity({
        store,
        catalog: cameraCatalog,
        config: { ...defaultConfig },
        cluster,
        sessions,
        now: () => at,
        json,
      });
      expect(activity.priorNode(camera)?.id).toBe('a');
      expect((await activity.ensure(camera, nodes[0]!)).policyId).toBe(first.policyId);

      const event: ActivityEventPayload = {
        id: randomUUID(),
        cameraId: camera.id,
        startAt: at,
        endAt: at + 20000,
        kinds: ['person'],
        origin: { kind: 'camera-activity', policyId: first.policyId },
      };
      expect(activity.authorizes(nodes[0]!, { event })).toBe(true);
      expect(activity.authorizes(nodes[1]!, { event })).toBe(false);
      expect(
        activity.authorizes(nodes[0]!, {
          event: { ...event, origin: { ...event.origin, policyId: randomUUID() } },
        }),
      ).toBe(false);
      expect(
        activity.authorizes(nodes[0]!, {
          event: { ...event, startAt: at - 86400000 },
        }),
      ).toBe(false);

      expect(activity.triggerNative(camera.id, 'person', 'native-camera-person', at)).toBe(true);
      await activity.flushing;
      await activity.queuedTriggers;
      await activity.flushTriggers();
      expect(cameraCatalog.activity.triggers().length).toBe(1);
      await activity.flushTriggers();
      expect(captures.size).toBe(1);
      expect(cameraCatalog.activity.triggers().length).toBe(0);
      expect(requests.filter((r) => r.path.endsWith('/trigger')).length).toBe(2);

      camera.available = false;
      await activity.sync();
      expect(plans.get('a')?.length).toBe(1);

      camera.motionDetection!.enabled = false;
      at += 1000;
      await activity.sync();
      expect(plans.get('a')?.length).toBe(0);
      expect(activity.active(camera.id)).toBeUndefined();
      expect(activity.authorizes(nodes[0]!, { event })).toBe(true);
      expect(
        activity.authorizes(nodes[0]!, {
          event: { ...event, startAt: at + 1, endAt: at + 20000 },
        }),
      ).toBe(false);
      expect(activity.triggerNative(camera.id, 'person', 'native-camera-person', at)).toBe(false);

      const failedEvent: ActivityEventPayload = { ...event, id: randomUUID() };
      interrupted = [{ event: failedEvent, state: 'interrupted', error: 'node_restarted' }];
      await activity.recoverInterrupted();
      const failed = await store.get(failedEvent.id);
      expect(failed?.status).toBe('interrupted');
      expect(failed?.bytes).toBe(0);
      expect(failed?.localOriginal).toBe(false);
      expect(interrupted.length).toBe(0);

      camera.motionDetection!.enabled = true;
      await activity.ensure(camera, nodes[0]!);
      holdNextPut = true;
      const updating = activity.syncNode(nodes[0]!, true);
      await putStarted.promise;
      const removing = activity.clearNode(nodes[0]!.id);
      await expect(activity.ensure(camera, nodes[0]!)).rejects.toThrow(/unavailable/);
      releasePut.resolve();
      await updating;
      await removing;
      expect(plans.get('a')?.length).toBe(0);
      expect(activity.active(camera.id)).toBeUndefined();
    } finally {
      await activity.stop();
      await close();
    }
  });

  async function createHandoffFixture() {
    const root = await mkdtemp(join(tmpdir(), 'haus-activity-handoff-'));
    const { store, source, cameraCatalog, close } = await openActivityStore(root);
    const at = Date.now();
    const camera: MotionCamera = {
      id: 'camera.fixture',
      enabled: true,
      motionDetection: { enabled: true, mode: 'objects' },
    };
    const nodes: AnalysisNode[] = ['a', 'b'].map((id) => ({
      id,
      url: `https://${id}.invalid`,
      key: `fixture-${id}`,
      enabled: true,
      roles: ['stream'],
    }));
    const cluster = {
      nodes: () => nodes,
      health: new Map<string, AnalysisNodeHealth>(
        nodes.map((node) => [
          node.id,
          {
            online: true,
            remote: {
              features: { autonomousCameraActivity: 1 },
              cameraActivity: { cameras: [] },
            },
          },
        ]),
      ),
    };
    const registry = {
      cameras: [camera],
      entities: [],
      states: [
        {
          entity_id: 'sensor.fixture_p2p_rtsp_stream',
          state: 'rtsp://192.168.1.9:8556/live',
        },
      ],
    };
    const plans = new Map<string, Array<Record<string, unknown>>>();
    const calls: Array<{
      node: string;
      path: string;
      method?: string;
      data?: { cameras: Array<Record<string, unknown>> };
    }> = [];
    const hooks: {
      beforePut?: (
        node: AnalysisNode,
        plans: Array<Record<string, unknown>>,
      ) => Promise<void> | void;
      afterPut?: (
        node: AnalysisNode,
        plans: Array<Record<string, unknown>>,
      ) => Promise<void> | void;
    } = {};

    const options = {
      store,
      catalog: cameraCatalog,
      config: { ...defaultConfig },
      cluster,
      now: () => at,
      sessions: {
        registry: () => registry,
        camera: (id: string) => registry.cameras.find((c) => c.id === id),
        advertiseHost: async () => '192.168.1.5',
      },
      json: async (
        node: AnalysisNode,
        path: string,
        input: { method?: string; data?: unknown } = {},
      ) => {
        const data = input.data as { cameras: Array<Record<string, unknown>> } | undefined;
        calls.push({ node: node.id, path, method: input.method, data });
        if (input.method === 'PUT' && data) {
          await hooks.beforePut?.(node, data.cameras);
          plans.set(node.id, data.cameras);
          cluster.health.get(node.id)!.remote!.cameraActivity!.cameras = data.cameras.map((p) => ({
            ...(p as { cameraId: string; policyId: string; expiresAt: number }),
            admitted: true,
            ready: true,
            state: 'running',
          }));
          await hooks.afterPut?.(node, data.cameras);
        }
        if (path.endsWith('/interrupted')) return { items: [] };
        return cluster.health.get(node.id)!.remote!.cameraActivity;
      },
    };
    let activity = new AutonomousActivity(options);
    return {
      camera,
      nodes,
      cluster,
      plans,
      calls,
      hooks,
      store,
      source,
      activityCatalog: cameraCatalog.activity,
      at,
      get activity() {
        return activity;
      },
      async restart() {
        await activity.stop();
        activity = new AutonomousActivity(options);
        return activity;
      },
      async close() {
        await activity.stop();
        await close();
      },
    };
  }

  it('drains a late old refresh on reachable activity handoff before admitting its replacement', async () => {
    const f = await createHandoffFixture();
    try {
      const first = await f.activity.ensure(f.camera, f.nodes[0]!);
      expect(f.activity.active(f.camera.id)?.nodeId).toBe('a');
      const entered = deferred();
      const release = deferred();
      let hold = true;
      f.hooks.beforePut = async (node, nodePlans) => {
        if (hold && node.id === 'a' && nodePlans.length) {
          hold = false;
          entered.resolve();
          await release.promise;
        }
      };
      const refreshing = f.activity.syncNode(f.nodes[0]!, true);
      await entered.promise;
      const moving = f.activity.ensure(f.camera, f.nodes[1]!);
      await Promise.resolve();
      await Promise.resolve();
      expect(f.plans.has('b')).toBe(false);
      release.resolve();
      await refreshing;
      const replacement = await moving;
      expect(replacement.policyId).not.toBe(first.policyId);
      const oldClear = f.calls.findIndex(
        (c) => c.node === 'a' && c.method === 'PUT' && !c.data?.cameras.length,
      );
      const newStart = f.calls.findIndex(
        (c) => c.node === 'b' && c.method === 'PUT' && Boolean(c.data?.cameras.length),
      );
      expect(oldClear >= 0 && newStart > oldClear).toBe(true);
      expect(f.plans.get('a')?.length).toBe(0);
      expect(f.plans.get('b')?.length).toBe(1);
      expect(f.activityCatalog.releases(f.camera.id).length).toBe(0);
    } finally {
      await f.close();
    }
  });

  it('preserves lost revocation acknowledgements across controller restart and clears offline owners when they rejoin', async () => {
    const f = await createHandoffFixture();
    try {
      await f.activity.ensure(f.camera, f.nodes[0]!);
      let fail = true;
      f.hooks.afterPut = (node, nodePlans) => {
        if (fail && node.id === 'a' && !nodePlans.length) throw new Error('ack_lost');
      };
      await expect(f.activity.ensure(f.camera, f.nodes[1]!)).rejects.toThrow(/ack_lost/);
      expect(f.plans.has('b')).toBe(false);
      expect(
        Number((await queryOne(f.source, 'SELECT count(*) n FROM nvr_activity_releases')).n),
      ).toBe(1);
      await f.restart();
      fail = false;
      await f.activity.ensure(f.camera, f.nodes[1]!);
      expect(f.plans.get('a')?.length).toBe(0);
      f.cluster.health.get('b')!.online = false;
      const prior = f.activity.active(f.camera.id);
      await f.activity.ensure(f.camera, f.nodes[0]!);
      expect(
        Number((await queryOne(f.source, 'SELECT count(*) n FROM nvr_activity_releases')).n),
      ).toBe(1);
      expect(f.plans.get('b')?.length).toBe(1);
      expect(
        f.activity.authorizes(f.nodes[1]!, {
          event: {
            id: randomUUID(),
            cameraId: f.camera.id,
            origin: { kind: 'camera-activity', policyId: prior?.policyId },
            startAt: f.at + 1,
            endAt: f.at + 10000,
            kinds: ['person'],
          },
        }),
      ).toBe(false);
      f.cluster.health.get('b')!.online = true;
      await f.activity.sync();
      expect(f.plans.get('b')?.length).toBe(0);
      expect(f.plans.get('a')?.length).toBe(1);
      expect(
        Number((await queryOne(f.source, 'SELECT count(*) n FROM nvr_activity_releases')).n),
      ).toBe(0);
    } finally {
      await f.close();
    }
  });
});
