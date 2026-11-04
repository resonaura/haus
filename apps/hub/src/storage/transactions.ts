/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { realpathSync } from 'node:fs';
import type { DataSource, EntityManager } from 'typeorm';
import { LockEntity } from './entities/lock.js';
import { storageVersion } from './version.js';

const queues = new Map<string, Promise<void>>();
let memory = 0;
const memoryKeys = new WeakMap<DataSource, string>();

/** The better-sqlite3 QueryRunner shares a connection; serialize DataSources for the same file. */
export class Transactions {
  private readonly key: string;
  constructor(private readonly source: DataSource) {
    if (source.options.type !== 'better-sqlite3' || !source.isInitialized)
      throw Error('invalid_storage_source');
    if (source.options.database === ':memory:') {
      const key = memoryKeys.get(source) ?? `memory:${++memory}`;
      memoryKeys.set(source, key);
      this.key = key;
    } else this.key = realpathSync(source.options.database);
  }

  run<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    const previous = queues.get(this.key) ?? Promise.resolve();
    const result = previous.then(() =>
      this.source.transaction('SERIALIZABLE', async (manager) => {
        // Acquire SQLite's writer lock before reading. Other processes wait rather than racing a deferred write.
        const lock = await manager.update(
          LockEntity,
          { id: 1, version: storageVersion },
          { version: storageVersion },
        );
        if (lock.affected !== 1) throw Error('invalid_platform_storage_version');
        return operation(manager);
      }),
    );
    const settled = result.then(
      () => {},
      () => {},
    );
    queues.set(this.key, settled);
    void settled.then(() => {
      if (queues.get(this.key) === settled) queues.delete(this.key);
    });
    return result;
  }
}
