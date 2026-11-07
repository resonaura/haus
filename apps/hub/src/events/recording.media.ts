/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface LocalMediaRow {
  readonly id: string;
  readonly localOriginal: boolean;
  readonly localPlayback: boolean;
  readonly playbackBytes: number;
}

export interface MissingLocalMedia {
  readonly id: string;
  readonly variant: 'original' | 'prepared';
}

export interface PrunableEvent {
  readonly id: string;
  readonly startAt: number;
}

export interface RecordingMediaStorage {
  listLocalMedia(cursor: string, limit: number): Promise<readonly LocalMediaRow[]>;
  setLocalMedia(items: readonly MissingLocalMedia[]): Promise<void>;
  deleteAvailabilityBefore(cutoff: number): Promise<void>;
  listPrunableEvents(): Promise<readonly PrunableEvent[]>;
  clearArchive(id: string): Promise<void>;
  deleteEvent(id: string): Promise<void>;
}

export class RecordingMediaManager {
  private readonly mediaPins = new Map<string, number>();
  private readonly mediaEvictions = new Map<string, { done: Promise<void> }>();

  constructor(
    readonly media: string,
    private readonly storage: RecordingMediaStorage,
    private readonly onError: (error: unknown) => void = (error) => {
      process.emitWarning(error instanceof Error ? error : String(error));
    },
  ) {}

  isMediaPinned(id: string): boolean {
    return this.mediaPins.has(id);
  }
  isMediaEvicting(id: string): boolean {
    return this.mediaEvictions.has(id);
  }

  path(id: string, extension = 'mp4'): string {
    if (
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id) ||
      !['mp4', 'jpg', 'playback.mp4'].includes(extension)
    ) {
      throw new Error('invalid_event_id');
    }
    return join(this.media, `${id}.${extension}`);
  }

  async pinMedia(id: string, signal?: AbortSignal): Promise<() => void> {
    while (this.mediaEvictions.has(id)) {
      signal?.throwIfAborted();
      let onAbort: (() => void) | undefined;
      try {
        const done = this.mediaEvictions.get(id)?.done;
        if (!done) continue;
        await (signal
          ? Promise.race([
              done,
              new Promise<void>((_resolve, reject) => {
                onAbort = () => reject(signal.reason);
                signal.addEventListener('abort', onAbort, { once: true });
              }),
            ])
          : done);
      } finally {
        if (onAbort && signal) signal.removeEventListener('abort', onAbort);
      }
    }
    signal?.throwIfAborted();
    this.mediaPins.set(id, (this.mediaPins.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.mediaPins.get(id) ?? 1) - 1;
      if (count > 0) this.mediaPins.set(id, count);
      else this.mediaPins.delete(id);
    };
  }

  evictMedia(id: string): (() => void) | null {
    if (this.mediaPins.has(id) || this.mediaEvictions.has(id)) return null;
    let resolve!: () => void;
    const done = new Promise<void>((complete) => {
      resolve = complete;
    });
    this.mediaEvictions.set(id, { done });
    return () => {
      this.mediaEvictions.delete(id);
      resolve();
    };
  }

  async reconcileLocalMedia(probe: (path: string) => Promise<unknown> = stat): Promise<void> {
    let cursor = '';
    while (true) {
      const rows = await this.storage.listLocalMedia(cursor, 128);
      if (rows.length === 0) break;
      const last = rows.at(-1);
      if (!last) break;
      cursor = last.id;
      const probes = rows.flatMap((row) => [
        ...(row.localOriginal ? [{ id: row.id, variant: 'original' as const, ext: 'mp4' }] : []),
        ...(row.localPlayback && row.playbackBytes > 0
          ? [{ id: row.id, variant: 'prepared' as const, ext: 'playback.mp4' }]
          : []),
      ]);
      let index = 0;
      const missing: MissingLocalMedia[] = [];
      await Promise.all(
        Array.from({ length: Math.min(4, probes.length) }, async () => {
          while (index < probes.length) {
            const item = probes[index++];
            if (!item) continue;
            try {
              await probe(this.path(item.id, item.ext));
            } catch (error) {
              if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === 'ENOENT'
              ) {
                missing.push(item);
              } else {
                throw error;
              }
            }
          }
        }),
      );
      if (missing.length > 0) await this.storage.setLocalMedia(missing);
    }
  }

  async prune(options: { retention_days: number }, now = Date.now()): Promise<number> {
    const cutoff = now - options.retention_days * 86400000;
    await this.storage.deleteAvailabilityBefore(cutoff);
    const rows = await this.storage.listPrunableEvents();
    let removed = 0;
    for (const row of rows) {
      if (row.startAt >= cutoff) continue;
      const release = this.evictMedia(row.id);
      if (!release) continue;
      try {
        for (const extension of ['mp4', 'jpg', 'playback.mp4']) {
          try {
            await unlink(this.path(row.id, extension));
          } catch (error) {
            if (!(
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'ENOENT'
            )) {
              throw error;
            }
          }
        }
        await this.storage.clearArchive(row.id);
        await this.storage.deleteEvent(row.id);
        removed++;
      } catch (error) {
        this.onError(error);
      } finally {
        release();
      }
    }
    return removed;
  }
}
