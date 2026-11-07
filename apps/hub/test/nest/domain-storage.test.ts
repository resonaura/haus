/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DefaultClusterService } from '../../src/cluster/cluster.service.js';
import { DefaultPreferencesService } from '../../src/preferences/preferences.service.js';
import {
  ClusterLocationEntity,
  ClusterMediaEntity,
  HomeKitIdentityEntity,
  SharedConfigEntity,
} from '../../src/storage/entities/domains.js';
import { HomeKitIdentityStore } from '../../src/homekit/identity-store.js';
import { openCatalog } from '../../src/storage/source.js';
import { Transactions } from '../../src/storage/transactions.js';

describe('TypeORM shared domain storage', () => {
  let directory: string | undefined;
  let source: Awaited<ReturnType<typeof openCatalog>> | undefined;

  afterEach(async () => {
    await source?.destroy();
    source = undefined;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('adopts existing preferences, cluster metadata and HomeKit identities without data loss', async () => {
    directory = await mkdtemp(join(tmpdir(), 'haus-domains-upgrade-'));
    const database = join(directory, 'haus.sqlite');
    const legacy = new DatabaseSync(database);
    legacy.exec(`
      CREATE TABLE shared_config (
        id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL, value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE cluster_nodes (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE cluster_locations (
        digest TEXT NOT NULL, node_id TEXT NOT NULL, kind TEXT NOT NULL,
        PRIMARY KEY(digest,node_id)
      );
      CREATE TABLE cluster_media (
        event_id TEXT PRIMARY KEY, digest TEXT NOT NULL, bytes INTEGER NOT NULL, version INTEGER NOT NULL
      );
      CREATE TABLE homekit_identities (camera_id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO shared_config VALUES (1,'rev-legacy','{"favorites":["light.lamp"]}',100);
      INSERT INTO cluster_nodes VALUES (
        'node-legacy','{"name":"Legacy","url":"http://node.local","enabled":true,"roles":["storage"],"online":true}'
      );
      INSERT INTO cluster_locations VALUES ('digest-legacy','node-legacy','event');
      INSERT INTO cluster_media VALUES ('event-legacy','digest-legacy',128,1);
      INSERT INTO homekit_identities VALUES (
        'camera.legacy','{"username":"AA:BB:CC:DD:EE:FF","pincode":"123-45-678","setupID":"ABCD"}'
      );
    `);
    legacy.close();

    source = await openCatalog(database);
    const transactions = new Transactions(source);
    const preferences = new DefaultPreferencesService(transactions);
    expect(await preferences.get()).toEqual({
      revision: 'rev-legacy',
      value: { favorites: ['light.lamp'] },
      updatedAt: 100,
    });
    const updatedPreferences = await preferences.patch('rev-legacy', { roomIcons: { hall: 'lamp' } });
    expect(updatedPreferences.value).toMatchObject({ favorites: ['light.lamp'], roomIcons: { hall: 'lamp' } });
    expect((await preferences.patch('rev-legacy', { favorites: [] })).conflict).toBe(true);

    const cluster = new DefaultClusterService(source, transactions);
    await cluster.onModuleInit();
    expect(cluster.status().nodes[0]).toMatchObject({ id: 'node-legacy', name: 'Legacy' });
    await cluster.update('node-legacy', { enabled: false });
    expect(cluster.status().nodes[0]?.enabled).toBe(false);
    await cluster.remove('node-legacy');
    expect(await source.manager.count(ClusterLocationEntity)).toBe(0);
    expect(await source.manager.count(ClusterMediaEntity)).toBe(1);

    const identities = new HomeKitIdentityStore(transactions);
    expect(await identities.list()).toEqual([
      {
        cameraId: 'camera.legacy',
        value: '{"username":"AA:BB:CC:DD:EE:FF","pincode":"123-45-678","setupID":"ABCD"}',
      },
    ]);
    await identities.save('camera.new', '{"username":"11:22:33:44:55:66"}');
    expect(await source.manager.count(HomeKitIdentityEntity)).toBe(2);
    expect(await source.manager.count(SharedConfigEntity)).toBe(1);

    const tables = (await source.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )) as Array<{ name: string }>;
    expect(tables.some(({ name }) => name.includes('-'))).toBe(false);
    await transactions.drain();
    await source.destroy();
    source = await openCatalog(database);
    expect(await new DefaultPreferencesService(new Transactions(source)).get()).toMatchObject({
      revision: updatedPreferences.revision,
      value: { roomIcons: { hall: 'lamp' } },
    });
  });
});
