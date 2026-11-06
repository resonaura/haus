/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdir, stat, statfs, readdir, open, link, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { BlobReaders, openBlobRead, isErrCode } from './blob-readers.js';
import type { BlobReadHandle, BlobRelease } from './blob-readers.js';
import { BlobVerification } from './blob-verification.js';
import type { BlobVerificationOptions, BlobVerificationStatus } from './blob-verification.js';

export const digestPattern = /^[a-f0-9]{64}$/;

export interface VolumeSample {
  bsize: number;
  blocks: number;
  bavail: number;
  bfree?: number;
}

export interface BackingSample {
  state: string;
  sampledAt?: string;
  availableBytes: number;
  source?: string;
}

export interface BlobStatus {
  usedBytes: number;
  maxBytes: number;
  storageLimitBytes: number | null;
  limitSource: string;
  reserveBytes: number;
  totalBytes: number;
  availableBytes: number;
  freeBytes: number;
  reservedBytes: number;
  activeTransfers: number;
  verification: BlobVerificationStatus;
  backing?: BackingSample;
  workspace?: WorkspaceStatus;
}

export interface WorkspaceStatus {
  state: 'fresh' | 'unavailable';
  separateFilesystem: boolean;
  freeBytes: number | null;
  reserveBytes: number;
  reservedBytes: number;
  availableBytes: number;
  backing?: BackingSample;
}

export interface BlobStorageOptions {
  maxBytes?: number | null;
  reserveBytes?: number;
  maxTransfers?: number;
  maxFileBytes?: number;
  filesystem?: (path: string) => Promise<VolumeSample>;
  workspaceRoot?: string;
  inspect?: (path: string) => Promise<{ dev: number }>;
  workspaceBackingCapacity?: () => Promise<BackingSample | null>;
  backingCapacity?: () => Promise<BackingSample | null>;
  verification?: BlobVerificationOptions;
  now?: () => number;
}

export function blobPath(root: string, id: string): string {
  if (!digestPattern.test(id)) throw new Error('invalid_digest');
  return join(root, id);
}

export class Blobs {
  root: string;
  maxBytes: number | null;
  reserveBytes: number;
  maxTransfers: number;
  maxFileBytes: number;
  filesystem: (path: string) => Promise<VolumeSample>;
  workspaceRoot: string;
  workspaceReserved = 0;
  workspaceSeparate = false;
  workspaceSameFilesystem: boolean;
  used = 0;
  reserved = 0;
  active = 0;
  readers = new BlobReaders();
  verification: BlobVerification;
  growth = new Map<number, number>();
  limitSource: string;
  private readonly inspect: (path: string) => Promise<{ dev: number }>;
  private readonly workspaceBackingCapacity: () => Promise<BackingSample | null>;
  private readonly backingCapacity: () => Promise<BackingSample | null>;
  private readonly now: () => number;
  constructor(
    root: string,
    {
      maxBytes = null,
      reserveBytes = 512 * 1024 ** 2,
      maxTransfers = 2,
      maxFileBytes = 16 * 1024 ** 3,
      filesystem = statfs,
      workspaceRoot = root,
      inspect = stat,
      workspaceBackingCapacity = async () => null,
      verification = {},
      backingCapacity = async () => null,
      now = Date.now,
    }: BlobStorageOptions = {},
  ) {
    this.root = root;
    this.maxBytes = maxBytes;
    this.reserveBytes = reserveBytes;
    this.maxTransfers = maxTransfers;
    this.maxFileBytes = maxFileBytes;
    this.filesystem = filesystem;
    this.workspaceRoot = workspaceRoot;
    this.workspaceSameFilesystem = workspaceRoot === root;
    this.backingCapacity = backingCapacity;
    this.inspect = inspect;
    this.workspaceBackingCapacity = workspaceBackingCapacity;
    this.now = now;
    this.limitSource = maxBytes === null ? 'default' : 'environment';
    this.verification = new BlobVerification(this, verification);
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (this.workspaceRoot !== this.root) {
      const [archive, workspace] = await Promise.all([
        this.inspect(this.root),
        this.inspect(this.workspaceRoot),
      ]);
      const known = archive.dev > 0 && workspace.dev > 0;
      this.workspaceSeparate = known && archive.dev !== workspace.dev;
      this.workspaceSameFilesystem = known && archive.dev === workspace.dev;
    }
    for (const name of await readdir(this.root)) {
      if (name.startsWith('.partial-')) await unlink(join(this.root, name));
      else if (digestPattern.test(name)) this.used += (await stat(blobPath(this.root, name))).size;
    }
  }

