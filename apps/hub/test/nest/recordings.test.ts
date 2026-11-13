/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, type INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { createNestApp } from '../../src/nest.js';
import { RecordingStore } from '../../src/events/recording.store.js';
import { EVENTS_SERVICE } from '../../src/events/tokens.js';
import type { EventsService } from '../../src/events/types.js';
import { ORIGINAL_POLICY_VERSION, PLAYBACK_VERSION } from '../../src/events/playback.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';
import { CATALOG_SOURCE, CATALOG_TRANSACTIONS } from '../../src/storage/storage.module.js';
import { CAMERA_SERVICE } from '../../src/camera/tokens.js';
import type { DefaultCameraService } from '../../src/camera/camera.service.js';

const token = 'isolated-recordings-api-token';
const headers = { authorization: `Bearer ${token}` };
let root: string;
let media: string;
let app: INestApplication | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'haus-nest-recordings-'));
  media = join(root, 'media');
  await mkdir(media);
});
afterEach(async () => {
  try {
    await app?.close();
  } finally {
    app = undefined;
    await rm(root, { recursive: true, force: true });
  }
});

async function seed(ready = false) {
  const source = await openCatalog(join(root, 'haus.sqlite'));
  const transactions = new Transactions(source);
  const store = new RecordingStore(source, media, transactions);
  try {
    const at = Date.now() - 20000;
    const event = await store.create('camera.fixture', 'motion', at, at + 1000);
    await writeFile(store.path(event.id), 'recorded');
    await store.finish(event.id, { status: 'ready', duration: 1, bytes: 8 });
    if (ready)
      await store.setPlayback(event.id, 0, PLAYBACK_VERSION, {
        originalCompatible: true,
        originalPolicyVersion: ORIGINAL_POLICY_VERSION,
      });
    return event.id;
  } finally {
    await store.close();
    if (source.isInitialized) await source.destroy();
  }
}

async function boot(mediaDirectory?: string) {
  app = await createNestApp({ dataDirectory: root, apiToken: token, mediaDirectory });
  await app.listen(0, '127.0.0.1');
  return app.getUrl();
}

it('the booted Nest API reads installed recording rows and serves real stored byte ranges after restart', async () => {
  const id = await seed();
  for (let restart = 0; restart < 2; restart++) {
    const base = await boot();
    for (const suffix of ['', '/original']) {
      const path = `${base}/api/events/${id}${suffix}`;
      expect((await fetch(path)).status).toBe(401);
      expect(
        (await fetch(path, { headers: { authorization: 'Bearer unverified-token' } })).status,
      ).toBe(401);
    }
    const response = await fetch(`${base}/api/events/${id}`, { headers });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ id, cameraId: 'camera.fixture', status: 'ready', bytes: 8 });
    const timeline = await fetch(`${base}/api/events?camera_id=camera.fixture`, { headers });
    expect(timeline.status).toBe(200);
    expect(await timeline.json()).toMatchObject({ items: [{ id }] });
    const original = await fetch(`${base}/api/events/${id}/original`, {
      headers: { ...headers, range: 'bytes=1-3' },
    });
    expect(original.status).toBe(206);
    expect(original.headers.get('content-range')).toBe('bytes 1-3/8');
    expect(await original.text()).toBe('eco');
    await app?.close();
    app = undefined;
  }
});

it('uses an explicitly configured recording directory without relocating catalog data or media', async () => {
  media = join(root, 'configured-footage');
  await mkdir(media);
  const id = await seed();
  const base = await boot(media);
  if (!app) throw Error('missing app');
  expect(app.get(RecordingStore).media).toBe(media);
  const response = await fetch(`${base}/api/events/${id}/original`, { headers });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('recorded');
});

it('rejects an unusable recording path before opening any catalog or statistics database', async () => {
  const occupied = join(root, 'occupied');
  await writeFile(occupied, 'existing-data');
  await expect(createNestApp({ dataDirectory: root, mediaDirectory: occupied })).rejects.toThrow();
  expect((await readdir(root)).sort()).toEqual(['media', 'occupied']);
  await expect(createNestApp({ dataDirectory: root, mediaDirectory: ' ' })).rejects.toThrow(
    'invalid_recording_media_directory',
  );
  expect((await readdir(root)).sort()).toEqual(['media', 'occupied']);
});

