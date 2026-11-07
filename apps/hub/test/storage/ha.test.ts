/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import Driver from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openCatalog } from '../../src/storage/source.js';
import { Transactions } from '../../src/storage/transactions.js';
import { HaCatalog } from '../../src/storage/ha/catalog.js';
import { snapshotCatalog } from '../../src/storage/snapshot.js';

it('adopts legacy HA grants, ownership and journals and preserves them in a read-only snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-ha-upgrade-'));
  const database = join(directory, 'haus.sqlite');
  const legacy = new Driver(database);
  legacy.exec(`
    CREATE TABLE ha_camera_clients(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
    INSERT INTO ha_camera_clients VALUES('legacy','hashed-token',123);
    CREATE TABLE native_ha_owner(camera_id TEXT PRIMARY KEY,client_id TEXT NOT NULL);
    INSERT INTO native_ha_owner VALUES('camera.old','legacy');
    CREATE TABLE native_ha_release(bridge_id TEXT PRIMARY KEY,requested_at INTEGER NOT NULL);
    INSERT INTO native_ha_release VALUES('bridge',456);
    CREATE TABLE native_ha_migrations(bridge_id TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO native_ha_migrations VALUES('bridge','{"phase":"interrupted"}');
  `);
  legacy.close();
  const source = await openCatalog(database);
  const transactions = new Transactions(source);
  try {
    const catalog = new HaCatalog(transactions);
    await catalog.initialize();
    expect(catalog.authenticate('hashed-token')).toBe('legacy');
    expect(catalog.canManageNative('legacy')).toBe(false);
    expect(catalog.ownedCameras('legacy')).toEqual(['camera.old']);
    expect(catalog.pendingReleases()).toEqual(['bridge']);
    expect(catalog.journal('bridge')).toBe('{"phase":"interrupted"}');
    const ledger = await source.query('SELECT * FROM haus_platform_migrations');
    const snapshot = join(directory, 'snapshot.sqlite');
    await snapshotCatalog(database, snapshot);
    const inspection = new Driver(snapshot, { readonly: true });
    try {
      expect(inspection.prepare('SELECT * FROM haus_platform_migrations').all()).toEqual(ledger);
      expect(inspection.prepare('SELECT * FROM ha_camera_clients').get()).toEqual({
        id: 'legacy',
        token_hash: 'hashed-token',
        created_at: 123,
        native_entities: 0,
      });
      expect(inspection.pragma('foreign_key_check')).toEqual([]);
    } finally {
      inspection.close();
    }
  } finally {
    await transactions.drain();
    await source.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});

it('does not publish failed writes and durably fences a grant revoked during handover', async () => {
  const source = await openCatalog(':memory:');
  const transactions = new Transactions(source);
  try {
    const catalog = new HaCatalog(transactions);
    await catalog.initialize();
    await catalog.enroll({ id: 'client', tokenHash: 'digest', createdAt: 1, nativeEntities: true });
    await catalog.acknowledge(
      'client',
      [{ cameraId: 'camera.one', revision: 'revision' }],
      true,
      2,
    );
    expect(catalog.readyClient('camera.one', 'revision', 2)).toEqual({ clientId: 'client' });
    await source.query(
      `CREATE TRIGGER reject_grant BEFORE INSERT ON ha_camera_clients BEGIN SELECT RAISE(ABORT,'fixture_write_failure'); END`,
    );
    await expect(
      catalog.enroll({ id: 'failed', tokenHash: 'failed', createdAt: 3, nativeEntities: true }),
    ).rejects.toThrow('fixture_write_failure');
    expect(catalog.authenticate('failed')).toBeUndefined();
    await catalog.revoke('client', ['bridge'], 4);
    await expect(
      catalog.handover('bridge', [{ cameraId: 'camera.one', clientId: 'client' }], 5),
    ).rejects.toThrow('native_ha_grant_revoked');
    const reopened = new HaCatalog(transactions);
    await reopened.initialize();
    expect(reopened.authenticate('digest')).toBeUndefined();
    expect(reopened.ownsActivity('camera.one')).toBe(false);
    expect(reopened.releasing('bridge')).toBe(true);
    expect(reopened.readyClient('camera.one', 'revision', 0)).toBeUndefined();
  } finally {
    await transactions.drain();
    await source.destroy();
  }
});
