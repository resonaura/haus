/*
 * Haus — A thoughtful home for Haus Hub.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface StorageRoot {
  id: string;
  path: string;
}

export interface ScanInfo {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  dev: unknown;
  ino: unknown;
  size: unknown;
  blocks: unknown;
}

export interface StorageCategoryRow {
  id: string;
  logicalBytes: number;
  allocatedBytes: number | null;
  files: number;
}

export interface StorageUsageReport {
  version: 1;
  sampledAt: number;
  complete: boolean;
  files?: number;
  duplicateFiles?: number;
  skippedLinks?: number;
  logicalBytes: number | null;
  allocatedBytes: number | null;
  categories: StorageCategoryRow[];
}

export type StorageClassifier = (rootId: string, relativePath: string) => string;
export type StorageClassifierFactory = () => StorageClassifier | Promise<StorageClassifier>;

export interface StorageUsageOptions {
  roots: StorageRoot[];
  classify: StorageClassifierFactory;
  now?: () => number;
  interval?: number;
  maxEntries?: number;
  budgetMs?: number;
  inspect?: (path: string, options: { bigint: true }) => Promise<ScanInfo>;
  list?: (path: string) => Promise<AsyncIterable<{ name: string }>>;
}
