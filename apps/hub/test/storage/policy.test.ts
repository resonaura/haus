/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ServiceCatalog } from '../../src/servers/catalog.js';
import { openCatalog } from '../../src/storage/source.js';
import { Transactions } from '../../src/storage/transactions.js';

describe('TypeORM service catalog', () => {
  let directory: string | undefined;
  const owners: Array<{ source: Awaited<ReturnType<typeof openCatalog>>; tx: Transactions }> = [];

  afterEach(async () => {
    for (const { source, tx } of owners) {
      await tx.drain();
      if (source.isInitialized) await source.destroy();
    }
    owners.length = 0;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function open(database: string) {
    const source = await openCatalog(database);
    const tx = new Transactions(source);
    owners.push({ source, tx });
    const catalog = new ServiceCatalog(tx);
    await catalog.initialize();
    return { source, tx, catalog };
  }

  it('adopts legacy policies and plugin pins and retains them through snapshots and reopen', async () => {
    directory = await mkdtemp(join(tmpdir(), 'haus-policy-upgrade-'));
    const database = join(directory, 'haus.sqlite');
    const legacy = new DatabaseSync(database);
    legacy.exec(`
      CREATE TABLE service_policy(id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE kitsune_plugins(vendor TEXT PRIMARY KEY,version TEXT);
      INSERT INTO service_policy VALUES('primary-storage','{"storageLimitBytes":null,"source":"user"}');
      INSERT INTO service_policy VALUES('retained-policy','{"unknown":"preserved"}');
      INSERT INTO kitsune_plugins VALUES('rtsp','1.2.3');
      INSERT INTO kitsune_plugins VALUES('native',NULL);
    `);
    legacy.close();
    const { source, tx, catalog } = await open(database);
    expect(catalog.policy('primary-storage')).toBe('{"storageLimitBytes":null,"source":"user"}');
    expect(catalog.policy('retained-policy')).toBe('{"unknown":"preserved"}');
    expect(catalog.plugins()).toEqual(
      expect.arrayContaining([
        { vendor: 'rtsp', version: '1.2.3' },
        { vendor: 'native', version: null },
      ]),
    );

    const updated = '{"storageLimitBytes":1073741824,"source":"user"}';
    await catalog.savePolicy('primary-storage', updated);
    await catalog.savePlugin('rtsp', '2.0.0');
    const snapshot = join(directory, 'snapshot.sqlite');
    await source.query('VACUUM INTO ?', [snapshot]);
    const restored = await open(snapshot);
    expect(restored.catalog.policy('primary-storage')).toBe(updated);
    expect(restored.catalog.plugins()).toContainEqual({ vendor: 'rtsp', version: '2.0.0' });
    await tx.drain();
    await source.destroy();
    const reopened = await open(database);
    expect(reopened.catalog.policy('primary-storage')).toBe(updated);
    expect(reopened.catalog.policy('retained-policy')).toBe('{"unknown":"preserved"}');
    expect(reopened.catalog.plugins()).toContainEqual({ vendor: 'native', version: null });
  });

  it('does not publish writes that cannot commit and returns defensive plugin snapshots', async () => {
    directory = await mkdtemp(join(tmpdir(), 'haus-policy-commit-'));
    const { tx, catalog } = await open(join(directory, 'haus.sqlite'));
    await catalog.savePolicy('primary-storage', 'original');
    await catalog.savePlugin('rtsp', '1.2.3');
    const plugins = catalog.plugins();
    if (plugins[0]) plugins[0].version = 'mutated';
    expect(catalog.plugins()[0]?.version).toBe('1.2.3');
    await tx.drain();
    await expect(catalog.savePolicy('primary-storage', 'uncommitted')).rejects.toThrow(
      'storage_closed',
    );
    await expect(catalog.savePlugin('rtsp', 'uncommitted')).rejects.toThrow('storage_closed');
    expect(catalog.policy('primary-storage')).toBe('original');
    expect(catalog.plugins()[0]?.version).toBe('1.2.3');
  });
});
