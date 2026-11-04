/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { StorageBackend } from '../contracts.js';

/** Plugin-scoped 0600 storage. Host deployments may inject the existing Haus DB instead. */
export class FileStorage implements StorageBackend {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  private path(scope: string) {
    return join(this.directory, `${createHash('sha256').update(scope).digest('hex')}.json`);
  }
  get(scope: string): Record<string, string> {
    try {
      const value: unknown = JSON.parse(readFileSync(this.path(scope), 'utf8'));
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.values(value).every((v) => typeof v === 'string')
      )
        return Object.assign(Object.create(null), value);
      throw Error('kitsune_storage_corrupt');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.create(null);
      throw error;
    }
  }
  set(scope: string, key: string, value: string | null) {
    const data = this.get(scope);
    if (value === null) delete data[key];
    else data[key] = value;
    const path = this.path(scope),
      temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
    renameSync(temporary, path);
  }
}
export function deviceStorage(backend: StorageBackend, scope: string) {
  return {
    get length() {
      return Object.keys(backend.get(scope)).length;
    },
    key(index: number) {
      return Object.keys(backend.get(scope))[index] ?? null;
    },
    getItem(key: string) {
      return backend.get(scope)[key] ?? null;
    },
    setItem(key: string, value: string) {
      backend.set(scope, String(key), String(value));
    },
    removeItem(key: string) {
      backend.set(scope, key, null);
    },
    clear() {
      for (const key of Object.keys(backend.get(scope))) backend.set(scope, key, null);
    },
  };
}
