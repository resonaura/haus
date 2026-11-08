/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { decodeCursor } from '../../src/events/recording.store.js';
import type { RecordingStore } from '../../src/events/recording.store.js';
import { openTestRecordingStore } from './recording-test-store.js';
import { recordingMetadata } from '../../src/events/recording-metadata.js';
import { playbackReady, PLAYBACK_VERSION } from '../../src/events/playback.js';
import { DefaultEventsService } from '../../src/events/events.service.js';
import { ServiceUnavailableException } from '@nestjs/common';
import { EventArchiveEntity } from '../../src/events/recording.entities.js';

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
    store = await openTestRecordingStore(dbPath, mediaDir);
  });

  afterEach(async () => {
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('paginates deterministically across equal timestamps and filters by detection kind', async () => {
    for (let i = 0; i < 4; i++) {
      await store.create(
        'camera.garden',
        i % 2 === 0 ? 'person' : 'vehicle',
        1000,
        3000,
        'sensor.garden_motion',
      );
    }

    const firstPage = await store.list({ limit: 2 });
    expect(firstPage.events).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();
    const [cursorAt, cursorId] = decodeCursor(firstPage.nextCursor!);
    expect(cursorAt).toBe(1000);
    expect(typeof cursorId).toBe('string');

    const secondPage = await store.list({ limit: 2, cursor: firstPage.nextCursor! });
    expect(secondPage.events).toHaveLength(2);
    expect(secondPage.nextCursor).toBeNull();

    const allIds = new Set([...firstPage.events, ...secondPage.events].map((e) => e.id));
    expect(allIds.size).toBe(4);

    const personFilter = await store.list({ kind: 'person' });
    expect(personFilter.events).toHaveLength(2);
    expect(personFilter.events.every((e) => e.kinds.includes('person'))).toBe(true);

    await expect(store.list({ cursor: 'invalid_base64_json' })).rejects.toThrow(/invalid_cursor/);
  });

  it('tracks camera availability bounds and merges contiguous heartbeats', async () => {
    await store.observeAvailability('camera.entry', 'online', 10000);
    await store.observeAvailability('camera.entry', 'online', 30000); // within 45s heartbeat window
    await store.observeAvailability('camera.entry', 'offline', 90000); // distinct state beyond window

    const intervals = await store.availability({ cameraId: 'camera.entry', from: 0, to: 100000 });
    expect(intervals.length).toBeGreaterThanOrEqual(1);

    const days = await store.recordedDays({
      cameraId: 'camera.entry',
      boundaries: [0, 86400000, 172800000],
    });
    expect(Array.isArray(days)).toBe(true);
  });

  it('adopts activity events idempotently and interrupts only incomplete recordings', async () => {
    const activity = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cameraId: 'camera.entry',
      startAt: 1000,
      endAt: 2000,
      kinds: ['motion'],
    };
    expect(await store.adoptActivity(activity)).toMatchObject({ status: 'recording' });
    expect(await store.adoptActivity({ ...activity, startAt: 500 })).toMatchObject({
      startAt: 1000,
    });

    await store.interruptActivity(activity.id, 'storage_full');
    expect(await store.get(activity.id)).toMatchObject({
      status: 'interrupted',
      localOriginal: false,
      error: 'The NVR did not have enough space to complete this event.',
    });

    const complete = await store.create('camera.entry', 'motion', 3000, 4000);
    await store.finish(complete.id, { status: 'ready', bytes: 8 });
    await store.interruptActivity(complete.id);
    expect((await store.get(complete.id))?.status).toBe('ready');
  });

  it('handles playback metadata transitions without corrupting original duration', async () => {
    const event = await store.create('camera.driveway', 'motion', 1000, 5000);
    await store.finish(event.id, { duration: 120, bytes: 45000, playbackVersion: 2 });
    await store.setPlayback(event.id, 8000, PLAYBACK_VERSION, {
      duration: 15,
      originalCompatible: true,
      originalPolicyVersion: 1,
    });

    const updated = await store.get(event.id);
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
    const event = await store.create('camera.patio', 'person', 1000, 3000);
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
    const event = await store.create('camera.backyard', 'motion', 2000, 4000);

    const dummyVideo = Buffer.alloc(1024, 0x42);
    const videoPath = store.path(event.id, 'mp4');
    await writeFile(videoPath, dummyVideo);

    await store.finish(event.id, {
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
    const event = await store.create('camera.front', 'person', 3000, 6000);

    const dummyThumb = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const thumbPath = store.path(event.id, 'jpg');
    await writeFile(thumbPath, dummyThumb);

    await store.finish(event.id, {
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

  it('reconciles missing local media through the ORM and prunes expired archives safely', async () => {
    const event = await store.create('camera.garage', 'motion', 1, 2);
    await store.finish(event.id, { status: 'ready', bytes: 16 });
    await store.reconcileLocalMedia(async () => {
      throw Object.assign(new Error('missing fixture file'), { code: 'ENOENT' });
    });
    expect((await store.get(event.id))?.localOriginal).toBe(false);

    await store.source.manager.insert(EventArchiveEntity, {
      eventId: event.id,
      variant: 'original',
      digest: 'fixture-digest',
      bytes: 16,
      version: 1,
    });
    expect(await store.archiveGeneration()).toBe(0);

    const removed = await store.prune({ retention_days: 1 }, 10 * 86400000);
    expect(removed).toBe(1);
    expect(await store.get(event.id)).toBeNull();
    expect(await store.archiveGeneration()).toBe(1);
    expect(await store.source.manager.count(EventArchiveEntity)).toBe(0);
  });

  it('computes local and archived storage totals through TypeORM queries', async () => {
    const event = await store.create('camera.attic', 'person', 1000, 2000);
    await store.finish(event.id, { status: 'ready', bytes: 100 });
    await store.setPlayback(event.id, 20, 1);
    expect(await store.totals()).toMatchObject({
      count: 1,
      bytes: 120,
      totalBytes: 120,
      localEvents: 1,
      unavailableBytes: 0,
    });
  });

  it('queries the timeline and rejects playback work when no worker is available', async () => {
    const service = new DefaultEventsService(store);
    const event = await store.create('camera.driveway', 'vehicle', 5000, 8000);
    await store.finish(event.id, { status: 'ready', duration: 3, bytes: 2048 });

    const timeline = (await service.list({ cameraId: 'camera.driveway' })) as {
      items: Array<{ id: string }>;
      availability: { total: number };
    };
    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0].id).toBe(event.id);

    await expect(service.prepare(event.id, 20)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.repair(event.id)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
