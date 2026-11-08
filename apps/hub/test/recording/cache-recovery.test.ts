/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { listen, port, closeServer } from '../support/http.js';
import { test, onTestFinished } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { openTestRecordingStore, queryOne, queryRows } from '../support/recording.js';
import { archiveEvent } from '@haus/hub/events';
import { unseal } from '@haus/hub/backup';
import { openTestCluster } from '../support/catalog.js';
import { digest, fixture } from './cache-fixture.js';

test('restart reconciliation recovers the unlink/flag crash window without calling missing footage archived', async () => {
  const f = await fixture({ limit: 100000 }),
    archived = await f.event(0);
  await f.cluster.work();
  const missing = await f.event(1);
  await unlink(f.store.path(archived.id));
  await unlink(f.store.path(archived.id, 'playback.mp4'));
  await unlink(f.store.path(missing.id));
  await unlink(f.store.path(missing.id, 'playback.mp4'));
  await f.store.reconcileLocalMedia();
  assert.equal((await f.store.get(archived.id))!.localOriginal, false);
  assert.equal((await f.store.totals()).bytes, 0);
  assert.equal((await f.store.totals()).archivedBytes, 64);
  assert.equal((await f.store.totals()).unavailableBytes, 64);
  assert.equal((await f.store.totals()).archivedEvents, 1);
  const response = await fetch(`${f.base}/api/events/${archived.id}/video`, {
    headers: f.headers,
  });
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), archived.playback);
});

test('disconnect and helper shutdown release remote playback pins while the body is stalled', async () => {
  for (const stop of [false, true]) {
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
    const controller = new AbortController(),
      response = await fetch(`${f.base}/api/events/${item.id}/video`, {
        headers: f.headers,
        signal: controller.signal,
      });
    const body = response.arrayBuffer().catch(() => {});
    if (stop) await f.cluster.stop();
    else controller.abort();
    await body;
    for (let i = 0; i < 50 && f.store.isMediaPinned(item.id); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(f.store.isMediaPinned(item.id), false);
    complete();
  }
});

test('an aborted reader waiting on eviction never acquires a stale event pin', async () => {
  const f = await fixture(),
    item = await f.event(0),
    release = f.store.evictMedia(item.id)!,
    controller = new AbortController();
  const reader = f.store.pinMedia(item.id, controller.signal);
  controller.abort();
  await assert.rejects(reader, { name: 'AbortError' });
  release();
  assert.equal(f.store.isMediaPinned(item.id), false);
});

test('verified archive adoption protects a just-in-time preparation original from cluster cleanup', async () => {
  const f = await fixture({ limit: 1 }),
    item = await f.event(0);
  f.blobs.set(digest(item.original), item.original);
  await f.cluster.notePlaybackUpload(f.node.id, digest(item.original));
  await archiveEvent(f.cluster, item.id);
  assert.equal(
    (
      await queryOne<{ kind: string }>(
        f.store,
        'SELECT kind FROM cluster_locations WHERE digest=?',
        digest(item.original),
      )
    )!.kind,
    'archive',
  );
  await f.cluster.recordingCache!.trim();
  await f.cluster.prune([f.node]);
  assert.equal((await f.store.get(item.id))!.localOriginal, false);
  assert.ok(f.blobs.has(digest(item.original)));
  assert.ok(f.blobs.has(digest(item.playback)));
  for (const [route, data] of [
    ['original', item.original],
    ['video', item.playback],
  ] as const) {
    const response = await fetch(`${f.base}/api/events/${item.id}/${route}`, {
      headers: f.headers,
    });
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), data);
  }
});

test('retrying original archival never overwrites the prepared worker catalog row', async () => {
  const f = await fixture({ limit: 100000 }),
    item = await f.event(0);
  await archiveEvent(f.cluster, item.id);
  await queryRows(
    f.store,
    "DELETE FROM event_archive_locations WHERE event_id=? AND variant='original'",
    item.id,
  );
  await f.store.markArchiveChanged();
  await archiveEvent(f.cluster, item.id);
  assert.ok(f.posted.length);
  assert.ok(
    f.posted.every(
      (row) => row.digest === digest(item.playback) && row.event.playbackVersion === 4,
    ),
  );
});

test('a healthy third storage node can archive when earlier candidates reject new copies', async () => {
  const f = await fixture({ limit: 1 }),
    item = await f.event(0);
  const full = createServer((req, res) => res.writeHead(req.method === 'PUT' ? 507 : 404).end());
  await listen(full);
  onTestFinished(() => closeServer(full));
  await queryRows(f.store, 'DELETE FROM cluster_nodes');
  const existingHealth = f.cluster.health.get(f.node.id);
  for (const id of ['full-a', 'full-b']) {
    const node = {
      ...f.node,
      id,
      url: `http://127.0.0.1:${port(full)}`,
    };
    await queryRows(f.store, 'INSERT INTO cluster_nodes VALUES(?,?)', id, JSON.stringify(node));
    f.cluster.health.set(id, {
      online: existingHealth?.online ?? true,
      lastSeen: existingHealth?.lastSeen,
      remote: existingHealth?.remote,
    });
  }
  await queryRows(
    f.store,
    'INSERT INTO cluster_nodes VALUES(?,?)',
    f.node.id,
    JSON.stringify(f.node),
  );
  await f.cluster.catalog.reload();
  await archiveEvent(f.cluster, item.id);
  await f.cluster.recordingCache!.trim();
  assert.equal((await f.store.get(item.id))!.localOriginal, false);
  assert.ok(f.blobs.has(digest(item.original)));
  assert.ok(f.blobs.has(digest(item.playback)));
});

