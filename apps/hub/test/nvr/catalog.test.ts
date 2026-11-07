/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { Blobs } from '../../src/nvr/blobs.js';
import { Catalog } from '../../src/nvr/catalog.js';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'haus-nvr-catalog-'));
  const directory = join(root, 'metadata');
  await mkdir(directory);
  const path = join(directory, 'catalog.json');
  const blobs = new Blobs(join(root, 'blobs'), { reserveBytes: 0 });
  await blobs.initialize();
  const catalog = new Catalog(path, blobs);
  await catalog.initialize();
  const item = async (value: string, at = Date.now(), kind = 'haus') => {
    const bytes = Buffer.from(value);
    const digest = createHash('sha256').update(bytes).digest('hex');
    await blobs.put(digest, Readable.from([bytes]), bytes.length);
    return { digest, kind, createdAt: at, bytes: bytes.length };
  };
  return { root, directory, path, blobs, catalog, item };
}

it('publishes only saved catalog changes, recovers its queue after failure and survives restart', async () => {
  const f = await fixture();
  try {
    const first = await f.item('first');
    await f.catalog.add(first);
    const before = await readFile(f.path, 'utf8');
    const second = await f.item('second');
    await rename(f.directory, f.directory + '-offline');
    await expect(f.catalog.add(second)).rejects.toThrow();
    expect(f.catalog.list()).toEqual([first]);
    await expect(f.catalog.remove(first.digest)).rejects.toThrow();
    expect(f.catalog.list()).toEqual([first]);
    await rename(f.directory + '-offline', f.directory);
    expect(await readFile(f.path, 'utf8')).toBe(before);
    await f.catalog.add(second);
    const restarted = new Catalog(f.path, f.blobs);
    await restarted.initialize();
    expect(restarted.list()).toEqual(f.catalog.list());
    const exposed = restarted.list()[0];
    if (!exposed) throw Error('missing_fixture_entry');
    exposed.bytes = 999;
    expect(restarted.list()).toEqual(f.catalog.list());
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('retains each backup kind independently and never deletes a blob before the catalog commits', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 24; i++) await f.catalog.add(await f.item(`haus-${i}`, i));
    const oldest = f.catalog.list().at(-1);
    if (!oldest) throw Error('missing_fixture_entry');
    await rename(f.directory, f.directory + '-offline');
    await expect(f.catalog.add(await f.item('overflow', 25))).rejects.toThrow();
    expect(f.catalog.list()).toHaveLength(24);
    expect(await f.blobs.info(oldest.digest)).toMatchObject({ size: oldest.bytes });
    await rename(f.directory + '-offline', f.directory);
    await f.catalog.add(await f.item('overflow', 25));
    await expect(f.blobs.info(oldest.digest)).rejects.toMatchObject({ code: 'ENOENT' });
    for (let i = 0; i < 8; i++) await f.catalog.add(await f.item(`ha-${i}`, i, 'ha'));
    expect(f.catalog.list().filter((row) => row.kind === 'haus')).toHaveLength(24);
    expect(f.catalog.list().filter((row) => row.kind === 'ha')).toHaveLength(7);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('rejects malformed saved metadata without accepting a partially loaded catalog', async () => {
  const f = await fixture();
  try {
    const first = await f.item('first');
    for (const value of [{}, [first, { ...first, digest: '../unsafe' }]]) {
      await writeFile(f.path, JSON.stringify(value));
      const catalog = new Catalog(f.path, f.blobs);
      await expect(catalog.initialize()).rejects.toThrow('invalid_backup_catalog');
      expect(catalog.list()).toEqual([]);
    }
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
