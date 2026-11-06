/*
 * Haus — A thoughtful home for Haus Hub.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { DatabaseSync } from 'node:sqlite';
import { recordingProvenance } from './recording-provenance.js';

export type RecordingVariant = 'original' | 'prepared';

/** Row value as returned by `get`/`list`; shape is exactly what `add` validated in. */
export type RecordingValueRecord = Record<string, unknown>;

export interface RecordingBlobSource {
  info: (digest: string) => Promise<{ size: number }>;
}

const STAGED_NUMERIC_KEYS = ['duration', 'audioTailSeconds', 'audioTrimSeconds'] as const;
const UUID_PATTERN = /^[a-f0-9-]{36}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const CAMERA_PATTERN = /^camera\.[a-z0-9_]+$/;

export class RecordingIndex {
  /** Shared with camera outbox/activity modules that extend this database. */
  readonly db: DatabaseSync;
  private readonly blobs: RecordingBlobSource;

  constructor(path: string, blobs: RecordingBlobSource) {
    this.blobs = blobs;
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS recordings(id TEXT PRIMARY KEY,digest TEXT NOT NULL,start_at INTEGER NOT NULL,value TEXT NOT NULL); CREATE INDEX IF NOT EXISTS recordings_time ON recordings(start_at DESC,id DESC); CREATE INDEX IF NOT EXISTS recordings_digest ON recordings(digest)',
    );
  }

  async add(input: unknown): Promise<void> {
    const fields = isRecord(input) ? input : {};
    const event = parseEvent(fields.event);
    if (
      (fields.variant !== undefined && !isVariant(fields.variant)) ||
      (fields.originalDigest !== undefined && !/^[a-f0-9]{64}$/.test(String(fields.originalDigest)))
    )
      throw new Error('invalid_recording_metadata');
    const digest = requireDigest(fields.digest);
    await this.blobs.info(digest);
    const variant = isVariant(fields.variant) ? fields.variant : undefined;
    const originalDigest =
      typeof fields.originalDigest === 'string' ? fields.originalDigest : undefined;
    const value: RecordingValueRecord = {
      id: event.id,
      cameraId: event.cameraId,
      startAt: event.startAt,
      ...(event.media !== undefined ? { mediaStartAt: Math.round(event.media) } : {}),
      endAt: event.endAt,
      duration: event.duration,
      ...(event.originalDuration !== undefined ? { originalDuration: event.originalDuration } : {}),
      kinds: event.kinds,
      ...(event.playbackVersion !== undefined ? { playbackVersion: event.playbackVersion } : {}),
      ...(event.playbackInfo ? { playbackInfo: stagedPlaybackInfo(event.playbackInfo) } : {}),
      digest,
      ...(variant ? { storageVariant: variant } : {}),
      ...(originalDigest ? { originalDigest } : {}),
    };
    this.db
      .prepare(
        'INSERT INTO recordings(id,digest,start_at,value)VALUES(?,?,?,?) ON CONFLICT(id)DO UPDATE SET digest=excluded.digest,start_at=excluded.start_at,value=excluded.value',
      )
      .run(event.id, digest, event.startAt, JSON.stringify(value));
  }

  get(id: string): RecordingValueRecord | null {
    const row: unknown = this.db.prepare('SELECT value FROM recordings WHERE id=?').get(id);
    if (!isRecord(row) || typeof row.value !== 'string') return null;
    // Rows are written by `add`; this returns the persisted JSON exactly.
    return JSON.parse(row.value) as RecordingValueRecord;
  }

  list(cursor?: string): { items: RecordingValueRecord[]; nextCursor: string | null } {
    let where = '';
    let args: (string | number)[] = [];
    if (cursor) {
      const [startAt, id] = cursorValue(cursor);
      where = 'WHERE start_at<? OR (start_at=? AND id<?)';
      args = [startAt, startAt, id];
    }
    const rows: unknown[] = this.db
      .prepare(`SELECT value FROM recordings ${where} ORDER BY start_at DESC,id DESC LIMIT 201`)
      .all(...args);
    const items: RecordingValueRecord[] = [];
    for (const row of rows.slice(0, 200)) {
      if (isValueRow(row)) items.push(JSON.parse(row.value) as RecordingValueRecord);
    }
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > 200 && last
          ? Buffer.from(JSON.stringify([last.startAt, last.id])).toString('base64url')
          : null,
    };
  }

  remove(digest: string): void {
    this.db.prepare('DELETE FROM recordings WHERE digest=?').run(digest);
  }

  close(): void {
    this.db.close();
  }
}

