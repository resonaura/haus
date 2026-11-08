/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { test, onTestFinished } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { openTestRecordingStore } from '../support/recording.js';
import { Backups, unseal } from '@haus/hub/backup';
import { SharedConfig } from '@haus/hub/preferences';
import { CATALOG_SNAPSHOT, restoreCatalog } from '@haus/hub/backup';
import { BackupCatalog } from '@haus/hub/backup';
import { openTestCatalog } from '../support/catalog.js';
import { promisify } from 'node:util';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'haus-backups-')),
    media = join(root, 'media');
  await mkdir(media);
  const store = await openTestRecordingStore(join(root, 'haus.sqlite'), media);
  const catalog = await openTestCatalog(join(root, 'haus.sqlite'));
  const backupCatalog = new BackupCatalog(catalog.transactions);
  await backupCatalog.initialize();
  const backups = new Backups({ data: root, standalone: true }, store, backupCatalog);
  await backups.initialize();
  onTestFinished(async () => {
    await backups.stop();
    await catalog.close();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, store, backups, catalog, backupCatalog };
}
test('encrypted configuration snapshots preserve server names and room assignments', async () => {
  const { root, backups, catalog } = await fixture();
  for (const name of ['state', 'hooks', 'plugins']) {
    await mkdir(join(root, 'kitsune', name), { recursive: true });
    await writeFile(
      join(root, 'kitsune', name, 'fixture.json'),
      JSON.stringify({ value: 'private-fixture' }),
      { mode: 0o600 },
    );
  }
  const shared = new SharedConfig(catalog.transactions);
  await shared.ready;
  const saved = await shared.patch('0', {
    favorites: ['light.narnia'],
    serverDevices: {
      'home-assistant': { areaId: 'narnia' },
      'node-miku': { name: 'Miku', areaId: 'narnia' },
      'node-laptop': { name: 'Black Laptop', areaId: 'narnia' },
    },
  });
  const backup = (await backups.snapshot('haus'))!;
  const restoredDirectory = join(root, 'recovered');
  await mkdir(restoredDirectory);
  const archive = join(restoredDirectory, 'haus.tar.gz');
  const metadata = await unseal(backups.path(backup.digest), archive, backups.key);
  assert.equal(metadata.kind, 'haus');
  await promisify(execFile)('tar', ['-xzf', archive, '-C', restoredDirectory]);
  for (const name of ['state', 'hooks'])
    assert.match(
      await readFile(join(restoredDirectory, 'kitsune', name, 'fixture.json'), 'utf8'),
      /private-fixture/,
    );
  await assert.rejects(stat(join(restoredDirectory, 'kitsune', 'plugins')), { code: 'ENOENT' });
  const restoredDatabase = join(restoredDirectory, 'haus.sqlite');
  const restored = await openTestRecordingStore(restoredDatabase, join(root, 'media'));
  const restoredCatalog = await openTestCatalog(restoredDatabase);
  try {
    const restoredShared = new SharedConfig(restoredCatalog.transactions);
    await restoredShared.ready;
    assert.deepEqual(await restoredShared.get(), saved);
  } finally {
    await restoredCatalog.close();
    await restored.close();
  }
});

test('configuration and HA snapshots run independently with one bounded task per kind', async () => {
  const { backups } = await fixture();
  backups.config.standalone = false;
  let release: () => void = () => {},
    entered: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const downloading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  backups.supervisor = async (_path, init) => {
    if (init?.method === 'POST')
      return Response.json({
        result: 'ok',
        data: { slug: 'owned-parallel-ha' },
      });
    entered();
    await gate;
    return new Response('ha-fixture');
  };
  const slow = backups.snapshot('ha');
  try {
    await downloading;
    const config = backups.snapshot('haus');
    await assert.rejects(backups.snapshot('haus'), /backup_busy/);
    await assert.rejects(backups.snapshot('ha'), /backup_busy/);
    const result = (await config)!;
    assert.equal(result.kind, 'haus');
    assert.equal(backups.busy, true);
    assert.equal(backups.canSnapshot('haus'), true);
    assert.equal(backups.canSnapshot('ha'), false);
  } finally {
    release();
    await slow;
  }
  assert.equal(backups.busy, false);
  assert.equal(backups.list().length, 2);
});

