/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, link, symlink, rm, open, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StorageUsage } from '../../../src/storage/usage/scanner.js';

const fixtures: string[] = [];

afterEach(async () => {
  const roots = fixtures.splice(0);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'haus-usage-'));
  fixtures.push(root);
  return root;
}

test('measures sparse allocation, deduplicates hard links and does not follow links outside managed roots', async () => {
  const root = await fixture();
  const data = join(root, 'data');
  await mkdir(data);
  const file = join(data, 'original');
  const copy = join(data, 'prepared');
  const handle = await open(file, 'w');
  await handle.truncate(10 * 1024 ** 2);
  await handle.close();
  await link(file, copy);
  await writeFile(join(root, 'private'), 'must-not-count-or-read');
  await symlink(join(root, 'private'), join(data, 'external'));
  const scanner = new StorageUsage({
    roots: [{ id: 'data', path: data }],
    classify: () => (_root, name) => name,
  });
  const value = await scanner.collect();
  expect(value.complete).toBe(true);
  expect(value.files).toBe(1);
  expect(value.duplicateFiles).toBe(1);
  expect(value.skippedLinks).toBe(1);
  expect(value.logicalBytes).toBe(10 * 1024 ** 2);
  expect(value.allocatedBytes).toBe((await lstat(file)).blocks * 512);
  expect(value.categories[0].id).toBe('shared');
  expect(JSON.stringify(value).includes('private')).toBe(false);
});

test('nested roots keep their classifier, scans coalesce and cached status never blocks the resource response', async () => {
  const root = await fixture();
  const media = join(root, 'media');
  await mkdir(media);
  await writeFile(join(media, 'clip'), '123');
  let at = 1000;
  let classifications = 0;
  const scanner = new StorageUsage({
    roots: [
      { id: 'media', path: media },
      { id: 'data', path: root },
    ],
    now: () => at,
    classify: () => {
      classifications++;
      return (id) => id;
    },
  });
  expect(scanner.status()).toBeNull();
  scanner.status();
  await scanner.loading;
  expect(classifications).toBe(1);
  expect(scanner.status()?.categories[0]?.id).toBe('media');
  expect(scanner.status()?.logicalBytes).toBe(3);
  at += 30001;
  scanner.status();
  await scanner.loading;
  expect(classifications).toBe(2);
  await scanner.stop();
  at += 30001;
  scanner.status();
  expect(scanner.loading).toBeUndefined();
});

test('bounded and unreadable scans are explicitly partial; missing allocation is never logical bytes in disguise', async () => {
  const root = await fixture();
  await writeFile(join(root, 'a'), 'abc');
  await writeFile(join(root, 'b'), 'def');
  const base = {
    roots: [{ id: 'data', path: root }],
    classify: (): ((root: string, path: string) => string) => () => 'other',
  };
  expect((await new StorageUsage({ ...base, maxEntries: 1 }).collect()).complete).toBe(false);
  const scanner = new StorageUsage({
    ...base,
    inspect: async (path, options) => {
      if (path === join(root, 'b')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      const info = await lstat(path, options);
      // Snapshot without st_blocks: methods survive; allocation becomes unknown.
      return {
        isFile: () => info.isFile(),
        isDirectory: () => info.isDirectory(),
        isSymbolicLink: () => info.isSymbolicLink(),
        dev: info.dev,
        ino: info.ino,
        size: info.size,
        blocks: undefined,
      };
    },
  });
  const value = await scanner.collect();
  expect(value.complete).toBe(false);
  expect(value.logicalBytes).toBe(3);
  expect(value.allocatedBytes).toBeNull();
});