it('the booted recorder rejects unavailable cameras and unverifiable media without claiming a recording', async () => {
  const id = await seed();
  const base = await boot();
  if (!app) throw Error('missing app');
  const store = app.get(RecordingStore);
  const events = app.get<EventsService>(EVENTS_SERVICE);
  if (!events.trigger) throw Error('missing trigger contract');
  const before = await store.totals();
  await expect(events.trigger('camera.fixture')).rejects.toBeInstanceOf(BadRequestException);
  expect(await store.totals()).toEqual(before);
  const cameras = app.get<DefaultCameraService>(CAMERA_SERVICE);
  cameras.registerCamera({ id: 'camera.fixture', name: 'Fixture', enabled: true });
  const recording = await fetch(`${base}/api/cameras/camera.fixture/record`, {
    method: 'POST',
    headers,
  });
  expect(recording.status).toBe(400);
  expect(await store.totals()).toEqual(before);
  for (const route of ['prepare', 'repair']) {
    const response = await fetch(`${base}/api/events/${id}/${route}`, { method: 'POST', headers });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ eventId: id });
    expect(body).not.toMatchObject({ state: 'ready' });
  }
  expect((await store.get(id))?.playbackBytes).toBe(0);
});

it('an already verified original stays ready when no encoding worker is available', async () => {
  const id = await seed(true);
  const base = await boot();
  const response = await fetch(`${base}/api/events/${id}/prepare`, { headers });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(body).toEqual({ eventId: id, state: 'ready' });
});

it('shares the catalog connection and waits for admitted TypeORM work before destroying it', async () => {
  await boot();
  if (!app) throw Error('missing app');
  const store = app.get(RecordingStore);
  const source = app.get<DataSource>(CATALOG_SOURCE);
  const transactions = app.get<Transactions>(CATALOG_TRANSACTIONS);
  expect(store.source).toBe(source);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writing = transactions.run(async () => {
    entered();
    await gate;
  });
  await started;
  let closed = false;
  const closing = app.close().then(() => {
    closed = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    expect(source.isInitialized).toBe(true);
  } finally {
    release();
    await Promise.all([writing, closing]);
    app = undefined;
  }
  expect(source.isInitialized).toBe(false);
  await expect(store.create('camera.fixture', 'motion', 1000, 2000)).rejects.toThrow();
});

it('async prepare/prepare-next/repair returns 202 while preparing, full event when ready, and 404 when missing', async () => {
  const readyId = await seed(true);
  const unreadyAt = Date.now() - 10000;
  const source = await openCatalog(join(root, 'haus.sqlite'));
  const transactions = new Transactions(source);
  const store = new RecordingStore(source, media, transactions);
  let unreadyId!: string;
  try {
    const event = await store.create('camera.fixture', 'motion', unreadyAt, unreadyAt + 1000);
    await writeFile(store.path(event.id), 'not-an-mp4');
    await store.finish(event.id, { status: 'ready', duration: 1, bytes: 10 });
    unreadyId = event.id;
  } finally {
    await store.close();
    if (source.isInitialized) await source.destroy();
  }

  const base = await boot();
  const asyncHeaders = { ...headers, 'x-haus-async-prepare': '1' };

  const missingPrepare = await fetch(`${base}/api/events/00000000-0000-4000-8000-000000000000/prepare`, {
    headers: asyncHeaders,
  });
  expect(missingPrepare.status).toBe(404);

  const missingRepair = await fetch(`${base}/api/events/00000000-0000-4000-8000-000000000000/repair`, {
    method: 'POST',
    headers: asyncHeaders,
  });
  expect(missingRepair.status).toBe(404);

  const readyRes = await fetch(`${base}/api/events/${readyId}/prepare`, { headers: asyncHeaders });
  expect(readyRes.status).toBe(200);
  const readyBody: unknown = await readyRes.json();
  expect(readyBody).toMatchObject({
    id: readyId,
    eventId: readyId,
    cameraId: 'camera.fixture',
    status: 'ready',
    state: 'ready',
  });

  const pendingRes = await fetch(`${base}/api/events/${unreadyId}/prepare`, {
    headers: asyncHeaders,
  });
  expect(pendingRes.status).toBe(202);
  expect(await pendingRes.json()).toEqual({ eventId: unreadyId, state: 'preparing' });

  const nextRes = await fetch(`${base}/api/events/${unreadyId}/prepare-next`, {
    headers: asyncHeaders,
  });
  expect(nextRes.status).toBe(202);
  expect(await nextRes.json()).toEqual({ eventId: unreadyId, state: 'preparing' });

  const repairRes = await fetch(`${base}/api/events/${readyId}/repair`, {
    method: 'POST',
    headers: asyncHeaders,
  });
  expect(repairRes.status).toBe(202);
  expect(await repairRes.json()).toEqual({
    repaired: true,
    eventId: readyId,
    state: 'preparing',
  });
});
