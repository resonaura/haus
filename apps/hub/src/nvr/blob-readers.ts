/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { ReadStream } from 'node:fs';

export type BlobRelease = () => void;

export interface BlobReadRange {
  start?: number;
  end?: number;
  bytes?: number;
  position?: number;
}

export interface BlobReadHandle {
  info: { size: number; isFile(): boolean };
  handle: FileHandle;
  stream: (range?: BlobReadRange) => ReadStream;
  unchanged: () => Promise<boolean>;
  close: () => Promise<void>;
}

interface SideInfo {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  isFile(): boolean;
}

/** Per-digest read/exclusive leases: a delete never invalidates an active reader. */
export class BlobReaders {
  private readonly items = new Map<string, { readers: number; exclusive: boolean }>();

  /** Number of digests with a live read or exclusive lease; no mutable lease state escapes. */
  get active(): number {
    return this.items.size;
  }

  acquire(id: string, exclusive = false): BlobRelease {
    const known = this.items.get(id);
    if (known?.exclusive || (exclusive && (known?.readers ?? 0) > 0))
      throw new Error('blob_in_use');
    const item = known ?? { readers: 0, exclusive: false };
    if (exclusive) item.exclusive = true;
    else item.readers++;
    this.items.set(id, item);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (exclusive) item.exclusive = false;
      else item.readers--;
      if (!item.exclusive && item.readers === 0) this.items.delete(id);
    };
  }
}

export function sameFile(before: SideInfo, after: SideInfo): boolean {
  return (
    before.isFile() &&
    after.isFile() &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

/** Open once: fstat/range reads and verification refer to the same actual file. */
export async function openBlobRead(
  file: string,
  release: BlobRelease,
  maxBytes: number,
): Promise<BlobReadHandle> {
  let handle: FileHandle | undefined;
  try {
    // O_NONBLOCK avoids hanging on a malicious FIFO; O_NOFOLLOW rejects symlinks.
    handle = await open(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0),
    );
    const opened = handle;
    const info = await opened.stat();
    if (
      !info.isFile() ||
      !Number.isSafeInteger(info.size) ||
      info.size <= 0 ||
      info.size > maxBytes
    )
      throw new Error('invalid_media');
    if (!sameFile(info, await lstat(file))) throw new Error('blob_changed');
    let closed = false;
    return {
      info,
      handle: opened,
      stream: (range = {}) => opened.createReadStream({ ...range, autoClose: false }),
      unchanged: async () => {
        try {
          return sameFile(info, await opened.stat()) && sameFile(info, await lstat(file));
        } catch (error) {
          if (isErrCode(error, 'ENOENT')) return false;
          throw error;
        }
      },
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await opened.close();
        } finally {
          release();
        }
      },
    };
  } catch (error) {
    try {
      await handle?.close();
    } finally {
      release();
    }
    if (isErrCode(error, 'ENOENT')) throw new Error('media_not_found');
    if (isErrCode(error, 'ELOOP')) throw new Error('invalid_media');
    throw error;
  }
}

export function isErrCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
