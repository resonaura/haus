/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isErrCode } from './blob-readers.js';
import { digestPattern } from './blobs.js';
import type { Blobs } from './blobs.js';

export type CatalogKind = 'haus' | 'ha';

export interface CatalogEntry {
  digest: string;
  kind: CatalogKind;
  createdAt: number;
  bytes: number;
}

const kindPattern: Record<CatalogKind, number> = { haus: 24, ha: 7 };

export class Catalog {
  private entries = new Map<string, CatalogEntry>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly blobs: Blobs,
  ) {}

  async initialize(): Promise<void> {
    try {
      const stored: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(stored)) throw Error('invalid_backup_catalog');
      const entries = new Map<string, CatalogEntry>();
      for (const item of stored) {
        if (!isEntryLike(item) || entries.has(item.digest)) throw Error('invalid_backup_catalog');
        entries.set(item.digest, {
          digest: item.digest,
          kind: item.kind,
          createdAt: item.createdAt,
          bytes: item.bytes,
        });
      }
      this.entries = entries;
    } catch (error) {
      if (!isErrCode(error, 'ENOENT')) throw error;
    }
  }

  list(): CatalogEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({ ...row }));
  }

  async add(item: unknown): Promise<void> {
    const job = this.queue.then(async () => {
      if (
        !isEntryInput(item) ||
        !digestPattern.test(item.digest) ||
        !isCatalogKind(item.kind) ||
        !Number.isSafeInteger(item.createdAt) ||
        item.createdAt < 0 ||
        item.createdAt > Date.now() + 60000
      )
        throw new Error('invalid_backup_metadata');
      const info = await this.blobs.info(item.digest);
      if (info.size !== item.bytes) throw new Error('invalid_backup_size');
      const next = new Map(this.entries);
      next.set(item.digest, {
        digest: item.digest,
        kind: item.kind,
        createdAt: item.createdAt,
        bytes: item.bytes,
      });
      const counts: Record<CatalogKind, number> = { haus: 0, ha: 0 };
      const expired: string[] = [];
      for (const entry of [...next.values()].sort((a, b) => b.createdAt - a.createdAt)) {
        if (++counts[entry.kind] > kindPattern[entry.kind]) {
          next.delete(entry.digest);
          expired.push(entry.digest);
        }
      }
      await this.save(next);
      this.entries = next;
      for (const digest of expired) await this.blobs.remove(digest);
    });
    this.queue = job.catch(() => {});
    await job;
  }

  async remove(digest: string): Promise<void> {
    const job = this.queue.then(async () => {
      const next = new Map(this.entries);
      next.delete(digest);
      await this.save(next);
      this.entries = next;
    });
    this.queue = job.catch(() => {});
    await job;
  }

  private async save(entries: ReadonlyMap<string, CatalogEntry>): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}`;
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(temporary, 'wx', 0o600);
      await file.writeFile(
        JSON.stringify([...entries.values()].sort((a, b) => b.createdAt - a.createdAt)),
      );
      await file.sync();
      await file.close();
      file = undefined;
      await rename(temporary, this.path);
    } finally {
      try {
        await file?.close();
      } finally {
        await unlink(temporary).catch((error) => {
          if (!isErrCode(error, 'ENOENT')) throw error;
        });
      }
    }
  }
}

function isEntryInput(item: unknown): item is CatalogEntry {
  return (
    isRecord(item) &&
    typeof item.digest === 'string' &&
    typeof item.kind === 'string' &&
    isCatalogKind(item.kind) &&
    typeof item.createdAt === 'number' &&
    typeof item.bytes === 'number'
  );
}

function isCatalogKind(kind: string): kind is CatalogKind {
  return kind === 'haus' || kind === 'ha';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntryLike(
  item: unknown,
): item is { digest: string; kind: CatalogKind; createdAt: number; bytes: number } {
  return (
    isEntryInput(item) &&
    isCatalogKind(item.kind) &&
    digestPattern.test(item.digest) &&
    Number.isSafeInteger(item.createdAt) &&
    item.createdAt >= 0 &&
    Number.isSafeInteger(item.bytes) &&
    item.bytes > 0
  );
}
