/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { test, onTestFinished } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { queryOne } from '../support/recording.js';
import { Servers } from '@haus/hub/servers';
import { defaults } from '@haus/hub/runtime';
import { archiveEvent } from '@haus/hub/events';
import { digest, fixture } from './cache-fixture.js';

test('HA defaults to a 10GiB recent-video cache without replacing an explicit saved unlimited policy', async () => {
  assert.equal(defaults.max_storage_gb, 10);
  const f = await fixture();
  await f.serviceCatalog.savePolicy(
    'primary-storage',
    JSON.stringify({ storageLimitBytes: null, source: 'user' }),
  );
  const servers = new Servers({
    config: f.config,
    store: f.store,
    cluster: f.cluster,
    backups: { markChanged() {} },
    catalog: f.serviceCatalog,
    ha: { connected: true },
  });
  assert.equal(servers.policy.storageLimitBytes, null);
  assert.equal(f.config.max_storage_gb, 0);
});

test('verified recent-cache rotation leaves capture headroom before the hard limit', async () => {
  const f = await fixture({ limit: 100 });
  const old = await f.event(0, { prepared: false });
  const fresh = await f.event(1, { prepared: false });
  const newest = await f.event(2, { prepared: false });
  assert.equal((await f.store.totals()).bytes, 96);
  f.setVerification('unverified');
  await f.cluster.work();
  assert.equal(
    (await f.store.get(old.id))!.localOriginal,
    true,
    'headroom cannot evict an unverified original',
  );
  f.setVerification('valid');
  await f.cluster.work();
  assert.equal((await f.store.get(old.id))!.localOriginal, false);
  assert.equal((await f.store.get(fresh.id))!.localOriginal, true);
  assert.equal((await f.store.get(newest.id))!.localOriginal, true);
  assert.equal((await f.store.totals()).bytes, 64);
  assert.equal(f.config.max_storage_gb * 1024 ** 3, 100, 'the user limit is unchanged');
  const next = await f.event(3, { prepared: false });
  assert.equal(
    (await f.store.totals()).bytes,
    96,
    'the next capture fits without waiting for another trim',
  );
  assert.equal((await f.store.get(next.id))!.localOriginal, true);
  assert.equal((await f.store.totals()).unavailableBytes, 0);
});

test('oldest verified originals and prepared copies rotate locally; ranged video/original and thumbnail remain readable', async () => {
  const f = await fixture({ limit: 100 }),
    old = await f.event(0),
    fresh = await f.event(1);
  await f.cluster.work();
  assert.equal((await f.store.get(old.id))!.localOriginal, false);
  assert.equal((await f.store.get(old.id))!.localPlayback, false);
  assert.equal((await f.store.get(fresh.id))!.localOriginal, true);
  assert.equal((await f.store.totals()).bytes, 64);
  assert.equal((await f.store.totals()).totalBytes, 128);
  assert.equal((await f.store.totals()).archivedBytes, 64);
  assert.equal((await f.store.list({})).events.length, 2);
  assert.equal((await readFile(f.store.path(old.id, 'jpg'))).toString(), 'thumbnail');
  const original = await fetch(`${f.base}/api/events/${old.id}/original`, {
    headers: { ...f.headers, Range: 'bytes=2-7' },
  });
  assert.equal(original.status, 206);
  assert.equal(original.headers.get('content-range'), 'bytes 2-7/32');
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), old.original.subarray(2, 8));
  const video = await fetch(`${f.base}/api/events/${old.id}/video`, {
    headers: f.headers,
  });
  assert.equal(video.status, 200);
  assert.deepEqual(Buffer.from(await video.arrayBuffer()), old.playback);
  assert.equal(
    f.prepareCalls(),
    0,
    'archived prepared media must never wait for original processing',
  );
  const head = await fetch(`${f.base}/api/events/${old.id}/original`, {
    method: 'HEAD',
    headers: f.headers,
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '32');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const thumb = await fetch(`${f.base}/api/events/${old.id}/thumbnail`, {
    headers: f.headers,
  });
  assert.equal(thumb.status, 200);
  assert.ok(
    !f.posted.some((row) => row.digest === digest(old.original)),
    "only the preferred prepared digest belongs in the worker's per-event index",
  );
  assert.ok(f.posted.some((row) => row.digest === digest(old.playback)));
});

test('a proven compatible original needs one archived immutable variant', async () => {
  const f = await fixture({ limit: 1 }),
    item = await f.event(0, { prepared: false });
  await f.cluster.work();
  assert.equal((await f.store.get(item.id))!.localOriginal, false);
  assert.equal(
    (
      await queryOne<{ n: number }>(
        f.store,
        'SELECT count(*) AS n FROM event_archive WHERE event_id=?',
        item.id,
      )
    )!.n,
    1,
  );
  const response = await fetch(`${f.base}/api/events/${item.id}/video`, {
    headers: f.headers,
  });
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), item.original);
});

