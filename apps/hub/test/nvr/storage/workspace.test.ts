/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test, type TestContext } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, stat, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { Blobs, type BackingSample } from '../../../src/nvr/blobs.js';
import { required } from '../support/values.js';
async function fixture(
  t: TestContext,
  {
    free = 180,
    separate = true,
    backing = null,
  }: { free?: number; separate?: boolean; backing?: BackingSample | null } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'haus-workspace-'));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const workspaceRoot = join(root, 'work');
  await mkdir(workspaceRoot);
  let currentFree = free;
  let unavailable = false;
  const archive = join(root, 'archive');
  const blobs = new Blobs(archive, {
    workspaceRoot,
    reserveBytes: 100,
    inspect: async (path) => ({ dev: path === archive || !separate ? 1 : 2 }),
    filesystem: async (path) => {
      if (path === workspaceRoot && unavailable) throw Error('unavailable');
      return {
        bavail: path === workspaceRoot ? currentFree : 10000,
        bsize: 1,
        blocks: 20000,
      };
    },
    workspaceBackingCapacity: async () => backing,
  });
  await blobs.initialize();
  return {
    blobs,
    archive,
    workspaceRoot,
    setFree: (n: number) => {
      currentFree = n;
    },
    setUnavailable: () => {
      unavailable = true;
    },
  };
}

test('a full working disk rejects temporary work even when the archive has space', async (t) => {
  const { blobs } = await fixture(t, { free: 120 });
  assert.ok((await blobs.status()).availableBytes > 1000);
  await assert.rejects(blobs.reserveTransient(32), /storage_full/);
  assert.equal(blobs.reserved, 0);
  assert.equal(required((await blobs.status()).workspace).availableBytes, 20);
});

test('a full separate archive cannot block bounded camera rings on a healthy working disk', async (t) => {
  const { blobs, workspaceRoot, setFree, setUnavailable } = await fixture(t, {
    free: 260,
  });
  const original = blobs.filesystem;
  blobs.filesystem = async (path) =>
    path === workspaceRoot ? original(path) : { bavail: 90, bsize: 1, blocks: 20000 };
  blobs.setLimit(0);
  await assert.rejects(blobs.reserveTransient(32), /storage_full/);
  const release = await blobs.reserveWorkspace(80);
  const status = await blobs.status();
  assert.equal(status.availableBytes, 0);
  assert.equal(status.reservedBytes, 0, 'a ring does not reserve archive bytes');
  assert.equal(required(status.workspace).reservedBytes, 80);
  assert.equal(required(status.workspace).availableBytes, 80);
  release();
  release();
  assert.equal(blobs.workspaceReserved, 0);
  setFree(150);
  const both = await Promise.allSettled([blobs.reserveWorkspace(40), blobs.reserveWorkspace(40)]);
  assert.equal(both.filter((result) => result.status === 'fulfilled').length, 1);
  required(both.find((result) => result.status === 'fulfilled')).value();
  setUnavailable();
  await assert.rejects(blobs.reserveWorkspace(1), /storage_full/);
  assert.equal(blobs.workspaceReserved, 0);
  const same = await fixture(t, { separate: false, free: 260 });
  same.blobs.setLimit(0);
  await assert.rejects(same.blobs.reserveWorkspace(1), /storage_full/);
});

