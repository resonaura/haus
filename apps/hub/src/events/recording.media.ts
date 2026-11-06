/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { toRawEventRow } from './recording.types.js';

export class RecordingMediaManager {
  private readonly mediaPins = new Map<string, number>();
  private readonly mediaEvictions = new Map<string, { done: Promise<void> }>();

  constructor(
    private readonly db: DatabaseSync,
    readonly media: string,
    private readonly clearArchive: (id: string) => void,
  ) {}

  path(id: string, extension = 'mp4'): string {
    if (
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id) ||
      !['mp4', 'jpg', 'playback.mp4'].includes(extension)
    ) {
      throw new Error('invalid_event_id');
    }
    return join(this.media, `${id}.${extension}`);
  }

  setLocal(id: string, variant: 'original' | 'prepared', present: boolean): void {
    if (!['original', 'prepared'].includes(variant)) {
      throw new Error('invalid_archive_variant');
    }
    this.db
      .prepare(
        `UPDATE events SET ${variant === 'original' ? 'local_original' : 'local_playback'}=? WHERE id=?`,
      )
      .run(Number(present), id);
  }

  async pinMedia(id: string, signal?: AbortSignal): Promise<() => void> {
    while (this.mediaEvictions.has(id)) {
      signal?.throwIfAborted();
      let onAbort: (() => void) | undefined;
      try {
        const done = this.mediaEvictions.get(id)!.done;
        await (signal
          ? Promise.race([
              done,
              new Promise((_, reject) => {
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
      const rows = this.db
        .prepare(
          "SELECT id,local_original,local_playback,playback_bytes FROM events WHERE status='ready' AND id>? AND (local_original=1 OR (local_playback=1 AND playback_bytes>0)) ORDER BY id LIMIT 128",
        )
        .all(cursor) as Array<{
        id: string;
        local_original: number;
        local_playback: number;
        playback_bytes: number;
      }>;
      if (!rows.length) break;
      cursor = rows.at(-1)!.id;
      const probes = rows.flatMap((row) => [
        ...(row.local_original
          ? [{ id: row.id, variant: 'original' as const, extension: 'mp4' }]
          : []),
        ...(row.local_playback && row.playback_bytes > 0
          ? [{ id: row.id, variant: 'prepared' as const, extension: 'playback.mp4' }]
          : []),
      ]);
      let index = 0;
      const missing: Array<{ id: string; variant: 'original' | 'prepared' }> = [];
      await Promise.all(
        Array.from({ length: Math.min(4, probes.length) }, async () => {
          while (index < probes.length) {
            const item = probes[index++];
            try {
              await probe(this.path(item.id, item.extension));
            } catch (error) {
              if ((error as { code?: string })?.code === 'ENOENT') missing.push(item);
            }
          }
        }),
      );
      if (missing.length) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          for (const item of missing) {
            this.setLocal(item.id, item.variant, false);
          }
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      }
    }
  }

  async prune(options: { retention_days: number }, now = Date.now()): Promise<number> {
    const cutoff = now - options.retention_days * 86400000;
    this.db.prepare('DELETE FROM camera_availability WHERE end_at<?').run(cutoff);
    let removed = 0;
    const rows = (
      this.db
        .prepare("SELECT * FROM events WHERE status!='recording' ORDER BY start_at ASC,id ASC")
        .all() as Array<Record<string, unknown>>
    ).map(toRawEventRow);
    for (const row of rows) {
      if (row.start_at >= cutoff) continue;
      const release = this.evictMedia(row.id);
      if (!release) continue;
      try {
        for (const ext of ['mp4', 'jpg', 'playback.mp4']) {
          await unlink(this.path(row.id, ext)).catch((error: { code?: string }) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
        this.clearArchive(row.id);
        this.db.prepare('DELETE FROM events WHERE id=?').run(row.id);
        removed++;
      } catch {
        /* Keep metadata and retry later */
      } finally {
        release();
      }
    }
    return removed;
  }
}
