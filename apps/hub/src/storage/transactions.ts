/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { realpathSync } from 'node:fs';
import type { DataSource, EntityManager } from 'typeorm';
import { LockEntity } from './entities/lock.js';
import { storageVersion } from './version.js';

const queues = new Map<string, Promise<void>>();
let memory = 0;
const memoryKeys = new WeakMap<DataSource, string>();
const lifecycles = new WeakMap<
  DataSource,
  { accepting: boolean; pending: Set<Promise<unknown>> }
>();

export function getDataSourceQueueKey(source: DataSource): string {
  if (source.options.database === ':memory:') {
    const key = memoryKeys.get(source) ?? `memory:${++memory}`;
    memoryKeys.set(source, key);
    return key;
  }
  return realpathSync(String(source.options.database));
}

export function getDataSourcePendingQueue(source: DataSource): Promise<void> {
  return queues.get(getDataSourceQueueKey(source)) ?? Promise.resolve();
}

export function scheduleDataSourceOperation<T>(
  source: DataSource,
  operation: () => Promise<T>,
): Promise<T> {
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

/** The better-sqlite3 QueryRunner shares a connection; serialize DataSources for the same file. */
export class Transactions {
  private readonly key: string;
  private readonly lifecycle: { accepting: boolean; pending: Set<Promise<unknown>> };
  constructor(
    private readonly source: DataSource,
    private readonly lock = { entity: LockEntity, version: storageVersion },
  ) {
    if (source.options.type !== 'better-sqlite3' || !source.isInitialized)
      throw Error('invalid_storage_source');
    this.lifecycle = lifecycles.get(source) ?? { accepting: true, pending: new Set() };
    lifecycles.set(source, this.lifecycle);
    this.key = getDataSourceQueueKey(source);
  }

  get dataSource(): DataSource {
    return this.source;
  }

  /** Serialize reads with writes because better-sqlite3 shares one connection. */
  read<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.schedule(() => operation(this.source.manager));
  }

  shares(other: Transactions): boolean {
    return this.key === other.key;
  }

  /** Stop admission synchronously, then let already-admitted local transactions finish. */
  async drain(): Promise<void> {
    this.lifecycle.accepting = false;
    await Promise.allSettled(this.lifecycle.pending);
  }

  run<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
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

  /** Run SQLite snapshot maintenance after local transactions, outside a transaction. */
  snapshotDatabase(path: string): Promise<void> {
    return this.schedule(async () => {
      await this.source.query('VACUUM INTO ?', [path]);
    });
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.lifecycle.accepting) return Promise.reject(Error('storage_closed'));
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
