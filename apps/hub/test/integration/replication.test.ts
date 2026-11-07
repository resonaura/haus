/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { decryptBackup } from '../../src/nvr/index.js';
import { Blobs } from '../../src/nvr/index.js';
import { RecordingIndex } from '../../src/nvr/index.js';
import { Catalog } from '../../src/nvr/index.js';
import { openPersistence, queryOne } from './support/storage.js';
import { BackupRuntime } from './support/backup.js';
import { ClusterRuntime } from './support/cluster.js';
import { recoveryCli } from './support/cli.js';
import { records } from './support/legacy.js';
import { required, record, identifier, port } from '../nvr/support/values.js';
import { DefaultPreferencesService } from '../../src/preferences/preferences.service.js';
import { createNode } from '../../src/nvr/index.js';

test(
  'three real nodes replicate encrypted configuration, distribute media, recover after disk replacement and serve scoped ranges',
  { timeout: 90000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'haus-cluster-integration-'));
    const media = join(root, 'media');
    await mkdir(media);
    const persistence = await openPersistence(join(root, 'haus.sqlite'), media);
    const { store, transactions } = persistence;
    const config = { data: root, standalone: true, ha_backups_enabled: false };
    const backups = await BackupRuntime.create(config, store, persistence.backupCatalog);
    await backups.initialize();
    const shared = new DefaultPreferencesService(transactions);
    const cluster = await ClusterRuntime.create(
      store,
      backups.instance,
      persistence.clusterCatalog,
    );
    await shared.get();
    await cluster.initialize();
    const fixtures: Array<{
      server: ReturnType<typeof createNode>;
      url: string;
      dir: string;
      blobs: Blobs;
      catalog: Catalog;
      recordings: RecordingIndex;
      key: string;
    }> = [];
    t.onTestFinished(async () => {
      await cluster.stop();
      await backups.stop();
      for (const node of fixtures) {
        node.server.closeAllConnections();
        await new Promise<void>((r, reject) =>
          node.server.close((error) => (error ? reject(error) : r())),
        );
        await node.recordings.close();
      }
      await persistence.close();
      await rm(root, { recursive: true, force: true });
    });
    for (let i = 0; i < 3; i++) {
      const dir = join(root, 'node' + i);
      const blobs = new Blobs(join(dir, 'blobs'), {
        reserveBytes: 0,
        maxBytes: 10000000,
      });
      await blobs.initialize();
      const catalog = new Catalog(join(dir, 'catalog.json'), blobs);
      await catalog.initialize();
      const key = 'unique-test-node-key-for-fixture-' + i;
      const recordings = await RecordingIndex.open(join(dir, 'recordings.sqlite'), blobs);
      const server = createNode({
        key,
        blobs,
        catalog,
        recordings,
        nodeId: 'node' + i,
        instanceId: randomUUID(),
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const url = `http://127.0.0.1:${port(server)}`;
      await cluster.add({
        name: 'Node ' + i,
        url,
        key,
        roles: ['storage', 'stream'],
        allowHttp: true,
      });
      fixtures.push({ server, url, dir, blobs, catalog, recordings, key });
    }
    await shared.patch('0', {
      favorites: ['light.narnia'],
      roomIcons: { narnia: 'moon' },
    });
    const snapshot = await backups.snapshot('haus');
    const event = await store.create('camera.test', 'motion', 1000, 3000);
    await writeFile(store.path(event.id), '0123456789');
    await store.finish(event.id, { bytes: 10, duration: 2, playbackVersion: 2 });
    await cluster.tick();
    assert.equal(records(cluster.status().nodes).length, 3);
    assert.ok(records(cluster.status().nodes).every((node) => node.backupCopies === 1));
    assert.equal(
      required(
        await queryOne(store, "SELECT count(*) AS n FROM cluster_locations WHERE kind='media'"),
      ).n,
      2,
    );
    for (const node of fixtures) {
      assert.equal(node.catalog.list().length, 1);
      const encrypted = await readFile(join(node.blobs.root, snapshot.digest));
      assert.ok(!encrypted.includes(Buffer.from('light.narnia')));
      assert.ok(!encrypted.includes(Buffer.from(node.key)));
    }
    const source = record(await cluster.source(required(await store.get(event.id))));
    const sourceUrl = identifier(source.url);
    assert.ok(sourceUrl);
    const range = await fetch(sourceUrl, { headers: { Range: 'bytes=3-6' } });
    assert.equal(range.status, 206);
    assert.equal(await range.text(), '3456');
    assert.ok(!sourceUrl.includes(required(fixtures[0]).key));
    const restored = join(root, 'restored.tar.gz');
    await backups.unseal(backups.path(snapshot.digest), restored, backups.key);
    assert.ok((await stat(restored)).size > 0);
    await decryptBackup(
      backups.path(snapshot.digest),
      join(root, 'nvr-restored.tar.gz'),
      backups.key.toString('hex'),
    );
    assert.deepEqual(await readFile(restored), await readFile(join(root, 'nvr-restored.tar.gz')));
    const corrupted = Buffer.from(await readFile(backups.path(snapshot.digest)));
    corrupted[corrupted.length - 20] ^= 1;
    const corruptPath = join(root, 'corrupt.enc');
    await writeFile(corruptPath, corrupted);
    await assert.rejects(() =>
      backups.unseal(corruptPath, join(root, 'must-not-exist'), backups.key),
    );
    await assert.rejects(() => stat(join(root, 'must-not-exist')));
    const kit = join(root, 'recovery.json');
    await writeFile(kit, JSON.stringify({ ...backups.recoveryKit(), nodes: cluster.nodes() }), {
      mode: 0o600,
    });
    const workerId = required(
      await queryOne(store, "SELECT node_id FROM cluster_locations WHERE kind='media' LIMIT 1"),
    ).node_id;
    const runCli = (args: string[]) => recoveryCli(kit, identifier(workerId), args);
    const exported = join(root, 'cli-backup.tar');
    await runCli(['--digest', snapshot.digest, '--output', exported]);
    assert.deepEqual(await readFile(exported), await readFile(restored));
    const listing: unknown = JSON.parse(await runCli(['--list-recordings']));
    assert.ok(records(record(listing).items).some((item) => item.id === event.id));
    const video = join(root, 'cli-video.mp4');
    await runCli(['--recording', event.id, '--output', video]);
    assert.equal(await readFile(video, 'utf8'), '0123456789');
    await assert.rejects(() => runCli(['--recording', event.id, '--output', video]));
    assert.equal(await readFile(video, 'utf8'), '0123456789');
    // Replace one worker's disk while keeping its address/key. Instance identity invalidates stale acknowledgements.
    const first = required(fixtures[0]),
      reopenPort = port(first.server);
    first.server.closeAllConnections();
    await new Promise<void>((r, reject) =>
      first.server.close((error) => (error ? reject(error) : r())),
    );
    await first.recordings.close();
    await rm(first.dir, { recursive: true, force: true });
    const replacement = new Blobs(join(first.dir, 'blobs'), {
      reserveBytes: 0,
      maxBytes: 10000000,
    });
    await replacement.initialize();
    const catalog = new Catalog(join(first.dir, 'catalog.json'), replacement);
    await catalog.initialize();
    const recordings = await RecordingIndex.open(join(first.dir, 'recordings.sqlite'), replacement);
    first.recordings = recordings;
    first.server = createNode({
      key: first.key,
      blobs: replacement,
      catalog,
      recordings,
      nodeId: 'node0',
      instanceId: randomUUID(),
    });
    await new Promise<void>((r) => first.server.listen(reopenPort, '127.0.0.1', r));
    await cluster.tick();
    assert.equal(catalog.list().length, 1);
    assert.ok((await stat(join(replacement.root, snapshot.digest))).size > 0);
    assert.ok(records(cluster.status().nodes).every((node) => node.online));
    assert.ok(!JSON.stringify(cluster.status()).includes(first.key));
  },
);
