/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import type { Blobs } from './blobs.js';
import type { BlobReadHandle } from './blob-readers.js';

export type BlobVerifyRead = (
  handle: BlobReadHandle['handle'],
  buffer: Buffer,
  position: number,
  stop: AbortSignal,
) => Promise<{ bytesRead: number }>;

export interface BlobVerificationOptions {
  timeoutMs?: number;
  read?: BlobVerifyRead;
}

export interface BlobVerificationStatus {
  supported: true;
  maxConcurrent: number;
  maxFileBytes: number;
  timeoutMs: number;
  active: number;
}

export interface BlobVerificationResult {
  digest: string;
  bytes: number;
  verified: true;
}

/** Actual on-disk verification; no digest-name cache is trusted for an eviction receipt. */
export class BlobVerification {
  private readonly blobs: Blobs;
  private readonly timeoutMs: number;
  private readonly read: BlobVerifyRead;
  private maxConcurrent = 1;
  private active = 0;

  constructor(blobs: Blobs, { timeoutMs = 60000, read }: BlobVerificationOptions = {}) {
    this.blobs = blobs;
    this.timeoutMs = timeoutMs;
    this.read =
      read ?? ((handle, buffer, position) => handle.read(buffer, 0, buffer.length, position));
  }

  status(): BlobVerificationStatus {
    return {
      supported: true,
      maxConcurrent: this.maxConcurrent,
      maxFileBytes: this.blobs.maxFileBytes,
      timeoutMs: this.timeoutMs,
      active: this.active,
    };
  }

  async verify(id: string, { signal: signalOption }: { signal?: AbortSignal } = {}) {
    const signal = signalOption;
    if (this.active >= this.maxConcurrent) throw new Error('verification_busy');
    signal?.throwIfAborted();
    this.active++;
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const work = this.hash(id, stop).finally(() => {
      this.active--;
    });
    let aborted: (() => void) | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          aborted = () => reject(stop.reason);
          if (stop.aborted) aborted();
          else stop.addEventListener('abort', aborted, { once: true });
        }),
      ]);
    } catch (error) {
      if (deadline.aborted && !signal?.aborted) throw new Error('verification_timeout');
      throw error;
    } finally {
      if (aborted) stop.removeEventListener('abort', aborted);
    }
  }

  private async hash(id: string, stop: AbortSignal): Promise<BlobVerificationResult> {
    let reader: BlobReadHandle | undefined;
    try {
      reader = await this.blobs.openRead(id);
      stop.throwIfAborted();
      const hash = createHash('sha256');
      const buffer = Buffer.alloc(256 * 1024);
      let size = 0;
      while (size < reader.info.size) {
        stop.throwIfAborted();
        const { bytesRead } = await this.read(
          reader.handle,
          buffer.subarray(0, Math.min(buffer.length, reader.info.size - size)),
          size,
          stop,
        );
        stop.throwIfAborted();
        if (!bytesRead) throw new Error('blob_changed');
        hash.update(buffer.subarray(0, bytesRead));
        size += bytesRead;
        // Yield each chunk so hashing cannot starve media/control requests on weak nodes.
        await setImmediate(undefined, { signal: stop });
      }
      stop.throwIfAborted();
      if (!(await reader.unchanged())) throw new Error('blob_changed');
      if (hash.digest('hex') !== id) throw new Error('digest_mismatch');
      stop.throwIfAborted();
      return { digest: id, bytes: size, verified: true };
    } finally {
      await reader?.close();
    }
  }
}