test('a successful configuration snapshot cannot hide an independent HA backup failure', async () => {
  const { backups } = await fixture();
  backups.config.standalone = false;
  backups.supervisor = async () => {
    throw Error('supervisor_busy');
  };
  await assert.rejects(backups.snapshot('ha'), /supervisor_busy/);
  const failure = backups.error ?? '';
  assert.match(failure, /Home Assistant backup/);
  await backups.snapshot('haus');
  assert.equal(backups.error, failure);
});

test('slow HA retention cannot hold configuration snapshot completion', async () => {
  const { backups, backupCatalog } = await fixture();
  backups.config.standalone = false;
  for (let i = 0; i < 8; i++) {
    const digest = i.toString(16).padStart(64, '0');
    await writeFile(backups.path(digest), 'fixture');
    await backupCatalog.saveBackup({
      digest,
      kind: 'ha',
      createdAt: i,
      bytes: 7,
      haSlug: 'owned-' + i,
      archiveGeneration: null,
    });
  }
  let release: () => void = () => {},
    entered: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const deleting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  backups.supervisor = async (_path, init) => {
    assert.equal(init?.method, 'DELETE');
    entered();
    await gate;
    return new Response('{}');
  };
  const retention = backups.prune('ha');
  try {
    await deleting;
    const result = (await backups.snapshot('haus'))!;
    assert.equal(result.kind, 'haus');
  } finally {
    release();
    await retention;
  }
  assert.equal(backups.list().filter((i) => i.kind === 'ha').length, 7);
});
test('ring pruning keeps 24 configuration snapshots and 7 HA backups; only Haus-owned slugs are deleted', async () => {
  const { backupCatalog, backups } = await fixture();
  const deleted: string[] = [];
  backups.config.standalone = false;
  backups.supervisor = async (path, init) => {
    assert.equal(init?.method, 'DELETE');
    deleted.push(path);
    return new Response('{}');
  };
  for (let i = 0; i < 33; i++) {
    const kind = i < 25 ? 'haus' : 'ha',
      digest = i.toString(16).padStart(64, '0');
    await writeFile(backups.path(digest), 'encrypted-fixture');
    await backupCatalog.saveBackup({
      digest,
      kind,
      createdAt: i,
      bytes: 17,
      haSlug: kind === 'ha' ? 'owned-' + i : null,
      archiveGeneration: null,
    });
  }
  await backups.prune();
  assert.equal(backups.list().filter((b) => b.kind === 'haus').length, 24);
  assert.equal(backups.list().filter((b) => b.kind === 'ha').length, 7);
  assert.deepEqual(deleted, ['/backups/owned-25']);
});
test('Supervisor hot backup exclusions preserve a restorable catalog while the live WAL stays open', async () => {
  const { root, store, catalog } = await fixture();
  await mkdir(join(root, 'local', 'nested'), { recursive: true, mode: 0o700 });
  await writeFile(join(root, 'local', 'key'), 'private-key-fixture');
  await writeFile(join(root, 'local', 'vault.sqlite'), 'private-vault-fixture');
  await writeFile(join(root, 'local', 'nested', 'pending'), 'private-pending-fixture');
  const first = await store.create('camera.fixture', 'motion', 1000, 2000);
  const run = (arg: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [new URL('../../dist/backup/hook.js', import.meta.url).pathname, arg],
        {
          env: { ...process.env, HAUS_DATA: root },
          stdio: 'ignore',
        },
      );
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('hook failed'))));
    });
  const shared = new SharedConfig(catalog.transactions);
  await shared.ready;
  const preferences = await shared.patch('0', {
    favorites: ['light.narnia'],
  });
  await run('pre');
  await store.create('camera.fixture', 'motion', 3000, 4000);
  const archiveDirectory = await mkdtemp(join(tmpdir(), 'haus-supervisor-'));
  onTestFinished(() => rm(archiveDirectory, { recursive: true, force: true }));
  const archive = join(archiveDirectory, 'addon.tar.gz');
  const config = await readFile(new URL('../../config.yaml', import.meta.url), 'utf8');
  const exclusions = config
    .match(/backup_exclude:\n((?:  - .*\n)+)/)![1]!
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line.trim().slice(2)) as string);
  await promisify(execFile)('tar', [
    '-czf',
    archive,
    ...exclusions.map((pattern) => '--exclude=' + pattern),
    '-C',
    root,
    '.',
  ]);
  const names = (await promisify(execFile)('tar', ['-tf', archive])).stdout.split('\n');
  assert.ok(names.includes('./restore/' + CATALOG_SNAPSHOT));
  assert.ok(!names.some((name) => name.startsWith('./haus.sqlite')));
  assert.ok(!names.some((name) => /^\.\/local(?:\/|$)/.test(name)));
  const restoredRoot = join(root, 'recovered');
  await mkdir(restoredRoot);
  await promisify(execFile)('tar', ['-xzf', archive, '-C', restoredRoot]);
  assert.equal(await restoreCatalog(restoredRoot), true);
  const restoredDatabase = join(restoredRoot, 'haus.sqlite');
  const restored = await openTestRecordingStore(restoredDatabase, join(root, 'media'));
  const restoredCatalog = await openTestCatalog(restoredDatabase);
  try {
    assert.equal((await restored.get(first.id))?.cameraId, 'camera.fixture');
    assert.equal((await restored.list()).events.length, 1);
    const restoredShared = new SharedConfig(restoredCatalog.transactions);
    await restoredShared.ready;
    assert.deepEqual(await restoredShared.get(), preferences);
    await restored.create('camera.fixture', 'motion', 5000, 6000);
    assert.equal(await restoreCatalog(restoredRoot), false);
    assert.equal((await restored.list()).events.length, 2);
  } finally {
    await restoredCatalog.close();
    await restored.close();
  }
  await run('post');
  await assert.rejects(() => stat(join(root, 'restore')));
  assert.equal((await store.list()).events.length, 2);
});