  async status(): Promise<BlobStatus> {
    const capacity = await this.diskCapacity();
    const { filesystem, freeBytes, backing } = capacity;
    const workspace = await this.workspaceCapacity(capacity);
    const diskAvailable = Math.max(0, freeBytes - this.reserveBytes);
    const availableBytes = Math.max(
      0,
      Math.min(diskAvailable, (this.maxBytes ?? Number.POSITIVE_INFINITY) - this.used) -
        this.reserved,
    );
    return {
      usedBytes: this.used,
      // Older helpers require a finite capacity even for an unlimited policy.
      maxBytes: Math.min(this.maxBytes ?? Number.POSITIVE_INFINITY, this.used + diskAvailable),
      storageLimitBytes: this.maxBytes,
      limitSource: this.limitSource,
      reserveBytes: this.reserveBytes,
      totalBytes: filesystem.blocks * filesystem.bsize,
      availableBytes,
      freeBytes,
      reservedBytes: this.reserved,
      activeTransfers: this.active,
      verification: this.verification.status(),
      ...(backing ? { backing } : {}),
      ...(workspace ? { workspace } : {}),
    };
  }

  async diskCapacity(): Promise<{
    filesystem: VolumeSample;
    freeBytes: number;
    backing: BackingSample | null;
  }> {
    const filesystem = await this.filesystem(this.root);
    const backing = await this.backingCapacity();
    let freeBytes = filesystem.bavail * filesystem.bsize;
    if (backing) {
      const sampled = Date.parse(backing.sampledAt ?? '');
      let growth = 0;
      for (const [at, bytes] of this.growth) {
        if (this.now() - at > 31000) this.growth.delete(at);
        else if (at > sampled) growth += bytes;
      }
      freeBytes =
        backing.state === 'fresh' && Number.isFinite(sampled)
          ? Math.min(freeBytes, Math.max(0, backing.availableBytes - growth))
          : 0;
    }
    return { filesystem, freeBytes, backing };
  }

  async workspaceCapacity(archive?: {
    freeBytes: number;
    backing: BackingSample | null;
  }): Promise<WorkspaceStatus | null> {
    if (this.workspaceRoot === this.root) return null;
    let freeBytes: number | null = null;
    let backing: BackingSample | undefined;
    try {
      if (this.workspaceSameFilesystem) {
        const capacity = archive ?? (await this.diskCapacity());
        freeBytes = capacity.freeBytes;
        backing = capacity.backing ?? undefined;
        if (backing && backing.state !== 'fresh') freeBytes = null;
      } else {
        const filesystem = await this.filesystem(this.workspaceRoot);
        const available = filesystem.bavail * filesystem.bsize;
        if (Number.isSafeInteger(available)) freeBytes = Math.max(0, available);
        backing = (await this.workspaceBackingCapacity()) ?? undefined;
        if (backing) {
          freeBytes =
            backing.state === 'fresh' && Number.isSafeInteger(backing.availableBytes)
              ? Math.min(freeBytes ?? 0, Math.max(0, backing.availableBytes))
              : null;
        }
      }
    } catch {
      freeBytes = null;
    }
    const reservedBytes = this.workspaceSeparate ? this.workspaceReserved : this.reserved;
    return {
      state: freeBytes === null ? 'unavailable' : 'fresh',
      separateFilesystem: this.workspaceSeparate,
      freeBytes,
      reserveBytes: this.reserveBytes,
      reservedBytes,
      availableBytes: Math.max(0, (freeBytes ?? 0) - this.reserveBytes - reservedBytes),
      ...(backing ? { backing } : {}),
    };
  }

  noteGrowth(bytes: number): void {
    // Round upward so a commit in the same millisecond/bucket as a capacity
    // sample is conservatively debited until the next actual native reading.
    const bucket = (Math.floor(this.now() / 1000) + 1) * 1000;
    this.growth.set(bucket, (this.growth.get(bucket) ?? 0) + bytes);
    for (const at of this.growth.keys()) if (this.now() - at > 31000) this.growth.delete(at);
  }

  setLimit(bytes: number | null, source = 'user'): void {
    this.maxBytes = bytes;
    this.limitSource = source;
  }