for (const scenario of [
  'stream-only',
  'offline',
  'unsupported',
  'missing',
  'unverified',
  'prepared-unverified',
  'corrupt',
  'full',
])
  test(`never evicts the only usable local copy when archive is ${scenario}`, async () => {
    const f = await fixture({
        limit: 1,
        roles: scenario === 'stream-only' ? ['stream'] : ['storage'],
        supported: scenario !== 'unsupported',
      }),
      item = await f.event(0);
    if (scenario === 'offline') f.cluster.health.set(f.node.id, { online: false });
    if (['missing', 'unverified', 'prepared-unverified', 'corrupt', 'full'].includes(scenario))
      f.setVerification(scenario);
    if (scenario === 'offline') await archiveEvent(f.cluster, item.id);
    else await f.cluster.work();
    await f.cluster.recordingCache!.trim();
    assert.equal((await f.store.get(item.id))!.localOriginal, true);
    assert.equal((await f.store.get(item.id))!.localPlayback, true);
    assert.deepEqual(await readFile(f.store.path(item.id)), item.original);
  });

test('a missing remote blob discovered after successful archival revokes local eviction', async () => {
  const f = await fixture({ limit: 1000 }),
    item = await f.event(0);
  await f.cluster.work();
  f.blobs.delete(digest(item.original));
  f.config.max_storage_gb = 1 / 1024 ** 3;
  await f.cluster.recordingCache!.trim();
  assert.equal((await f.store.get(item.id))!.localOriginal, true);
  assert.deepEqual(await readFile(f.store.path(item.id)), item.original);
});

test('pending unprepared media is kept local rather than losing its repair input', async () => {
  const f = await fixture({ limit: 1 }),
    item = await f.event(0, { ready: false });
  await f.cluster.work();
  assert.equal((await f.store.get(item.id))!.localOriginal, true);
  assert.equal((await f.store.get(item.id))!.localPlayback, true);
});