test('concurrent working reservations cannot overbook a separate filesystem and release is idempotent', async (t) => {
  const { blobs } = await fixture(t, { free: 190 });
  const results = await Promise.allSettled([
    blobs.reserveTransient(50),
    blobs.reserveTransient(50),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(required((await blobs.status()).workspace).reservedBytes, 50);
  const release = required(results.find((r) => r.status === 'fulfilled')).value;
  release();
  release();
  assert.equal(blobs.reserved, 0);
  assert.equal(required((await blobs.status()).workspace).reservedBytes, 0);
  const later = await blobs.reserveTransient(80);
  later();
});

test("an archive upload does not consume a different working filesystem's reservation", async (t) => {
  const { blobs, archive } = await fixture(t);
  const bytes = Buffer.alloc(500, 7);
  const id = createHash('sha256').update(bytes).digest('hex');
  const stream = new PassThrough();
  const reading = once(stream, 'resume', { signal: AbortSignal.timeout(5000) });
  const upload = blobs.put(id, stream, bytes.length);
  try {
    // Wait for the actual pipeline, not an arbitrary number of event-loop turns
    // that can elapse before a filesystem callback runs in a busy image build.
    await Promise.race([
      reading,
      upload.then(() => assert.fail('upload ended before its input started')),
    ]);
    assert.equal(blobs.active, 1);
    const release = await blobs.reserveTransient(50);
    assert.equal(required((await blobs.status()).workspace).reservedBytes, 50);
    release();
  } finally {
    stream.end(bytes);
    await upload;
  }
  assert.deepEqual(await readFile(join(archive, id)), bytes);
});

test('missing working filesystem telemetry rejects work without hiding readable archive capacity', async (t) => {
  const { blobs, setUnavailable } = await fixture(t);
  setUnavailable();
  await assert.rejects(blobs.reserveTransient(1), /storage_full/);
  const status = await blobs.status();
  assert.ok(status.availableBytes > 1000);
  assert.equal(required(status.workspace).state, 'unavailable');
  assert.equal(required(status.workspace).freeBytes, null);
  assert.equal(required(status.workspace).availableBytes, 0);
  assert.equal(blobs.reserved, 0);
});

test('a separate sparse workspace also respects its actual native backing capacity', async (t) => {
  const { blobs } = await fixture(t, {
    free: 1000000,
    backing: { state: 'fresh', availableBytes: 130, source: 'wsl-vhd' },
  });
  await assert.rejects(blobs.reserveTransient(31), /storage_full/);
  const release = await blobs.reserveTransient(30);
  assert.equal(required((await blobs.status()).workspace).availableBytes, 0);
  release();
});

test('unavailable native workspace backing is conservative and releases failed reservations', async (t) => {
  const { blobs } = await fixture(t, {
    free: 1000000,
    backing: { state: 'unavailable', source: 'wsl-vhd', availableBytes: 0 },
  });
  await assert.rejects(blobs.reserveTransient(1), /storage_full/);
  assert.equal(required((await blobs.status()).workspace).availableBytes, 0);
  assert.equal(blobs.reserved, 0);
});

test('real separate Linux tmpfs capacity bounds reservation without allocating a large buffer', async (t) => {
  const shm = await stat('/dev/shm').catch(() => null);
  if (!shm?.isDirectory()) return t.skip('Linux tmpfs unavailable');
  const root = await mkdtemp(join(tmpdir(), 'haus-real-workspace-'));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const workspace = await mkdtemp('/dev/shm/haus-real-workspace-');
  t.onTestFinished(() => rm(workspace, { recursive: true, force: true }));
  if ((await stat(root)).dev === (await stat(workspace)).dev)
    return t.skip('A separate filesystem is required');
  const free = await statfs(workspace);
  const archive = await statfs(root);
  const request = free.bavail * free.bsize + 1;
  if (request > 16 * 1024 ** 3 || request >= archive.bavail * archive.bsize)
    return t.skip('Workspace is not smaller than the archive for this fixture');
  const blobs = new Blobs(join(root, 'archive'), {
    workspaceRoot: workspace,
    reserveBytes: 0,
  });
  await blobs.initialize();
  await assert.rejects(blobs.reserveTransient(request), /storage_full/);
  assert.equal(required((await blobs.status()).workspace).separateFilesystem, true);
});

test('working admission recovers after capacity returns without retaining failed reservations', async (t) => {
  const { blobs, setFree } = await fixture(t, { free: 120 });
  await assert.rejects(blobs.reserveTransient(32), /storage_full/);
  setFree(260);
  const release = await blobs.reserveTransient(80);
  assert.equal(required((await blobs.status()).workspace).availableBytes, 80);
  release();
  assert.equal(required((await blobs.status()).workspace).reservedBytes, 0);
});