  /** Camera rings live only on the working disk. A full separate archive must not stop live media. */
  async reserveWorkspace(bytes: number): Promise<BlobRelease> {
    if (!this.workspaceSeparate) return this.reserveTransient(bytes);
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > this.maxFileBytes)
      throw new Error('storage_full');
    this.workspaceReserved += bytes;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.workspaceReserved -= bytes;
    };
    try {
      const workspace = (await this.workspaceCapacity()) ?? {
        state: 'unavailable' as const,
        separateFilesystem: this.workspaceSeparate,
        freeBytes: null,
        reserveBytes: this.reserveBytes,
        reservedBytes: 0,
        availableBytes: 0,
      };
      if (
        workspace.freeBytes === null ||
        workspace.freeBytes - this.workspaceReserved < this.reserveBytes
      )
        throw new Error('storage_full');
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }

  /** Reserve bounded temporary encoder output against the same storage budget. */
  async reserveTransient(bytes: number): Promise<BlobRelease> {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      bytes > this.maxFileBytes ||
      this.used + this.reserved + bytes > (this.maxBytes ?? Number.POSITIVE_INFINITY)
    )
      throw new Error('storage_full');
    this.reserved += bytes;
    this.workspaceReserved += bytes;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.reserved -= bytes;
      this.workspaceReserved -= bytes;
    };
    try {
      const capacity = await this.diskCapacity();
      const { freeBytes } = capacity;
      const workspace = await this.workspaceCapacity(capacity);
      if (freeBytes - this.reserved < this.reserveBytes) throw new Error('storage_full');
      // Read the counters after the awaited filesystem calls. A failed peer
      // reservation may already have released its allowance in this turn.
      const workingReserved = this.workspaceSeparate ? this.workspaceReserved : this.reserved;
      if (
        workspace &&
        (workspace.freeBytes === null || workspace.freeBytes - workingReserved < this.reserveBytes)
      )
        throw new Error('storage_full');
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }

  async put(id: string, source: Readable, length: number): Promise<{ existing: boolean }> {
    const output = blobPath(this.root, id);
    if (!Number.isSafeInteger(length) || length <= 0) throw new Error('invalid_size');
    if (length > this.maxFileBytes) throw new Error('invalid_size');
    if (length > (this.maxBytes ?? Number.POSITIVE_INFINITY)) throw new Error('storage_full');
    if (this.active >= this.maxTransfers) throw new Error('transfer_busy');
    if (await stat(output).catch(() => null)) return { existing: true };
    // Reserve synchronously before awaiting filesystem capacity: concurrent uploads share the budget.
    if (this.used + this.reserved + length > (this.maxBytes ?? Number.POSITIVE_INFINITY))
      throw new Error('storage_full');
    this.active++;
    this.reserved += length;
    const temporary = join(this.root, `.partial-${randomUUID()}`);
    try {
      const { freeBytes } = await this.diskCapacity();
      if (freeBytes - this.reserved < this.reserveBytes) throw new Error('storage_full');
      let size = 0;
      const hash = createHash('sha256');
      const verifying = new Transform({
        transform: (chunk, _encoding, callback) => {
          size += chunk.length;
          if (size > length) return callback(new Error('invalid_size'));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(source, verifying, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
      if (size !== length || hash.digest('hex') !== id) throw new Error('digest_mismatch');
      const handle = await open(temporary, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Immutable identical-digest commits may share a lease; DELETE remains
      // exclusive, while concurrent verified uploads can still coalesce.
      const releaseCommit = this.readers.acquire(id);
      let existed = false;
      try {
        await link(temporary, output);
        this.used += length;
        this.noteGrowth(length);
      } catch (error) {
        if (!isErrCode(error, 'EEXIST')) throw error;
        existed = true;
      } finally {
        releaseCommit();
      }
      return { existing: existed };
    } finally {
      this.active--;
      this.reserved -= length;
      await unlink(temporary).catch(() => {});
    }
  }

  async info(id: string) {
    return stat(blobPath(this.root, id));
  }

  async openRead(id: string): Promise<BlobReadHandle> {
    const file = blobPath(this.root, id);
    return openBlobRead(file, this.readers.acquire(id), this.maxFileBytes);
  }

  async verify(id: string, options: { signal?: AbortSignal } = {}) {
    blobPath(this.root, id);
    return this.verification.verify(id, options);
  }

  async remove(id: string): Promise<void> {
    const file = blobPath(this.root, id);
    const release = this.readers.acquire(id, true);
    try {
      const info = await stat(file).catch(() => null);
      if (info) {
        await unlink(file);
        this.used = Math.max(0, this.used - info.size);
      }
    } finally {
      release();
    }
  }
}

export function parseRange(
  value: string | undefined,
  size: number,
): { start: number; end: number; partial: boolean } {
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new Error('invalid_range');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  )
    throw new Error('invalid_range');
  return { start, end, partial: true };
}
