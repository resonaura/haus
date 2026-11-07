/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { Blobs, type BackingSample } from '../../src/nvr/blobs.js';
const backing = (at = 10000, changes = {}) => ({
  source: 'wsl-vhd',
  device: 2112,
  sampledAt: new Date(at).toISOString(),
  totalBytes: 256000,
  availableBytes: 62000,
  volume: 'C:',
  ...changes,
});
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');

test('native capacity bounds unlimited writes, concurrent reservations and repeated stale-sample growth without changing originals', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-wsl-storage-'));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  let at = 10000;
  let capacity: BackingSample = { ...backing(at), state: 'fresh', availableBytes: 1000 };
  const blobs = new Blobs(root, {
    now: () => at,
    reserveBytes: 100,
    backingCapacity: async () => capacity,
    filesystem: async () => ({ bavail: 1000000, bsize: 1, blocks: 2000000 }),
  });
  await blobs.initialize();
  assert.equal((await blobs.status()).availableBytes, 900);
  assert.equal((await blobs.status()).storageLimitBytes, null);
  const original = Buffer.alloc(400, 1);
  await blobs.put(digest(original), Readable.from(original), original.length);
  assert.equal((await blobs.status()).availableBytes, 500);
  // A duplicate digest consumes no additional physical growth.
  await blobs.put(digest(original), Readable.from(original), original.length);
  assert.equal((await blobs.status()).availableBytes, 500);
  const release = await blobs.reserveTransient(400);
  await assert.rejects(blobs.reserveTransient(101), /storage_full/);
  release();
  const other = Buffer.alloc(400, 2);
  await blobs.put(digest(other), Readable.from(other), other.length);
  assert.equal((await blobs.status()).availableBytes, 100);
  const refused = Buffer.alloc(101, 3);
  await assert.rejects(
    blobs.put(digest(refused), Readable.from(refused), refused.length),
    /storage_full/,
  );
  assert.equal(blobs.reserved, 0);
  assert.equal(blobs.active, 0);
  assert.deepEqual((await readdir(root)).sort(), [digest(original), digest(other)].sort());
  capacity = { state: 'unavailable', source: 'wsl-vhd', availableBytes: 0 };
  assert.equal((await blobs.status()).availableBytes, 0);
  await assert.rejects(blobs.reserveTransient(1), /storage_full/);
  assert.deepEqual(await readFile(join(root, digest(original))), original);
  at = 12000;
  capacity = { ...backing(at), state: 'fresh', availableBytes: 200 };
  assert.equal((await blobs.status()).availableBytes, 100);
  blobs.setLimit(800);
  assert.equal((await blobs.status()).availableBytes, 0);
  blobs.setLimit(null);
  assert.equal((await blobs.status()).availableBytes, 100);
  assert.equal(blobs.growth.size, 1);
  at = 45000;
  await blobs.status();
  assert.equal(blobs.growth.size, 0);
});