test('catalog restoration accepts legacy snapshots and never invents an absent backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-legacy-catalog-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  assert.equal(await restoreCatalog(root), false);
  await mkdir(join(root, 'restore'));
  const source = join(root, 'restore', 'haus.sqlite');
  await writeFile(source, 'legacy catalog');
  assert.equal(await restoreCatalog(root), true);
  assert.equal(await readFile(join(root, 'haus.sqlite'), 'utf8'), 'legacy catalog');
});

test('failed automatic backups retain exponential cooldown across restarts; manual success clears it', async () => {
  const { backups, backupCatalog, catalog, store, root } = await fixture();
  await backups.snapshot('haus');
  backups.config.standalone = false;
  backups.config.ha_backups_enabled = true;
  let calls = 0;
  backups.supervisor = async () => {
    calls++;
    throw new Error('supervisor_busy');
  };
  const before = Date.now();
  await assert.rejects(() => backups.snapshot('ha'), /supervisor_busy/);
  const retry = () => backupCatalog.retry('ha')!;
  assert.equal(retry().failures, 1);
  assert.ok(retry().nextAt >= before + 300000);
  await backups.tick();
  await backups.tick();
  assert.equal(calls, 1, '15-second maintenance ticks must not hammer Supervisor');
  const resumedCatalog = new BackupCatalog(catalog.transactions);
  await resumedCatalog.initialize();
  const resumed = new Backups(
    { data: root, standalone: false, ha_backups_enabled: true },
    store,
    resumedCatalog,
  );
  await resumed.initialize();
  resumed.supervisor = backups.supervisor;
  await resumed.tick();
  assert.equal(calls, 1, 'restarting the helper must retain the cooldown');
  await resumedCatalog.saveRetry({ kind: 'ha', nextAt: 0, failures: 1 });
  await assert.rejects(() => resumed.tick(), /supervisor_busy/);
  assert.equal(calls, 2);
  assert.equal(resumedCatalog.retry('ha')!.failures, 2);
  assert.ok(resumedCatalog.retry('ha')!.nextAt >= Date.now() + 599000);
  resumed.supervisor = async (path, init) => {
    if (init?.method === 'POST')
      return Response.json({
        result: 'ok',
        data: { slug: 'owned-retry-fixture' },
      });
    return new Response('synthetic-ha-archive');
  };
  await resumed.snapshot('ha'); // An explicit retry remains available during automatic cooldown.
  assert.equal(resumedCatalog.retry('ha'), undefined);
  assert.equal(resumed.error, undefined);
  assert.equal(resumed.list().filter((item) => item.kind === 'ha').length, 1);
  await resumed.stop();
});
