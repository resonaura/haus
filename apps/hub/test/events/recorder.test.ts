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

  it('uses localBuffers and recordingInput when captureEnabled() returns false', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-recorder-standalone-'));
    const media = join(root, 'media');
    await mkdir(media, { recursive: true });
    const source = await openCatalog(join(root, 'haus.sqlite'));
    const transactions = new Transactions(source);
    const store = new RecordingStore(source, media, transactions);

    let captureSyncCalls = 0;
    let captureRecordCalls = 0;
    const captureBuffers = new Map();
    const mockCapture = {
      buffers: captureBuffers,
      events: new Set<string>(),
      sync: () => {
        captureSyncCalls += 1;
      },
      record: async (event: { id: string }) => {
        captureRecordCalls += 1;
        return event as never;
      },
      finalize: async () => {},
    };

    const requestedInputs: string[] = [];
    const config: RecorderConfig = {
      data: root,
      media,
      pre_roll_seconds: 1,
      post_roll_seconds: 1,
      max_event_seconds: 5,
      max_storage_gb: 1,
      max_buffer_gb: 1,
      recording_enabled: true,
      token: null,
      record_audio: false,
    };

    const recorder = new Recorder(
      config,
      {
        recordingInput: async (camera) => {
          requestedInputs.push(camera.id);
          return {
            url: 'rtsp://127.0.0.1:1/standalone',
            kind: 'rtsp',
            inputArguments: ['-rtsp_transport', 'tcp'],
          };
        },
      },
      store,
      undefined,
      {
        capture: mockCapture as never,
        captureEnabled: () => false,
      },
    );

    try {
      recorder.sync([
        {
          id: 'camera.standalone_test',
          enabled: true,
          available: true,
          independentSource: true,
          kitsuneSource: { url: 'rtsp://127.0.0.1:1/standalone', kind: 'rtsp' },
          motionDetection: { enabled: true, mode: 'motion' },
        },
      ]);

      expect(captureSyncCalls).toBe(0);
      expect(recorder.buffers.has('camera.standalone_test')).toBe(true);
      expect(captureBuffers.has('camera.standalone_test')).toBe(false);

      const event = await recorder.trigger('camera.standalone_test', 'motion', 'eufy:motion');
      expect(event.cameraId).toBe('camera.standalone_test');
      expect(event.kinds).toContain('motion');
      expect(captureRecordCalls).toBe(0);
      await new Promise((r) => setTimeout(r, 50));
      expect(requestedInputs).toContain('camera.standalone_test');
    } finally {
      await recorder.stop();
      await store.close();
      await transactions.drain();
      if (source.isInitialized) await source.destroy();
      await rm(root, { recursive: true, force: true });
    }
  });
});
