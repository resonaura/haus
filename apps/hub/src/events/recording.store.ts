/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { PlaybackInfo } from './playback.js';
import {
  type CameraAvailabilityRecord,
  decodeCursor,
  type EventDetection,
  type EventRecord,
  type RawEventRow,
  type StorageTotals,
  toRawEventRow,
} from './recording.types.js';
import { initRecordingSchema } from './recording.schema.js';
import { RecordingMediaManager } from './recording.media.js';

export * from './recording.types.js';
export * from './recording.media.js';

export class RecordingStore {
  readonly db: DatabaseSync;
  readonly media: string;
  private readonly mediaManager: RecordingMediaManager;

  constructor(databasePath: string, mediaPath: string) {
    this.db = new DatabaseSync(databasePath);
    this.media = mediaPath;
    initRecordingSchema(
      this.db,
      () => this.overrides(),
      (id, val) => this.setCamera(id, val),
    );
    this.mediaManager = new RecordingMediaManager(this.db, this.media, (id) =>
      this.clearArchive(id),
    );
  }

  overrides(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT id,value FROM settings').all() as Array<{
      id: string;
      value: string;
    }>;
    return Object.fromEntries(rows.map((row) => [row.id, JSON.parse(row.value) as unknown]));
  }

  setCamera(id: string, value: Record<string, unknown>): void {
    this.db
      .prepare(
        'INSERT INTO settings(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(id, JSON.stringify(value));
  }

  observeAvailability(cameraId: string, state: string, at = Date.now()): void {
    if (!['online', 'offline', 'unknown'].includes(state)) {
      throw new Error('invalid_availability');
    }
    const previous = this.db
      .prepare('SELECT * FROM camera_availability WHERE camera_id=? ORDER BY start_at DESC LIMIT 1')
      .get(cameraId) as { start_at: number; end_at: number; state: string } | undefined;

    if (previous && at < previous.end_at) return;
    if (previous && at - previous.end_at <= 45000) {
      this.db
        .prepare('UPDATE camera_availability SET end_at=? WHERE camera_id=? AND start_at=?')
        .run(at, cameraId, previous.start_at);
      if (previous.state === state) return;
    }
    this.db
      .prepare(
        'INSERT INTO camera_availability(camera_id,start_at,end_at,state) VALUES(?,?,?,?) ON CONFLICT(camera_id,start_at) DO UPDATE SET state=excluded.state,end_at=excluded.end_at',
      )
      .run(cameraId, at, at, state);
  }

  availability({
    cameraId,
    from = 0,
    to = Date.now(),
  }: { cameraId?: string; from?: number; to?: number } = {}): CameraAvailabilityRecord[] {
    const args: Array<string | number> = [from, to];
    const where = cameraId ? ' AND camera_id=?' : '';
    if (cameraId) args.push(cameraId);
    const rows = this.db
      .prepare(
        `SELECT * FROM camera_availability WHERE end_at>=? AND start_at<=?${where} ORDER BY start_at DESC LIMIT 5000`,
      )
      .all(...args) as Array<{
      camera_id: string;
      start_at: number;
      end_at: number;
      state: string;
    }>;
    return rows.reverse().map((row) => ({
      cameraId: row.camera_id,
      startAt: Math.max(from, row.start_at),
      endAt: Math.min(to, row.end_at),
      state: row.state,
    }));
  }

  create(
    cameraId: string,
    kind: string,
    at: number,
    endAt: number,
    sensorId?: string,
  ): EventRecord {
    const id = randomUUID();
    const detections: EventDetection[] = [{ kind, at, sensorId }];
    this.db
      .prepare(
        'INSERT INTO events(id,camera_id,start_at,end_at,status,kinds,detections) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        id,
        cameraId,
        at,
        endAt,
        'recording',
        JSON.stringify([kind]),
        JSON.stringify(detections),
      );
    return this.get(id)!;
  }

  adoptActivity(event: {
    id: string;
    cameraId: string;
    startAt: number;
    endAt: number;
    kinds: string[];
  }): EventRecord | null {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO events(id,camera_id,start_at,end_at,status,kinds,detections,local_original,local_playback) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        event.id,
        event.cameraId,
        event.startAt,
        event.endAt,
        'recording',
        JSON.stringify(event.kinds),
        JSON.stringify([
          {
            kind: event.kinds[0],
            at: event.startAt,
            sensorId: 'haus_activity_assist',
          },
        ]),
        0,
        0,
      );
    return this.get(event.id);
  }

  interruptActivity(id: string, reason?: string): void {
    this.db
      .prepare(
        "UPDATE events SET status='interrupted',error=?,local_original=0,local_playback=0 WHERE id=? AND status!='ready' AND bytes=0",
      )
      .run(
        reason === 'storage_full'
          ? 'The NVR did not have enough space to complete this event.'
          : 'The NVR source or node interrupted this event; complete footage is unavailable.',
        id,
      );
  }

  extend(
    id: string,
    kind: string,
    at: number,
    endAt: number,
    sensorId?: string,
    maxEndAt = Infinity,
  ): EventRecord | null {
    const old = this.get(id);
    if (!old || old.status !== 'recording') return null;
    const detections = [...old.detections, { kind, at, sensorId }].slice(-500);
    const kinds = [...new Set([...old.kinds, kind])];
    this.db
      .prepare('UPDATE events SET start_at=?,end_at=?,kinds=?,detections=? WHERE id=?')
      .run(
        Math.min(old.startAt, at),
        Math.min(maxEndAt, Math.max(old.endAt, endAt)),
        JSON.stringify(kinds),
        JSON.stringify(detections),
        id,
      );
    return this.get(id);
  }

  extendTail(id: string, endAt: number): EventRecord | null {
    this.db
      .prepare("UPDATE events SET end_at=max(end_at,?) WHERE id=? AND status='recording'")
      .run(endAt, id);
    return this.get(id);
  }

  finish(
    id: string,
    {
      status = 'ready',
      duration = 0,
      bytes = 0,
      error = null,
      playbackVersion = 0,
      mediaStartAt = null,
    }: {
      status?: string;
      duration?: number;
      bytes?: number;
      error?: string | null;
      playbackVersion?: number;
      mediaStartAt?: number | null;
    } = {},
  ): EventRecord | null {
    this.clearArchive(id);
    this.db
      .prepare(
        'UPDATE events SET status=?,duration=?,bytes=?,error=?,playback_version=?,media_start_at=coalesce(?,media_start_at),local_original=1,media_revision=media_revision+1 WHERE id=?',
      )
      .run(status, duration, bytes, error, playbackVersion, mediaStartAt, id);
    return this.get(id);
  }

  get(id: string): EventRecord | null {
    const row = this.db.prepare('SELECT * FROM events WHERE id=?').get(id) as
      Record<string, unknown> | undefined;
    return row ? this.present(toRawEventRow(row)) : null;
  }

  setPlayback(
    id: string,
    bytes: number,
    version = 1,
    diagnostics: Record<string, unknown> = {},
  ): void {
    this.clearArchive(id, 'prepared');
    this.db
      .prepare(
        'UPDATE events SET playback_version=?,playback_bytes=?,playback_info=?,local_playback=1,media_revision=media_revision+1 WHERE id=?',
      )
      .run(version, bytes, JSON.stringify(diagnostics), id);
  }

  clearArchive(id: string, variant?: string): void {
    const where = variant ? ' AND variant=?' : '';
    const args = variant ? [id, variant] : [id];
    const descriptors = this.db
      .prepare(`DELETE FROM event_archive WHERE event_id=?${where}`)
      .run(...args);
    const locations = this.db
      .prepare(`DELETE FROM event_archive_locations WHERE event_id=?${where}`)
      .run(...args);
    if (descriptors.changes || locations.changes) this.markArchiveChanged();
    const hasMedia = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cluster_media'")
      .get();
    if (hasMedia) {
      this.db.prepare('DELETE FROM cluster_media WHERE event_id=?').run(id);
    }
  }

  archiveGeneration(): number {
    const row = this.db.prepare('SELECT generation FROM event_archive_state WHERE id=1').get() as {
      generation: number;
    };
    return row.generation;
  }

  markArchiveChanged(): void {
    this.db.exec('UPDATE event_archive_state SET generation=generation+1 WHERE id=1');
  }

  present(row: RawEventRow): EventRecord {
    const playbackInfo = row.playback_info
      ? (JSON.parse(row.playback_info) as PlaybackInfo)
      : undefined;
    const duration =
      Number.isFinite(playbackInfo?.duration) && playbackInfo!.duration! > 0
        ? playbackInfo!.duration!
        : row.duration;
    return {
      id: row.id,
      cameraId: row.camera_id,
      startAt: row.start_at,
      ...(row.media_start_at !== null ? { mediaStartAt: row.media_start_at } : {}),
      endAt: row.end_at,
      status: row.status,
      kinds: JSON.parse(row.kinds) as string[],
      detections: JSON.parse(row.detections) as EventDetection[],
      duration,
      ...(duration !== row.duration ? { originalDuration: row.duration } : {}),
      bytes: row.bytes,
      error: row.error,
      playbackVersion: row.playback_version,
      playbackBytes: row.playback_bytes,
      playbackInfo,
      mediaRevision: row.media_revision,
      localOriginal: Boolean(row.local_original),
      localPlayback: Boolean(row.local_playback),
      videoUrl: row.status === 'ready' ? `api/events/${row.id}/video` : undefined,
      thumbnailUrl: row.status === 'ready' ? `api/events/${row.id}/thumbnail` : undefined,
    };
  }

  list({
    cameraId,
    from = 0,
    to = Date.now() + 60000,
    cursor,
    limit = 60,
    kind,
    status,
    direction = 'older',
  }: {
    cameraId?: string;
    from?: number;
    to?: number;
    cursor?: string;
    limit?: number;
    kind?: string;
    status?: string;
    direction?: 'older' | 'newer';
  } = {}): { events: EventRecord[]; newestCursor: string | null; nextCursor: string | null } {
    const args: Array<string | number> = [from, to];
    let where = 'start_at >= ? AND start_at <= ?';
    if (cameraId) {
      where += ' AND camera_id=?';
      args.push(cameraId);
    }
    if (status) {
      where += ' AND status=?';
      args.push(status);
    }
    const order = direction === 'newer' ? 'ASC' : 'DESC';
    if (cursor) {
      const [at, id] = decodeCursor(cursor);
      const operator = direction === 'newer' ? '>' : '<';
      where += ` AND (start_at ${operator} ? OR (start_at = ? AND id ${operator} ?))`;
      args.push(at, at, id);
    }
    if (kind) {
      where += ' AND EXISTS (SELECT 1 FROM json_each(events.kinds) WHERE value=?)';
      args.push(kind);
    }
    args.push(Math.min(200, Math.max(1, limit)) + 1);
    const rows = (
      this.db
        .prepare(
          `SELECT * FROM events WHERE ${where} ORDER BY start_at ${order},id ${order} LIMIT ?`,
        )
        .all(...args) as Array<Record<string, unknown>>
    ).map(toRawEventRow);
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map((row) => this.present(row));
    const last = events.at(-1);
    const newest = direction === 'newer' ? events.at(-1) : events[0];
    return {
      events: direction === 'newer' ? events.reverse() : events,
      newestCursor: newest
        ? Buffer.from(JSON.stringify([newest.startAt, newest.id])).toString('base64url')
        : null,
      nextCursor:
        hasMore && last
          ? Buffer.from(JSON.stringify([last.startAt, last.id])).toString('base64url')
          : null,
    };
  }

  recordedDays({ cameraId, boundaries }: { cameraId: string; boundaries: number[] }): number[] {
    const query = this.db.prepare(
      "SELECT 1 FROM events WHERE camera_id=? AND status='ready' AND start_at>=? AND start_at<? LIMIT 1",
    );
    return boundaries
      .slice(0, -1)
      .filter((start, index) => query.get(cameraId, start, boundaries[index + 1]) !== undefined);
  }

  recording(): EventRecord[] {
    const rows = (
      this.db.prepare("SELECT * FROM events WHERE status='recording'").all() as Array<
        Record<string, unknown>
      >
    ).map(toRawEventRow);
    return rows.map((row) => this.present(row));
  }

  totals(): StorageTotals {
    const row = this.db
      .prepare(
        `WITH media AS (SELECT e.*,
        EXISTS(SELECT 1 FROM event_archive a JOIN event_archive_locations l USING(event_id,variant,digest,version) WHERE a.event_id=e.id AND a.variant='original') AS original_archived,
        EXISTS(SELECT 1 FROM event_archive a JOIN event_archive_locations l USING(event_id,variant,digest,version) WHERE a.event_id=e.id AND a.variant='prepared' AND a.version=e.playback_version) AS playback_archived
        FROM events e WHERE status='ready')
        SELECT count(*) AS count,coalesce(sum(bytes*local_original+playback_bytes*local_playback),0) AS bytes,
        coalesce(sum(bytes+playback_bytes),0) AS totalBytes,
        coalesce(sum(CASE WHEN local_original=0 AND original_archived THEN bytes ELSE 0 END +
        CASE WHEN local_playback=0 AND playback_archived THEN playback_bytes ELSE 0 END),0) AS archivedBytes,
        coalesce(sum(CASE WHEN local_original=1 OR (local_playback=1 AND playback_bytes>0) THEN 1 ELSE 0 END),0) AS localEvents,
        coalesce(sum(CASE WHEN local_original=0 AND original_archived AND (playback_bytes=0 OR (local_playback=0 AND playback_archived)) THEN 1 ELSE 0 END),0) AS archivedEvents
        FROM media`,
      )
      .get() as {
      count: number;
      bytes: number;
      totalBytes: number;
      archivedBytes: number;
      localEvents: number;
      archivedEvents: number;
    };
    return {
      ...row,
      unavailableBytes: Math.max(0, row.totalBytes - row.bytes - row.archivedBytes),
    };
  }

  path(id: string, extension = 'mp4'): string {
    return this.mediaManager.path(id, extension);
  }

  setLocal(id: string, variant: 'original' | 'prepared', present: boolean): void {
    this.mediaManager.setLocal(id, variant, present);
  }

  pinMedia(id: string, signal?: AbortSignal): Promise<() => void> {
    return this.mediaManager.pinMedia(id, signal);
  }

  evictMedia(id: string): (() => void) | null {
    return this.mediaManager.evictMedia(id);
  }

  reconcileLocalMedia(probe?: (path: string) => Promise<unknown>): Promise<void> {
    return this.mediaManager.reconcileLocalMedia(probe);
  }

  prune(options: { retention_days: number }, now = Date.now()): Promise<number> {
    return this.mediaManager.prune(options, now);
  }

  close(): void {
    this.db.close();
  }
}
