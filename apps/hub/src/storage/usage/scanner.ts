/*
 * Haus — A thoughtful home for Haus Hub.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as yieldIO } from 'node:timers/promises';

import type {
  StorageUsageOptions,
  StorageUsageReport,
  ScanInfo,
  StorageCategoryRow,
  StorageRoot,
  StorageClassifierFactory,
} from './types.js';

/** File accounting only: never reads contents or follows symbolic links.
 * st_blocks is allocated filesystem space, not exclusive physical extents.
 * Hard links are counted once; reflink/compression sharing cannot be inferred.
 */
export class StorageUsage {
  private readonly roots: StorageRoot[];
  private readonly classify: StorageClassifierFactory;
  private readonly now: () => number;
  private readonly interval: number;
  private readonly maxEntries: number;
  private readonly budgetMs: number;
  private readonly inspect: (path: string, options: { bigint: true }) => Promise<ScanInfo>;
  private readonly list: (path: string) => Promise<AsyncIterable<{ name: string }>>;
  private value: StorageUsageReport | null = null;
  /** Exposed for tests and lifecycle joins: in-flight collection, if any. */
  loading?: Promise<void>;
  private startedAt = 0;
  private stopped = false;

  constructor({
    roots,
    classify,
    now = Date.now,
    interval = 30000,
    maxEntries = 100000,
    budgetMs = 3000,
    inspect = bigintLstat,
    list = openDirectory,
  }: StorageUsageOptions) {
    this.roots = roots;
    this.classify = classify;
    this.now = now;
    this.interval = interval;
    this.maxEntries = maxEntries;
    this.budgetMs = budgetMs;
    this.inspect = inspect;
    this.list = list;
  }

  status(): StorageUsageReport | null {
    if (
      !this.stopped &&
      !this.loading &&
      (!this.value || this.now() - this.startedAt >= this.interval)
    ) {
      this.startedAt = this.now();
      this.loading = Promise.resolve()
        .then(() => this.collect())
        .then((value) => {
          this.value = value;
        })
        .catch(() => {
          this.value = {
            version: 1,
            sampledAt: this.now(),
            complete: false,
            logicalBytes: null,
            allocatedBytes: null,
            categories: [],
          };
        })
        .finally(() => {
          this.loading = undefined;
        });
    }
    return this.value;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.loading;
    this.loading = undefined;
  }

  async collect(): Promise<StorageUsageReport> {
    const start = this.now();
    const started = performance.now();
    const files = new Map<
      string,
      { category: string; logicalBytes: number; allocatedBytes: number | null }
    >();
    const directories = new Set<string>();
    const roots = new Map(this.roots.map((root) => [root.path, root.id]));
    let complete = true;
    let visited = 0;
    let duplicateFiles = 0;
    let skippedLinks = 0;
    // Snapshot metadata once so concurrent recordings cannot change classification
    // half way through this scan. Callers provide a classifier for this generation.
    const classify = await this.classify();
    const queue = this.roots.map((root) => ({
      path: root.path,
      root: root.id,
      relative: '',
    }));
    const expired = () =>
      this.stopped || visited >= this.maxEntries || performance.now() - started > this.budgetMs;
    while (queue.length) {
      if (expired()) {
        complete = false;
        break;
      }
      const item = queue.pop();
      if (item === undefined) break;
      if (roots.get(item.path) !== undefined && roots.get(item.path) !== item.root) continue;
      let info: ScanInfo;
      try {
        info = await this.inspect(item.path, { bigint: true });
      } catch {
        complete = false;
        continue;
      }
      visited++;
      if (info.isSymbolicLink()) {
        skippedLinks++;
        continue;
      }
      const identity = fileIdentity(info) ?? 'path:' + item.path;
      if (info.isDirectory()) {
        if (directories.has(identity)) continue;
        directories.add(identity);
        try {
          const directory = await this.list(item.path);
          for await (const entry of directory) {
            if (expired()) {
              complete = false;
              break;
            }
            queue.push({
              path: join(item.path, entry.name),
              root: item.root,
              relative: item.relative ? `${item.relative}/${entry.name}` : entry.name,
            });
            // Bound directory enumeration as well as stat calls.
            if (queue.length + visited >= this.maxEntries) {
              complete = false;
              break;
            }
          }
        } catch {
          complete = false;
        }
      } else if (info.isFile()) {
        const size = Number(info.size);
        const blocks = Number(info.blocks);
        if (!Number.isSafeInteger(size) || size < 0) {
          complete = false;
          continue;
        }
        const category = classify(item.root, item.relative) || 'other';
        const previous = files.get(identity);
        if (previous) {
          duplicateFiles++;
          if (previous.category !== category) previous.category = 'shared';
        } else {
          files.set(identity, {
            category,
            logicalBytes: size,
            allocatedBytes:
              info.blocks !== undefined && Number.isSafeInteger(blocks * 512) && blocks >= 0
                ? blocks * 512
                : null,
          });
        }
      }
      if (visited % 64 === 0) await yieldIO();
    }
    const categories = new Map<string, StorageCategoryRow>();
    for (const file of files.values()) {
      const row = categories.get(file.category) ?? {
        id: file.category,
        logicalBytes: 0,
        allocatedBytes: 0,
        files: 0,
      };
      row.logicalBytes += file.logicalBytes;
      if (row.allocatedBytes === null || file.allocatedBytes === null) {
        row.allocatedBytes = null;
      } else {
        row.allocatedBytes += file.allocatedBytes;
      }
      row.files++;
      categories.set(row.id, row);
    }
    const rows = [...categories.values()].sort((a, b) => a.id.localeCompare(b.id));
    return {
      version: 1,
      sampledAt: start,
      complete,
      files: files.size,
      duplicateFiles,
      skippedLinks,
      logicalBytes: rows.reduce((sum, row) => sum + row.logicalBytes, 0),
      allocatedBytes: rows.some((row) => row.allocatedBytes === null)
        ? null
        : rows.reduce((sum, row) => sum + (row.allocatedBytes ?? 0), 0),
      categories: rows,
    };
  }
}

async function bigintLstat(path: string, options: { bigint: true }): Promise<ScanInfo> {
  return lstat(path, options);
}

async function openDirectory(path: string): Promise<AsyncIterable<{ name: string }>> {
  return opendir(path);
}

function fileIdentity(info: ScanInfo): string | undefined {
  const inode = identityComponent(info.ino),
    device = identityComponent(info.dev);
  return inode !== undefined && inode !== '0' && device !== undefined
    ? 'inode:' + device + ':' + inode
    : undefined;
}

function identityComponent(value: unknown): string | undefined {
  if (typeof value === 'bigint' && value >= 0n) return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    return value.toString();
  return undefined;
}
