/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
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

interface LooseInput {
  digest?: unknown;
  kind?: unknown;
  createdAt?: unknown;
  bytes?: unknown;
}

const kindPattern: Record<CatalogKind, number> = { haus: 24, ha: 7 };

export class Catalog {
  private readonly entries = new Map<string, CatalogEntry>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly blobs: Blobs,
  ) {}

  async initialize(): Promise<void> {
    try {
      const stored: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(stored)) return;
      for (const item of stored) {
        if (!isEntryLike(item)) continue;
        this.entries.set(item.digest, {
          digest: item.digest,
          kind: item.kind,
          createdAt: item.createdAt,
          bytes: item.bytes,
        });
      }
    } catch (error) {
      if (!isErrCode(error, 'ENOENT')) throw error;
    }
  }

  list(): CatalogEntry[] {
    return [...this.entries.values()].sort((a, b) => b.createdAt - a.createdAt);
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
      this.entries.set(item.digest, {
        digest: item.digest,
        kind: item.kind,
        createdAt: item.createdAt,
        bytes: item.bytes,
      });
      const counts: Record<CatalogKind, number> = { haus: 0, ha: 0 };
      const expired: string[] = [];
      for (const entry of this.list()) {
        if (++counts[entry.kind] > kindPattern[entry.kind]) {
          this.entries.delete(entry.digest);
          expired.push(entry.digest);
        }
      }
      await this.save();
      for (const digest of expired) await this.blobs.remove(digest);
    });
    this.queue = job.catch(() => {});
    await job;
  }

  async remove(digest: string): Promise<void> {
    const job = this.queue.then(async () => {
      this.entries.delete(digest);
      await this.save();
    });
    this.queue = job.catch(() => {});
    await job;
  }

  private async save(): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}`;
    await writeFile(temporary, JSON.stringify(this.list()), {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, this.path);
  }
}

function isEntryInput(item: unknown): item is LooseInput & CatalogEntry {
  return (
    isRecord(item) &&
    typeof item.digest === 'string' &&
    typeof item.kind === 'string' &&
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
  return isEntryInput(item) && isCatalogKind(item.kind);
}