test('missing or unverifiable recovery metadata keeps original and playback local', async () => {
  const f = await fixture({ limit: 100000 }),
    item = await f.event(0);
  await archiveEvent(f.cluster, item.id);
  f.config.max_storage_gb = 1 / 1024 ** 3;
  const canSnapshot = f.backups.canSnapshot.bind(f.backups);
  f.backups.canSnapshot = () => false;
  assert.equal(await f.cluster.recordingCache!.trim(), 0);
  f.backups.canSnapshot = canSnapshot;
  f.setVerification('backup-unverified');
  assert.equal(await f.cluster.recordingCache!.trim(), 0);
  assert.equal((await f.store.get(item.id))!.localOriginal, true);
  f.setVerification('valid');
  assert.equal(await f.cluster.recordingCache!.trim(), 64);
  assert.equal((await f.store.get(item.id))!.localOriginal, false);
});

test('an in-progress HA backup cannot block a verified catalog snapshot and cache rotation', async () => {
  const f = await fixture({ limit: 1 });
  const item = await f.event(0);
  await archiveEvent(f.cluster, item.id);
  f.backups.config.standalone = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.backups.supervisor = async (_path, init) => {
    if (init?.method === 'POST')
      return Response.json({ result: 'ok', data: { slug: 'owned-slow-ha' } });
    await gate;
    return new Response('ha-fixture');
  };
  const slow = f.backups.snapshot('ha');
  try {
    assert.equal(f.backups.busy, true);
    assert.equal(await f.cluster.recordingCache!.trim(), 64);
    assert.equal((await f.store.get(item.id))!.localOriginal, false);
    assert.equal(f.backups.busy, true, 'the HA backup must remain active');
    const catalog = f.backups.list().find((b) => b.kind === 'haus')!;
    assert.ok((catalog.archiveGeneration ?? 0) >= (await f.store.archiveGeneration()));
    assert.ok(f.blobs.has(catalog.digest));
    assert.ok(f.blobs.has(digest(item.original)));
    assert.ok(f.blobs.has(digest(item.playback)));
  } finally {
    release();
    await slow;
  }
});

test('a changed archive map revokes a pending eviction until its newer recovery snapshot is verified', async () => {
  const f = await fixture({ limit: 100000 }),
    item = await f.event(0);
  await archiveEvent(f.cluster, item.id);
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
  await f.store.markArchiveChanged();
  complete();
  assert.equal(await eviction, 0);
  assert.equal((await f.store.get(item.id))!.localOriginal, true);
  await f.cluster.recordingCache!.trim();
  assert.equal((await f.store.get(item.id))!.localOriginal, false);
});

test('a verified remote encrypted snapshot restores both archived variants after local video is gone', async () => {
  const f = await fixture({ limit: 1 }),
    item = await f.event(0);
  await f.cluster.work();
  const backup = f.backups.list().find((entry) => entry.kind === 'haus')!;
  assert.equal(backup.archiveGeneration, await f.store.archiveGeneration());
  const recovery = join(f.root, 'recovery');
  await mkdir(recovery);
  const sealed = join(recovery, 'recovery.enc'),
    tar = join(recovery, 'recovery.tar.gz');
  await writeFile(sealed, f.blobs.get(backup.digest)!);
  await unseal(sealed, tar, f.backups.key);
  execFileSync('tar', ['-xzf', tar, '-C', recovery]);
  const restored = await openTestRecordingStore(join(recovery, 'haus.sqlite'), f.store.media);
  onTestFinished(async () => await restored.close());
  await restored.reconcileLocalMedia();
  assert.equal((await restored.get(item.id))!.localOriginal, false);
  assert.equal(await restored.archiveGeneration(), backup.archiveGeneration);
  const restoredCatalog = await openTestCluster(restored, join(recovery, 'haus.sqlite'), {
    list: () => [],
    markChanged() {},
  });
  const { cluster } = restoredCatalog;
  onTestFinished(async () => {
    await cluster.stop();
    await restoredCatalog.catalogOwner.close();
  });
  await cluster.poll();
  for (const [variant, data] of [
    ['original', item.original],
    ['prepared', item.playback],
  ] as const) {
    const remote = await cluster.archiveMedia(
      (await restored.get(item.id))!,
      variant,
      undefined,
      new AbortController().signal,
    );
    assert.ok(remote);
    try {
      assert.deepEqual(Buffer.from(await remote.response.arrayBuffer()), data);
    } finally {
      remote.release();
    }
  }
});

test('restart probes only known local variants in keyset batches with four filesystem calls at most', async () => {
  const f = await fixture({ limit: 100000 });
  for (let i = 0; i < 260; i++) await f.event(i);
  const first = (await f.store.list({ direction: 'newer', limit: 1 })).events[0]!;
  await f.store.setLocal(first.id, 'original', false);
  await f.store.setLocal(first.id, 'prepared', false);
  let active = 0,
    max = 0,
    calls = 0;
  await f.store.reconcileLocalMedia(async (file) => {
    active++;
    max = Math.max(max, active);
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    try {
      return await stat(file);
    } finally {
      active--;
    }
  });
  assert.equal(calls, 518);
  assert.ok(max <= 4);
  assert.equal(
    (await f.store.get(first.id))!.localOriginal,
    false,
    'untracked files cannot silently rehydrate an archived variant',
  );
});
