/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DataSource } from 'typeorm';
import type { BackupRetryRow, BackupRow } from '../storage/entities/domains.js';
import { BackupEntity, BackupRetryEntity } from '../storage/entities/domains.js';
import type { Transactions } from '../storage/transactions.js';

/** TypeORM-owned backup metadata with a synchronous, read-only runtime snapshot. */
export class BackupCatalog {
  private readonly backups = new Map<string, BackupRow>();
  private readonly retries = new Map<string, BackupRetryRow>();
  private readonly source: DataSource;
  private initialized?: Promise<void>;

  constructor(private readonly transactions: Transactions) {
    this.source = transactions.dataSource;
  }

  initialize(): Promise<void> {
    this.initialized ??= this.readSnapshot();
    return this.initialized;
  }

  list(): BackupRow[] {
    this.assertInitialized();
    return [...this.backups.values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((row) => ({ ...row }));
  }

  retry(kind: string): BackupRetryRow | undefined {
    this.assertInitialized();
    const row = this.retries.get(kind);
    return row ? { ...row } : undefined;
  }

  async saveBackup(row: BackupRow): Promise<void> {
    this.assertInitialized();
    await this.transactions.run(async (manager) => {
      await manager.upsert(BackupEntity, row, ['digest']);
    });
    this.backups.set(row.digest, { ...row });
  }

  async removeBackup(digest: string): Promise<void> {
    this.assertInitialized();
    await this.transactions.run(async (manager) => {
      await manager.delete(BackupEntity, { digest });
    });
    this.backups.delete(digest);
  }

  async clearRetry(kind: string): Promise<void> {
    this.assertInitialized();
    await this.transactions.run(async (manager) => {
      await manager.delete(BackupRetryEntity, { kind });
    });
    this.retries.delete(kind);
  }

  async saveRetry(row: BackupRetryRow): Promise<void> {
    this.assertInitialized();
    await this.transactions.run(async (manager) => {
      await manager.upsert(BackupRetryEntity, row, ['kind']);
    });
    this.retries.set(row.kind, { ...row });
  }

  async recordFailure(kind: string, now = Date.now()): Promise<BackupRetryRow> {
    this.assertInitialized();
    const row = await this.transactions.run(async (manager) => {
      const previous = await manager.findOneBy(BackupRetryEntity, { kind });
      const failures = Math.min(20, (previous?.failures ?? 0) + 1);
      const retry = {
        kind,
        nextAt: now + Math.min(3600000, 300000 * 2 ** Math.min(failures - 1, 4)),
        failures,
      };
      await manager.upsert(BackupRetryEntity, retry, ['kind']);
      return retry;
    });
    this.retries.set(kind, row);
    return { ...row };
  }

  async snapshotDatabase(path: string): Promise<void> {
    this.assertInitialized();
    await this.transactions.snapshotDatabase(path);
  }

  private assertInitialized(): void {
    if (!this.initialized) throw Error('backup_catalog_not_initialized');
  }

  private async readSnapshot(): Promise<void> {
    const [backups, retries] = await Promise.all([
      this.source.manager.find(BackupEntity),
      this.source.manager.find(BackupRetryEntity),
    ]);
    for (const row of backups) this.backups.set(row.digest, row);
    for (const row of retries) this.retries.set(row.kind, row);
  }
}