interface ParsedEvent {
  id: string;
  cameraId: string;
  startAt: number;
  endAt: number;
  media: number | undefined;
  duration: number;
  originalDuration: number | undefined;
  kinds: string[];
  playbackVersion: unknown;
  playbackInfo: Record<string, unknown> | undefined;
}

function parseEvent(input: unknown): ParsedEvent {
  if (!isRecord(input)) throw new Error('invalid_recording_metadata');
  const id = typeof input.id === 'string' && UUID_PATTERN.test(input.id) ? input.id : undefined;
  const cameraId =
    typeof input.cameraId === 'string' && CAMERA_PATTERN.test(input.cameraId)
      ? input.cameraId
      : undefined;
  const startAt = safeInteger(input.startAt);
  const endAt = safeInteger(input.endAt);
  // Legacy semantics: any finite mediaStartAt (fractional offsets round on storage).
  const media = finiteNumber(input.mediaStartAt);
  const duration = finiteNumber(input.duration);
  const originalDuration = nonNegative(input.originalDuration);
  const kinds = validKinds(input.kinds);
  if (
    !id ||
    !cameraId ||
    startAt === undefined ||
    endAt === undefined ||
    (input.mediaStartAt !== undefined && media === undefined) ||
    (media !== undefined && (media < 0 || media > endAt + 30000)) ||
    endAt < startAt ||
    duration === undefined ||
    duration < 0 ||
    !kinds ||
    Buffer.byteLength(JSON.stringify(input)) > 4096
  )
    throw new Error('invalid_recording_metadata');
  return {
    id,
    cameraId,
    startAt,
    endAt,
    media,
    duration,
    originalDuration,
    kinds,
    playbackVersion: input.playbackVersion,
    playbackInfo: isRecord(input.playbackInfo) ? input.playbackInfo : undefined,
  };
}

function cursorValue(cursor: string): [number, string] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw new Error('invalid_cursor');
  }
  if (!Array.isArray(parsed)) throw new Error('invalid_cursor');
  const startAt =
    typeof parsed[0] === 'number' && Number.isSafeInteger(parsed[0]) ? parsed[0] : null;
  const id = typeof parsed[1] === 'string' && UUID_PATTERN.test(parsed[1]) ? parsed[1] : null;
  if (startAt === null || id === null) throw new Error('invalid_cursor');
  return [startAt, id];
}

function stagedPlaybackInfo(info: Record<string, unknown>): Record<string, unknown> {
  return {
    ...recordingProvenance(info),
    ...(typeof info.audio === 'boolean' ? { audio: info.audio } : {}),
    ...(typeof info.sourceAudioMissing === 'boolean'
      ? { sourceAudioMissing: info.sourceAudioMissing }
      : {}),
    ...(typeof info.largestGap === 'number' && Number.isFinite(info.largestGap)
      ? { largestGap: Math.max(0, info.largestGap) }
      : {}),
    ...Object.fromEntries(
      STAGED_NUMERIC_KEYS.filter(
        (key) =>
          typeof info[key] === 'number' && Number.isFinite(info[key]) && (info[key] as number) >= 0,
      ).map((key) => [key, info[key]]),
    ),
  };
}

function isVariant(value: unknown): value is 'original' | 'prepared' {
  return value === 'original' || value === 'prepared';
}

function requireDigest(digest: unknown): string {
  if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) throw new Error('invalid_digest');
  return digest;
}

function validKinds(kinds: unknown): string[] | undefined {
  if (!Array.isArray(kinds)) return undefined;
  if (kinds.some((kind) => typeof kind !== 'string' || kind.length > 50)) return undefined;
  if (kinds.length > 10) return undefined;
  return kinds as string[];
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function nonNegative(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function isValueRow(row: unknown): row is { value: string } {
  return isRecord(row) && typeof row.value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
