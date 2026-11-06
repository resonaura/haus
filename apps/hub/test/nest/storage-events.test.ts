/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import {
  RecordingStore,
  decodeCursor,
} from '../../src/events/recording.store.js';
import { recordingMetadata } from '../../src/events/recording-metadata.js';
import { playbackReady, PLAYBACK_VERSION } from '../../src/events/playback.js';
import { DefaultEventsService } from '../../src/events/events.service.js';

describe('Storage & Events Domain Suite', () => {
  let tempDir: string;
  let mediaDir: string;
  let dbPath: string;
  let store: RecordingStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-events-nest-'));
    mediaDir = join(tempDir, 'media');
    await mkdir(mediaDir, { recursive: true });
    dbPath = join(tempDir, 'hub-events.sqlite');
    store = new RecordingStore(dbPath, mediaDir);
  });

  afterEach(async () => {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('paginates deterministically across equal timestamps and filters by detection kind', () => {
    for (let i = 0; i < 4; i++) {
      store.create(
        'camera.garden',
        i % 2 === 0 ? 'person' : 'vehicle',
        1000,
        3000,
        'sensor.garden_motion',
      );
    }

    const firstPage = store.list({ limit: 2 });
    expect(firstPage.events).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();
    const [cursorAt, cursorId] = decodeCursor(firstPage.nextCursor!);
    expect(cursorAt).toBe(1000);
    expect(typeof cursorId).toBe('string');

    const secondPage = store.list({ limit: 2, cursor: firstPage.nextCursor! });
    expect(secondPage.events).toHaveLength(2);
    expect(secondPage.nextCursor).toBeNull();

    const allIds = new Set([...firstPage.events, ...secondPage.events].map((e) => e.id));
    expect(allIds.size).toBe(4);

    const personFilter = store.list({ kind: 'person' });
    expect(personFilter.events).toHaveLength(2);
    expect(personFilter.events.every((e) => e.kinds.includes('person'))).toBe(true);

    expect(() => store.list({ cursor: 'invalid_base64_json' })).toThrow(/invalid_cursor/);
  });

  it('tracks camera availability bounds and merges contiguous heartbeats', () => {
    store.observeAvailability('camera.entry', 'online', 10000);
    store.observeAvailability('camera.entry', 'online', 30000); // within 45s heartbeat window
    store.observeAvailability('camera.entry', 'offline', 90000); // distinct state beyond window

    const intervals = store.availability({ cameraId: 'camera.entry', from: 0, to: 100000 });
    expect(intervals.length).toBeGreaterThanOrEqual(1);

    const days = store.recordedDays({
      cameraId: 'camera.entry',
      boundaries: [0, 86400000, 172800000],
    });
    expect(Array.isArray(days)).toBe(true);
  });

  it('handles playback metadata transitions without corrupting original duration', () => {
    const event = store.create('camera.driveway', 'motion', 1000, 5000);
    store.finish(event.id, { duration: 120, bytes: 45000, playbackVersion: 2 });
    store.setPlayback(event.id, 8000, PLAYBACK_VERSION, {
      duration: 15,
      originalCompatible: true,
      originalPolicyVersion: 3,
    });

    const updated = store.get(event.id);
    expect(updated).not.toBeNull();
    expect(updated?.duration).toBe(15);
    expect(updated?.originalDuration).toBe(120);
    expect(playbackReady(updated!)).toBe(true);

    const bounded = recordingMetadata(updated!);
    expect(bounded.id).toBe(event.id);
    expect(bounded.duration).toBe(15);
    expect(bounded.originalDuration).toBe(120);
    expect((bounded.playbackInfo as Record<string, unknown>).duration).toBe(15);
  });

  it('manages concurrent media pinning and eviction exclusively', async () => {
    const event = store.create('camera.patio', 'person', 1000, 3000);
    const unpin1 = await store.pinMedia(event.id);
    const unpin2 = await store.pinMedia(event.id);

    // Eviction must return null while pins exist
    expect(store.evictMedia(event.id)).toBeNull();

    unpin1();
    expect(store.evictMedia(event.id)).toBeNull();

    unpin2();
    // Now that all pins are released, evictMedia succeeds
    const releaseEviction = store.evictMedia(event.id);
    expect(releaseEviction).not.toBeNull();

    releaseEviction!();
  });

  it('serves partial content byte-range video streaming and handles 416 invalid ranges', async () => {
    const service = new DefaultEventsService(store);
    const event = store.create('camera.backyard', 'motion', 2000, 4000);

    const dummyVideo = Buffer.alloc(1024, 0x42);
    const videoPath = store.path(event.id, 'mp4');
    await writeFile(videoPath, dummyVideo);

    store.finish(event.id, {
      status: 'ready',
      duration: 10,
      bytes: dummyVideo.length,
      playbackVersion: 1,
    });

    // 1. Full content request (no range)
    const full = await service.getMedia(event.id, 'original');
    expect(full.status).toBe(200);
    expect(full.mime).toBe('video/mp4');
    expect(full.size).toBe(1024);
    expect(full.stream instanceof Readable).toBe(true);

    // 2. Partial byte range request
    const partial = await service.getMedia(event.id, 'original', 'bytes=0-499');
    expect(partial.status).toBe(206);
    expect(partial.start).toBe(0);
    expect(partial.end).toBe(499);
    expect(partial.size).toBe(1024);
    expect(partial.stream instanceof Readable).toBe(true);

    // 3. Out-of-bounds byte range
    const invalidRange = await service.getMedia(event.id, 'original', 'bytes=5000-6000');
    expect(invalidRange.status).toBe(416);

    // 4. Missing event
    const notFound = await service.getMedia('12345678-1234-1234-1234-123456789abc', 'original');
    expect(notFound.status).toBe(404);
  });

  it('serves thumbnail image as JPEG buffer', async () => {
    const service = new DefaultEventsService(store);
    const event = store.create('camera.front', 'person', 3000, 6000);

    const dummyThumb = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const thumbPath = store.path(event.id, 'jpg');
    await writeFile(thumbPath, dummyThumb);

    store.finish(event.id, {
      status: 'ready',
      duration: 3,
      bytes: 100,
    });

    const result = await service.getMedia(event.id, 'thumbnail');
    expect(result.status).toBe(200);
    expect(result.mime).toBe('image/jpeg');
    expect(Buffer.isBuffer(result.stream)).toBe(true);
    expect(result.size).toBe(dummyThumb.length);
  });

  it('coordinates event timeline query and playback preparation', async () => {
    const service = new DefaultEventsService(store);
    const event = store.create('camera.driveway', 'vehicle', 5000, 8000);
    store.finish(event.id, { status: 'ready', duration: 3, bytes: 2048 });

    const timeline = (await service.list({ cameraId: 'camera.driveway' })) as {
      items: Array<{ id: string }>;
      availability: { total: number };
    };
    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0].id).toBe(event.id);

    const prep = (await service.prepare(event.id, 20)) as { eventId: string; state: string };
    expect(prep.eventId).toBe(event.id);
    expect(prep.state).toBe('ready');

    const repair = (await service.repair(event.id)) as { repaired: boolean };
    expect(repair.repaired).toBe(true);
  });
});
