/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DataSource, EntityManager } from 'typeorm';
import { isPostgresSource, isSupportedDataSource } from './dialect.js';
import { LockEntity } from './entities/lock.js';
import { exportPostgresCatalogToSqlite } from './portable-snapshot.js';
import { storageVersion } from './version.js';

const queues = new Map<string, Promise<void>>();
const pgPendingOps = new WeakMap<DataSource, Set<Promise<unknown>>>();
let memory = 0;
const dataSourceKeys = new WeakMap<DataSource, string>();
const lifecycles = new WeakMap<
  DataSource,
  {
    accepting: boolean;
    pending: Set<Promise<unknown>>;
    flushers: Set<() => Promise<void>>;
    flushing: boolean;
  }
>();

export function getDataSourceQueueKey(source: DataSource): string {
  if (isPostgresSource(source)) {
    const cached = dataSourceKeys.get(source);
    if (cached) return cached;
    const opts = source.options as {
      url?: string;
      host?: string;
      port?: number;
      database?: string;
    };
    const key = `postgres:${opts.url ?? `${opts.host ?? 'localhost'}:${opts.port ?? 5432}/${String(opts.database ?? '')}`}`;
    dataSourceKeys.set(source, key);
    return key;
  }
  if (source.options.database === ':memory:') {
    const key = dataSourceKeys.get(source) ?? `memory:${++memory}`;
    dataSourceKeys.set(source, key);
    return key;
  }
  const database = String(source.options.database);
  try {
    const key = realpathSync(database);
    dataSourceKeys.set(source, key);
    return key;
  } catch {
    return dataSourceKeys.get(source) ?? resolve(database);
  }
}

export function getDataSourcePendingQueue(source: DataSource): Promise<void> {
  if (isPostgresSource(source)) {
    const active = pgPendingOps.get(source);
    if (!active || active.size === 0) return Promise.resolve();
    return Promise.allSettled(active).then(() => {});
  }
  return queues.get(getDataSourceQueueKey(source)) ?? Promise.resolve();
}

function isRetryablePostgresError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const driverError =
    'driverError' in error && error.driverError && typeof error.driverError === 'object'
      ? (error.driverError as { code?: unknown })
      : (error as { code?: unknown });
  return driverError.code === '40P01' || driverError.code === '40001';
}

async function runWithPostgresRetry<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryablePostgresError(error)) throw error;
      const delayMs = 15 * attempt + Math.floor(Math.random() * 15);
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw Error('postgres_retry_exhausted');
}

export function scheduleDataSourceOperation<T>(
  source: DataSource,
  operation: () => Promise<T>,
): Promise<T> {
  if (isPostgresSource(source)) {
    let active = pgPendingOps.get(source);
    if (!active) {
      active = new Set();
      pgPendingOps.set(source, active);
    }
    const result = Promise.resolve().then(operation);
    active.add(result);
    const cleanup = () => {
      active?.delete(result);
    };
    void result.then(cleanup, cleanup);
    return result;
  }
  const key = getDataSourceQueueKey(source);
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(
    () => {},
    () => {},
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return result;
}

/**
 * Coordinates transactions across SQLite (serialized single writer) and PostgreSQL
 * (concurrent MVCC connection pool with READ COMMITTED isolation).
 */
export class Transactions {
  private readonly key: string;
  private readonly isPg: boolean;
  private readonly lifecycle: {
    accepting: boolean;
    pending: Set<Promise<unknown>>;
    flushers: Set<() => Promise<void>>;
    flushing: boolean;
  };
  constructor(
    private readonly source: DataSource,
    private readonly lock = { entity: LockEntity, version: storageVersion },
  ) {
    if (!isSupportedDataSource(source)) throw Error('invalid_storage_source');
    this.isPg = isPostgresSource(source);
    this.lifecycle = lifecycles.get(source) ?? {
      accepting: true,
      pending: new Set(),
      flushers: new Set(),
      flushing: false,
    };
    lifecycles.set(source, this.lifecycle);
    this.key = getDataSourceQueueKey(source);
  }

  onFlush(flusher: () => Promise<void>): () => void {
    this.lifecycle.flushers.add(flusher);
    return () => this.lifecycle.flushers.delete(flusher);
  }

  private async flushPending(): Promise<void> {
    if (this.lifecycle.flushing || !this.lifecycle.accepting || this.lifecycle.flushers.size === 0)
      return;
    this.lifecycle.flushing = true;
    try {
      for (const flusher of Array.from(this.lifecycle.flushers)) await flusher();
    } finally {
      this.lifecycle.flushing = false;
    }
  }

  get dataSource(): DataSource {
    return this.source;
  }

  /** Serializes reads on SQLite; executes concurrently on PostgreSQL pool. */
  async read<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    await this.flushPending();
    return this.schedule(() => operation(this.source.manager));
  }

  shares(other: Transactions): boolean {
    return this.key === other.key;
  }

  /** Stop admission synchronously after flushing buffered saves, then let admitted transactions finish. */
  async drain(): Promise<void> {
    await this.flushPending();
    this.lifecycle.accepting = false;
    await Promise.allSettled(this.lifecycle.pending);
  }

  async run<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    await this.flushPending();
    if (this.isPg) {
      return this.schedule(() =>
        runWithPostgresRetry(() => this.source.transaction('READ COMMITTED', operation)),
      );
    }
    return this.schedule(() =>
      this.source.transaction('SERIALIZABLE', async (manager) => {
        // Acquire SQLite's writer lock before reading. Other processes wait rather than racing a deferred write.
        const lock = await manager.update(
          this.lock.entity,
          { id: 1, version: this.lock.version },
          { version: this.lock.version },
        );
        if (lock.affected !== 1) throw Error('invalid_platform_storage_version');
        return operation(manager);
      }),
    );
  }

  /** Exports a consistent SQLite snapshot file (VACUUM INTO on SQLite, REPEATABLE READ export on PG). */
  snapshotDatabase(path: string): Promise<void> {
    return this.schedule(async () => {
      if (this.isPg) {
        const { openCatalog } = await import('./source.js');
        await exportPostgresCatalogToSqlite(this.source, path, openCatalog);
        return;
      }
      await this.source.query('VACUUM INTO ?', [path]);
    });
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.lifecycle.accepting) return Promise.reject(Error('storage_closed'));
    if (this.isPg) {
      const result = Promise.resolve().then(operation);
      this.lifecycle.pending.add(result);
      const cleanup = () => {
        this.lifecycle.pending.delete(result);
      };
      void result.then(cleanup, cleanup);
      return result;
    }
    const previous = queues.get(this.key) ?? Promise.resolve();
    const result = previous.then(operation);
    this.lifecycle.pending.add(result);
    const settled = result.then(
      () => {},
      () => {},
    );
    queues.set(this.key, settled);
    void settled.then(() => {
      this.lifecycle.pending.delete(result);
      if (queues.get(this.key) === settled) queues.delete(this.key);
    });
    return result;
  }
}
