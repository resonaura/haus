/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test, expect } from 'vitest';
import { StorageUsage } from '../../../src/storage/usage/scanner.js';
import type { ScanInfo } from '../../../src/storage/usage/types.js';

test('keeps fallback paths distinct from physical file identities', async () => {
  const info = (inode: bigint, directory = false): ScanInfo => ({
    isFile: () => !directory,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
    dev: 1n,
    ino: inode,
    size: directory ? 0n : 1n,
    blocks: 0n,
  });
  const scanner = new StorageUsage({
    roots: [{ id: 'data', path: '.' }],
    classify: () => () => 'other',
    inspect: async (path) => {
      if (path === '.') return info(9n, true);
      if (path === '1:2') return info(0n);
      if (path === 'other') return info(2n);
      throw Error('unexpected_fixture_path');
    },
    list: async () =>
      (async function* () {
        yield { name: '1:2' };
        yield { name: 'other' };
      })(),
  });
  const report = await scanner.collect();
  expect(report.files).toBe(2);
  expect(report.logicalBytes).toBe(2);
  expect(report.duplicateFiles).toBe(0);
});

for (const field of ['inode', 'device'])
  test(`preserves distinct 64-bit ${field} identities while deduplicating real hard links`, async () => {
    const large = 2n ** 53n;
    const file = (identity: bigint, size: bigint): ScanInfo => ({
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      dev: field === 'device' ? identity : 1n,
      ino: field === 'inode' ? identity : 1n,
      size,
      blocks: 0n,
    });
    const files = new Map<string, ScanInfo>([
      ['/fixture/a', file(large, 3n)],
      ['/fixture/b', file(large + 1n, 5n)],
      ['/fixture/link', file(large, 3n)],
    ]);
    const scanner = new StorageUsage({
      roots: [{ id: 'data', path: '/fixture' }],
      classify: () => () => 'originals',
      inspect: async (path) => {
        if (path === '/fixture')
          return {
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
            dev: 0n,
            ino: 1n,
            size: 0n,
            blocks: 0n,
          };
        const info = files.get(path);
        if (!info) throw Error('unexpected_fixture_path');
        return info;
      },
      list: async () =>
        (async function* () {
          for (const name of ['a', 'b', 'link']) yield { name };
        })(),
    });
    const report = await scanner.collect();
    expect(report.complete).toBe(true);
    expect(report.files).toBe(2);
    expect(report.logicalBytes).toBe(8);
    expect(report.duplicateFiles).toBe(1);
  });
