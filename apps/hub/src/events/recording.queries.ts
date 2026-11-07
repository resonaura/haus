/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Between, type DataSource } from 'typeorm';
import { RecordingEventEntity } from './recording.entities.js';
import { toEventRecord, toRawEvent } from './recording.mapper.js';
import type { LocalMediaRow, PrunableEvent } from './recording.media.js';
import { decodeCursor, toRawEventRow } from './recording.types.js';
import type { EventRecord, RecordingEventListOptions, StorageTotals } from './recording.types.js';

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw Error('recording_query_invalid');
  return value.map((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw Error('recording_query_invalid');
    }
    return row as Record<string, unknown>;
  });
}

export class RecordingQueries {
  constructor(private readonly source: DataSource) {}

  async list({
    cameraId,
    from = 0,
    to = Date.now() + 60000,
    cursor,
    limit = 60,
    kind,
    status,
    direction = 'older',
  }: RecordingEventListOptions = {}): Promise<{
    events: EventRecord[];
    newestCursor: string | null;
    nextCursor: string | null;
  }> {
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
    const queryLimit = Math.min(200, Math.max(1, limit));
    args.push(queryLimit + 1);
    const rows = asRows(
      await this.source.manager.query(
        `SELECT * FROM events WHERE ${where} ORDER BY start_at ${order},id ${order} LIMIT ?`,
        args,
      ),
    ).map(toRawEventRow);
    const hasMore = rows.length > queryLimit;
    const events = rows.slice(0, queryLimit).map(toEventRecord);
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

  async recordedDays({
    cameraId,
    boundaries,
  }: {
    cameraId: string;
    boundaries: number[];
  }): Promise<number[]> {
    const days: number[] = [];
    for (let index = 0; index < boundaries.length - 1; index++) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      if (start === undefined || end === undefined) continue;
      const exists = await this.source.manager.findOne(RecordingEventEntity, {
        where: { cameraId, status: 'ready', startAt: Between(start, end - 1) },
        select: { id: true },
      });
      if (exists) days.push(start);
    }
    return days;
  }

  async recording(): Promise<EventRecord[]> {
    const rows = await this.source.manager.find(RecordingEventEntity, {
      where: { status: 'recording' },
    });
    return rows.map((row) => toEventRecord(toRawEvent(row)));
  }

  async totals(): Promise<StorageTotals> {
    const value: unknown = await this.source.manager.query(`WITH media AS (SELECT e.*,
      EXISTS(SELECT 1 FROM event_archive a JOIN event_archive_locations l USING(event_id,variant,digest,version) WHERE a.event_id=e.id AND a.variant='original') AS original_archived,
      EXISTS(SELECT 1 FROM event_archive a JOIN event_archive_locations l USING(event_id,variant,digest,version) WHERE a.event_id=e.id AND a.variant='prepared' AND a.version=e.playback_version) AS playback_archived
      FROM events e WHERE status='ready')
      SELECT count(*) AS count,coalesce(sum(bytes*local_original+playback_bytes*local_playback),0) AS bytes,
      coalesce(sum(bytes+playback_bytes),0) AS totalBytes,
      coalesce(sum(CASE WHEN local_original=0 AND original_archived THEN bytes ELSE 0 END +
      CASE WHEN local_playback=0 AND playback_archived THEN playback_bytes ELSE 0 END),0) AS archivedBytes,
      coalesce(sum(CASE WHEN local_original=1 OR (local_playback=1 AND playback_bytes>0) THEN 1 ELSE 0 END),0) AS localEvents,
      coalesce(sum(CASE WHEN local_original=0 AND original_archived AND (playback_bytes=0 OR (local_playback=0 AND playback_archived)) THEN 1 ELSE 0 END),0) AS archivedEvents
      FROM media`);
    const row = asRows(value)[0];
    if (!row) throw Error('recording_totals_missing');
    const totals = {
      count: Number(row.count),
      bytes: Number(row.bytes),
      totalBytes: Number(row.totalBytes),
      archivedBytes: Number(row.archivedBytes),
      localEvents: Number(row.localEvents),
      archivedEvents: Number(row.archivedEvents),
    };
    return {
      ...totals,
      unavailableBytes: Math.max(0, totals.totalBytes - totals.bytes - totals.archivedBytes),
    };
  }

  async listLocalMedia(cursor: string, limit: number): Promise<readonly LocalMediaRow[]> {
    const value: unknown = await this.source.manager.query(
      "SELECT id,local_original,local_playback,playback_bytes FROM events WHERE status='ready' AND id>? AND (local_original=1 OR (local_playback=1 AND playback_bytes>0)) ORDER BY id LIMIT ?",
      [cursor, limit],
    );
    return asRows(value).map((row) => ({
      id: String(row.id),
      localOriginal: Boolean(row.local_original),
      localPlayback: Boolean(row.local_playback),
      playbackBytes: Number(row.playback_bytes),
    }));
  }

  async listPrunableEvents(): Promise<readonly PrunableEvent[]> {
    const rows = await this.source.manager
      .createQueryBuilder(RecordingEventEntity, 'event')
      .select(['event.id', 'event.startAt'])
      .where('event.status != :recording', { recording: 'recording' })
      .orderBy('event.startAt', 'ASC')
      .addOrderBy('event.id', 'ASC')
      .getMany();
    return rows.map(({ id, startAt }) => ({ id, startAt }));
  }
}
