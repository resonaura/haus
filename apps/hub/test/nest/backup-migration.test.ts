/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupCatalog } from '../../src/backup/catalog.js';
import { openCatalog } from '../../src/storage/source.js';
import { Transactions } from '../../src/storage/transactions.js';
import type { DataSource } from 'typeorm';

describe('Backup catalog TypeORM migration', () => {
  let tempDir: string | undefined;
  let source: DataSource | undefined;
  let transactions: Transactions | undefined;

  afterEach(async () => {
    await transactions?.drain();
    if (source?.isInitialized) await source.destroy();
    source = undefined;
    transactions = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('adopts backup rows and retry deadlines while adding archive generation', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-backup-upgrade-'));
    const database = join(tempDir, 'haus.sqlite');
    const legacy = new DatabaseSync(database);
    legacy.exec(`
      CREATE TABLE haus_backups (
        digest TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at INTEGER NOT NULL,
        bytes INTEGER NOT NULL, ha_slug TEXT
      );
      CREATE TABLE haus_backup_retries (
        kind TEXT PRIMARY KEY, next_at INTEGER NOT NULL, failures INTEGER NOT NULL
      );
      INSERT INTO haus_backups VALUES ('${'a'.repeat(64)}', 'ha', 100, 2048, 'owned-backup');
      INSERT INTO haus_backup_retries VALUES ('ha', 900000, 3);
    `);
    legacy.close();

    source = await openCatalog(database);
    transactions = new Transactions(source);
    const catalog = new BackupCatalog(transactions);
    await catalog.initialize();

    expect(catalog.list()).toEqual([
      {
        digest: 'a'.repeat(64),
        kind: 'ha',
        createdAt: 100,
        bytes: 2048,
        haSlug: 'owned-backup',
        archiveGeneration: null,
      },
    ]);
    expect(catalog.retry('ha')).toEqual({ kind: 'ha', nextAt: 900000, failures: 3 });
    const columns = (await source.query('PRAGMA table_info(haus_backups)')) as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toContain('archive_generation');

    await transactions.drain();
    transactions = undefined;
    await source.destroy();
    source = await openCatalog(database);
    transactions = new Transactions(source);
    const reopened = new BackupCatalog(transactions);
    await reopened.initialize();
    expect(reopened.list()[0]?.digest).toBe('a'.repeat(64));
    expect(reopened.retry('ha')).toEqual({ kind: 'ha', nextAt: 900000, failures: 3 });
  });
});
