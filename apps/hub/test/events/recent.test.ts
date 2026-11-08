/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import {
  RecentPlayback,
  type PlaybackEventLike,
  type PlaybackPreparationOptions,
  type RecentPlaybackCluster,
  type RecentPlaybackEvent,
  type RecentPlaybackRecorder,
} from '../../src/events/playback.js';
import { RecordingStore } from '../../src/events/recording.store.js';
import { openCatalog, RetentionCatalog, Transactions } from '../../src/storage/index.js';

interface TestFixtureStore {
  store: RecordingStore;
  source: DataSource;
  catalog: RetentionCatalog;
  close: () => Promise<void>;
}

async function openFixtureStore(): Promise<TestFixtureStore> {
  const root = await mkdtemp(join(tmpdir(), 'haus-recent-playback-'));
  await mkdir(join(root, 'media'));
  const dbPath = join(root, 'haus.sqlite');
  const source = await openCatalog(dbPath);
  const transactions = new Transactions(source);
  const store = new RecordingStore(source, join(root, 'media'), transactions);
  const catalog = new RetentionCatalog(transactions);
  return {
    store,
    source,
    catalog,
    close: async () => {
      await store.close();
      await transactions.drain();
      if (source.isInitialized) await source.destroy();
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function queryRows(
  source: DataSource,
  sql: string,
  ...parameters: unknown[]
): Promise<Array<Record<string, unknown>>> {
  if (!parameters.length && sql.includes(';')) {
    let result: Array<Record<string, unknown>> = [];
    for (const statement of sql.split(';').filter((value) => value.trim())) {
      result = (await source.manager.query(statement)) as Array<Record<string, unknown>>;
    }
    return result;
  }
  return (await source.manager.query(sql, parameters)) as Array<Record<string, unknown>>;
}

interface TestRecorder extends RecentPlaybackRecorder {
  stopped?: boolean;
  playbackJobs: Map<string, unknown>;
  encoding: { activeWork?: unknown; pending: unknown[] };
  cameras: Array<{ id: string; enabled: boolean; available?: boolean }>;
  preparePlayback: (
    event: PlaybackEventLike,
    priority: number,
    options?: PlaybackPreparationOptions,
  ) => Promise<unknown>;
}

async function createFixture() {
  let at = 100000;
  const events = Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    cameraId: i < 3 ? 'camera.a' : 'camera.b',
    playbackVersion: 0,
  }));
  const calls: Array<{ id: string; priority?: number; options?: PlaybackPreparationOptions }> = [];
  const { store, source, catalog, close } = await openFixtureStore();
  for (const [i, event] of events.entries()) {
    await queryRows(
      source,
      'INSERT INTO events(id,camera_id,start_at,end_at,status,kinds,detections,playback_version)VALUES(?,?,?,?,?,?,?,?)',
      event.id,
      event.cameraId,
      1000 - i,
      3000 - i,
      'ready',
      '[]',
      '[]',
      0,
    );
  }
  const recorder: TestRecorder = {
    playbackJobs: new Map(),
    encoding: { pending: [] },
    cameras: ['camera.a', 'camera.b'].map((id) => ({
      id,
      enabled: true,
      available: true,
    })),
    preparePlayback: async (event, priority, options) => {
      calls.push({ id: event.id, priority, options });
      await queryRows(source, 'UPDATE events SET playback_version=4 WHERE id=?', event.id);
    },
  };
  const cluster: RecentPlaybackCluster = { canPreparePlayback: () => true };
  const recent = new RecentPlayback(store, recorder, cluster, { catalog, now: () => at });
  return {
    events,
    store,
    source,
    calls,
    recorder,
    cluster,
    recent,
    catalog,
    close,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

describe('RecentPlayback', () => {
  it('drains the bounded pending page beyond the last two clips per camera', async () => {
    const f = await createFixture();
    try {
      for (let i = 0; i < 10; i++) await f.recent.tick();
      expect(f.calls.map((x) => x.id)).toEqual(['0', '1', '2', '3', '4', '5']);
      expect(f.calls.every((x) => (x.priority ?? 0) < 0 && x.options?.remoteOnly === true)).toBe(
        true,
      );
    } finally {
      await f.close();
    }
  });

  it('yields background admission to foreground work and never runs on unavailable or unreplicated workers', async () => {
    const f = await createFixture();
    try {
      f.cluster.canPreparePlayback = () => false;
      await f.recent.tick();
      expect(f.calls.length).toBe(0);
      f.cluster.canPreparePlayback = () => true;
      for (const reason of ['foreground', 'finalizing', 'disabled', 'stopped'] as const) {
        f.recorder.playbackJobs.clear();
        f.recorder.encoding.activeWork = null;
        f.recorder.stopped = false;
        f.recorder.cameras.forEach((c) => {
          c.available = true;
          c.enabled = true;
        });
        if (reason === 'foreground') f.recorder.playbackJobs.set('selected', {});
        if (reason === 'finalizing') f.recorder.encoding.activeWork = {};
        if (reason === 'disabled') f.recorder.cameras.forEach((c) => (c.enabled = false));
        if (reason === 'stopped') f.recorder.stopped = true;
        await f.recent.tick();
        expect(f.calls.length).toBe(0);
      }
    } finally {
      await f.close();
    }
  });

  it('creates one task at a time on a slow or failed worker with a bounded retry interval', async () => {
    const f = await createFixture();
    try {
      let finish!: () => void;
      let entered!: () => void;
      let entry = new Promise<void>((resolve) => {
        entered = resolve;
      });
      f.recorder.preparePlayback = async (event) => {
        f.calls.push({ id: event.id });
        entered();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        throw new Error('worker_unavailable');
      };
      const first = f.recent.tick();
      await entry;
      await f.recent.tick();
      expect(f.calls.map((c) => c.id)).toEqual(['0']);
      finish();
      await first;
      entry = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const second = f.recent.tick();
      await entry;
      expect(f.calls.map((c) => c.id)).toEqual(['0', '1']);
      finish();
      await second;
      f.recorder.preparePlayback = async (event) => {
        f.calls.push({ id: event.id });
        throw new Error('worker_unavailable');
      };
      await f.recent.tick();
      await f.recent.tick();
      await f.recent.tick();
      await f.recent.tick();
      await f.recent.tick();
      expect(f.calls.map((c) => c.id)).toEqual(['0', '1', '2', '3', '4', '5']);
      f.advance(60000);
      await f.recent.tick();
      expect(f.calls.at(-1)?.id).toBe('0');
    } finally {
      await f.close();
    }
  });

  it('ensures prepared recent rows do not bury old pending media or unsafe original markers', async () => {
    const { store, catalog, close } = await openFixtureStore();
    try {
      for (let i = 0; i < 70; i++) {
        const event = await store.create('camera.a', 'motion', 1000 + i, 3000 + i);
        await store.finish(event.id, { duration: 2, bytes: 1, playbackVersion: 4 });
      }
      const unsafe = await store.create('camera.a', 'motion', 100, 200);
      await store.finish(unsafe.id, { duration: 1, bytes: 1, playbackVersion: 4 });
      await store.setPlayback(unsafe.id, 0, 4, { originalCompatible: true });
      const calls: string[] = [];
      const recorder: TestRecorder = {
        stopped: false,
        playbackJobs: new Map(),
        encoding: { pending: [] },
        cameras: [{ id: 'camera.a', enabled: true, available: true }],
        preparePlayback: async (event) => {
          calls.push(event.id);
        },
      };
      const recent = new RecentPlayback(
        store,
        recorder,
        { canPreparePlayback: () => true },
        { catalog },
      );
      await recent.tick();
      expect(calls).toEqual([unsafe.id]);
    } finally {
      await close();
    }
  });

  it('prepares an offline camera retained local footage without waking its source while keeping disabled cameras and archived originals untouched', async () => {
    const f = await createFixture();
    const disabled = await createFixture();
    const archived = await createFixture();
    try {
      f.recorder.cameras.forEach((camera) => {
        camera.available = false;
      });
      await f.recent.tick();
      expect(f.calls.length).toBe(1);

      disabled.recorder.cameras.forEach((camera) => {
        camera.enabled = false;
      });
      await disabled.recent.tick();
      expect(disabled.calls.length).toBe(0);

      await queryRows(archived.source, 'UPDATE events SET local_original=0');
      await archived.recent.tick();
      expect(archived.calls.length).toBe(0);
    } finally {
      await f.close();
      await disabled.close();
      await archived.close();
    }
  });

  it('prevents 64 unadmitted recent clips from hiding older playable local footage', async () => {
    const { store, catalog, close } = await openFixtureStore();
    try {
      for (let i = 0; i < 64; i++) {
        const e = await store.create('camera.disabled', 'motion', 2000 + i, 3000 + i);
        await store.finish(e.id, { duration: 1, bytes: 1 });
      }
      const old = await store.create('camera.enabled', 'motion', 1000, 2000);
      await store.finish(old.id, { duration: 1, bytes: 1 });
      const calls: string[] = [];
      const recorder: TestRecorder = {
        playbackJobs: new Map(),
        encoding: { pending: [] },
        cameras: [
          { id: 'camera.disabled', enabled: false },
          { id: 'camera.enabled', enabled: true },
        ],
        preparePlayback: async (e) => {
          calls.push(e.id);
          await store.finish(e.id, { duration: 1, bytes: 1, playbackVersion: 4 });
        },
      };
      const recent = new RecentPlayback(
        store,
        recorder,
        { canPreparePlayback: () => true },
        { catalog, now: () => 100000 },
      );
      await recent.tick();
      await recent.tick();
      expect(calls).toEqual([old.id]);
    } finally {
      await close();
    }
  });

  it('yields slow repeated failures to unattempted old clips', async () => {
    const { store, catalog, close } = await openFixtureStore();
    try {
      let at = 100000;
      for (let i = 0; i < 64; i++) {
        const e = await store.create('camera.bad', 'motion', 2000 + i, 3000 + i);
        await store.finish(e.id, { duration: 1, bytes: 1 });
      }
      const old = await store.create('camera.good', 'motion', 1000, 2000);
      await store.finish(old.id, { duration: 1, bytes: 1 });
      const calls: string[] = [];
      const recorder: TestRecorder = {
        playbackJobs: new Map(),
        encoding: { pending: [] },
        cameras: [
          { id: 'camera.bad', enabled: true },
          { id: 'camera.good', enabled: true },
        ],
        preparePlayback: async (e) => {
          calls.push(e.id);
          const candidate = e as RecentPlaybackEvent;
          if (candidate.cameraId === 'camera.bad') {
            at += 61000;
            throw new Error('worker_unavailable');
          }
          await store.finish(e.id, { duration: 1, bytes: 1, playbackVersion: 4 });
        },
      };
      const recent = new RecentPlayback(
        store,
        recorder,
        { canPreparePlayback: () => true },
        { catalog, now: () => at },
      );
      for (let i = 0; i < 65; i++) await recent.tick();
      expect(calls.at(-1)).toBe(old.id);
      expect(new Set(calls).size).toBe(65);
    } finally {
      await close();
    }
  });

  it('preserves background retry cooldown across a controller restart while keeping new footage first', async () => {
    const f = await createFixture();
    try {
      f.recorder.preparePlayback = async (event) => {
        f.calls.push({ id: event.id });
        throw new Error('worker_unavailable');
      };
      await f.recent.tick();
      expect(f.calls.map((c) => c.id)).toEqual(['0']);
      const restarted = new RecentPlayback(f.store, f.recorder, f.cluster, {
        catalog: f.catalog,
        now: () => 100000,
      });
      await restarted.tick();
      expect(f.calls.map((c) => c.id)).toEqual(['0', '1']);
      const added = await f.store.create('camera.a', 'motion', 2000, 3000);
      await f.store.finish(added.id, { duration: 1, bytes: 1 });
      await restarted.tick();
      expect(f.calls.at(-1)?.id).toBe(added.id);
      expect(f.calls.filter((c) => c.id === '0').length).toBe(1);
    } finally {
      await f.close();
    }
  });

  it('drops prepared, archived and expired rows from retry bookkeeping without changing footage metadata', async () => {
    const f = await createFixture();
    try {
      f.cluster.canPreparePlayback = () => false;
      await f.recent.tick();
      const initialCount = (
        await queryRows(f.source, 'SELECT count(*) AS n FROM background_preparation_attempts')
      )[0];
      expect(Number(initialCount?.n)).toBe(6);
      await queryRows(
        f.source,
        "UPDATE events SET playback_version=4 WHERE id='0'; UPDATE events SET local_original=0 WHERE id='1'; DELETE FROM events WHERE id='2'",
      );
      const before = await queryRows(f.source, 'SELECT * FROM events ORDER BY id');
      await f.recent.tick();
      const afterCount = (
        await queryRows(f.source, 'SELECT count(*) AS n FROM background_preparation_attempts')
      )[0];
      expect(Number(afterCount?.n)).toBe(3);
      expect(await queryRows(f.source, 'SELECT * FROM events ORDER BY id')).toEqual(before);
    } finally {
      await f.close();
    }
  });
});
