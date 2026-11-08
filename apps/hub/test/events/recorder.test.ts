/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  DefaultEventsService,
  MediaQueue,
  parseSegments,
  Recorder,
  RecordingStore,
  type RecorderConfig,
} from '../../src/events/index.js';
import { openCatalog } from '../../src/storage/source.js';
import { Transactions } from '../../src/storage/transactions.js';

describe('recorder lifecycle and Nest EventsService integration', () => {
  it('parses sequential and legacy CSV segment lists while deduplicating overwritten paths', () => {
    const csv = [
      'b1700000000000-a1b2c3d4-000000001.mp4,0.000000,2.000000',
      'b1700000000000-a1b2c3d4-000000001.mp4,0.000000,2.500000',
      '20261107T120000.mp4,0.000000,1.500000',
      'invalid-row,1,2',
    ].join('\n');
    const segments = parseSegments(csv, '/tmp/buffer');
    expect(segments.length).toBe(2);
    expect(segments[0]).toEqual({
      path: '/tmp/buffer/b1700000000000-a1b2c3d4-000000001.mp4',
      start: 1700000000000,
      end: 1700000002500,
    });
    expect(segments[1]?.path).toBe('/tmp/buffer/20261107T120000.mp4');
  });

  it('orders MediaQueue work by priority, promotes queued keys, and rejects on stop', async () => {
    const queue = new MediaQueue(4);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = queue.run(
      () =>
        new Promise<string>((resolve) => {
          releaseFirst = () => {
            order.push('first');
            resolve('first');
          };
        }),
      10,
      'first',
    );
    const low = queue.run(
      async () => {
        order.push('low');
        return 'low';
      },
      5,
      'low',
    );
    const promoted = queue.run(
      async () => {
        order.push('promoted');
        return 'promoted';
      },
      1,
      'promoted',
    );
    queue.promote('promoted', 20);
    releaseFirst();
    await Promise.all([first, low, promoted]);
    expect(order).toEqual(['first', 'promoted', 'low']);
    queue.stop();
    await expect(queue.run(async () => 'after')).rejects.toThrow('media_stopped');
  });

  it('persists triggered recordings through Nest DefaultEventsService and Recorder with serialized camera triggers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-nest-recorder-'));
    const media = join(root, 'media');
    await mkdir(media, { recursive: true });
    const source = await openCatalog(join(root, 'haus.sqlite'));
    const transactions = new Transactions(source);
    const store = new RecordingStore(source, media, transactions);

    const config: RecorderConfig = {
      data: root,
      media,
      recording_enabled: true,
      record_audio: false,
      pre_roll_seconds: 6,
      post_roll_seconds: 10,
      max_event_seconds: 60,
      max_storage_gb: 1,
      max_buffer_gb: 1,
    };

    const recorder = new Recorder(config, {}, store, () => {}, {
      capture: {
        events: new Set<string>(),
        buffers: new Map(),
        sync: () => {},
        record: async () => {},
        finalize: async () => {},
      },
    });
    recorder.sync([{ id: 'camera.front', enabled: true, available: true }]);

    const eventsService = new DefaultEventsService(store, undefined, recorder);

    try {
      const [first, second] = await Promise.all([
        eventsService.trigger('camera.front', 'motion', 'sensor.motion_1', 1000),
        eventsService.trigger('camera.front', 'person', 'sensor.person_1', 2000),
      ]);
      expect((first as { id: string }).id).toBe((second as { id: string }).id);
      const saved = (await eventsService.get((first as { id: string }).id)) as {
        id: string;
        kinds: string[];
        endAt: number;
      };
      expect(saved.kinds).toEqual(['motion', 'person']);
      expect(saved.endAt).toBe(12000);
    } finally {
      await recorder.stop();
      await store.close();
      await transactions.drain();
      if (source.isInitialized) await source.destroy();
      await rm(root, { recursive: true, force: true });
    }
  });
});