test('reader/preparer pins and exclusive eviction serialize without touching pre-roll or event metadata', async () => {
  const f = await fixture({ limit: 1000 }),
    item = await f.event(0);
  await f.cluster.work();
  const buffer = join(f.root, 'buffer');
  await mkdir(buffer);
  await writeFile(join(buffer, 'pre-roll.ts'), 'ring-before-motion');
  f.config.max_storage_gb = 1 / 1024 ** 3;
  const release = await f.store.pinMedia(item.id);
  assert.equal(await f.cluster.recordingCache!.trim(), 0);
  assert.equal((await f.store.get(item.id))!.localOriginal, true);
  release();
  const exclusive = f.store.evictMedia(item.id)!;
  let acquired = false;
  const reader = f.store.pinMedia(item.id).then((unpin) => {
    acquired = true;
    unpin();
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(acquired, false);
  exclusive();
  await reader;
  await f.cluster.recordingCache!.trim();
  assert.equal((await f.store.get(item.id))!.localOriginal, false);
  assert.equal((await readFile(join(buffer, 'pre-roll.ts'))).toString(), 'ring-before-motion');
  assert.equal((await f.store.get(item.id))!.status, 'ready');
  assert.equal(
    (
      await f.store.recordedDays({
        cameraId: 'camera.fixture',
        boundaries: [Date.now() - 1e7, Date.now() + 1e7],
      })
    ).length,
    1,
  );
});

test('quota shrink keeps archives and catalog until independent age retention, which also respects active readers', async () => {
  const f = await fixture({ limit: 1000 }),
    item = await f.event(0);
  await f.cluster.work();
  f.config.max_storage_gb = 1 / 1024 ** 3;
  await f.cluster.recordingCache!.trim();
  const release = await f.store.pinMedia(item.id);
  assert.equal(await f.store.prune(f.config, Date.now() + 8 * 86400000), 0);
  release();
  assert.equal(await f.store.prune(f.config, Date.now() + 8 * 86400000), 1);
  assert.equal(await f.store.get(item.id), null);
  await f.cluster.prune([f.node]);
  assert.equal(f.blobs.has(digest(item.original)), false);
  assert.equal(f.blobs.has(digest(item.playback)), false);
});

test('an archive going offline returns a clear temporary media error without deleting catalog', async () => {
  const f = await fixture({ limit: 1 }),
    item = await f.event(0);
  await f.cluster.work();
  f.cluster.health.set(f.node.id, { online: false });
  const response = await fetch(`${f.base}/api/events/${item.id}/video`, {
    headers: f.headers,
  });
  assert.equal(response.status, 503);
  assert.equal(((await response.json()) as { error: string }).error, 'archived_media_unavailable');
  assert.equal((await f.store.get(item.id))!.status, 'ready');
});

test('64 blocked oldest entries cannot starve a newer eligible verified cache entry', async () => {
  const f = await fixture({ limit: 100000 });
  for (let i = 0; i < 65; i++) await f.event(i, { ready: false });
  const eligible = await f.event(70);
  await f.cluster.work();
  assert.ok(
    await queryOne(f.store, 'SELECT digest FROM event_archive WHERE event_id=?', eligible.id),
    'unprepared oldest entries must not bury ready archive work',
  );
  f.config.max_storage_gb = 1 / 1024 ** 3;
  await f.cluster.recordingCache!.trim();
  assert.equal((await f.store.get(eligible.id))!.localOriginal, true);
  await f.cluster.recordingCache!.trim();
  assert.equal((await f.store.get(eligible.id))!.localOriginal, false);
});

test('a failed oldest archive page cannot starve newer eligible originals', async () => {
  const f = await fixture({ limit: 100000 });
  for (let i = 0; i < 9; i++) await f.event(i);
  f.setVerification('unverified');
  await f.cluster.work();
  f.setVerification('valid');
  await f.cluster.work();
  const newest = (await f.store.list({ limit: 1 })).events[0]!;
  assert.ok(
    await queryOne(
      f.store,
      'SELECT digest FROM event_archive_locations WHERE event_id=?',
      newest.id,
    ),
  );
});

test('an authenticated ranged remote reader pins its event against age deletion until the response completes', async () => {
  const f = await fixture({ limit: 1 }),
    item = await f.event(0);
  await f.cluster.work();
  let complete!: () => void;
  f.setStreamGate(
    new Promise<void>((resolve) => {
      complete = resolve;
    }),
  );
  onTestFinished(() => complete());
  const response = await fetch(`${f.base}/api/events/${item.id}/video`, {
    headers: { ...f.headers, Range: 'bytes=0-7' },
  });
  assert.equal(response.status, 206);
  assert.equal(await f.store.prune(f.config, Date.now() + 8 * 86400000), 0);
  complete();
  await response.arrayBuffer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await f.store.prune(f.config, Date.now() + 8 * 86400000), 1);
});

test('a reader arriving during verification waits until exclusive local eviction commits', async () => {
  const f = await fixture({ limit: 100000 }),
    item = await f.event(0);
  await f.cluster.work();
  f.config.max_storage_gb = 1 / 1024 ** 3;
  let complete!: () => void;
  f.setVerifyGate(
    new Promise<void>((resolve) => {
      complete = resolve;
    }),
  );
  const eviction = f.cluster.recordingCache!.trim();
  while (!f.store.isMediaEvicting(item.id)) await new Promise((resolve) => setImmediate(resolve));
  let acquired = false;
  const reader = f.store.pinMedia(item.id).then((release) => {
    acquired = true;
    release();
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(acquired, false);
  complete();
  await eviction;
  await reader;
  assert.equal((await f.store.get(item.id))!.localOriginal, false);
});

test('raising or removing the local budget during remote verification revokes pending eviction', async () => {
  for (const limit of [100000, 0]) {
    const f = await fixture({ limit: 100000 }),
      item = await f.event(0);
    await f.cluster.work();
    f.config.max_storage_gb = 1 / 1024 ** 3;
    let complete!: () => void;
    f.setVerifyGate(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    onTestFinished(() => complete());
    const eviction = f.cluster.recordingCache!.trim();
    while (!f.store.isMediaEvicting(item.id)) await new Promise((resolve) => setImmediate(resolve));
    f.config.max_storage_gb = limit;
    complete();
    assert.equal(await eviction, 0);
    assert.equal((await f.store.get(item.id))!.localOriginal, true);
    assert.deepEqual(await readFile(f.store.path(item.id)), item.original);
  }
});

test('same-version playback repair invalidates old prepared archives and direct grants', async () => {
  const f = await fixture({ limit: 100000 }),
    item = await f.event(0);
  await f.cluster.work();
  assert.ok(await queryOne(f.store, 'SELECT digest FROM cluster_media WHERE event_id=?', item.id));
  const repaired = Buffer.from('REPAIRED'.padEnd(32, 'r'));
  await writeFile(f.store.path(item.id, 'playback.mp4'), repaired);
  await f.store.setPlayback(item.id, repaired.length, 4, { audio: true });
  assert.equal(
    await queryOne(
      f.store,
      "SELECT digest FROM event_archive WHERE event_id=? AND variant='prepared'",
      item.id,
    ),
    undefined,
  );
  assert.equal(
    await queryOne(f.store, 'SELECT digest FROM cluster_media WHERE event_id=?', item.id),
    undefined,
  );
  await f.cluster.work();
  f.config.max_storage_gb = 1 / 1024 ** 3;
  await f.cluster.recordingCache!.trim();
  const response = await fetch(`${f.base}/api/events/${item.id}/video`, {
    headers: f.headers,
  });
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), repaired);
});
