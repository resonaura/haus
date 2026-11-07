/*
 * Haus — A thoughtful home for Haus Hub.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { DataSource, Repository } from 'typeorm';
import { RecordingIndexEntity } from '../storage/recordings/entities.js';
import { openRecordings } from '../storage/recordings/source.js';
import type { RecordingIndexRow } from '../storage/recordings/types.js';
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
  private closing?: Promise<void>;
  private readonly rows: Repository<RecordingIndexRow>;
  private readonly blobs: RecordingBlobSource;

  constructor(
    readonly source: DataSource,
    blobs: RecordingBlobSource,
  ) {
    this.blobs = blobs;
    this.rows = source.getRepository(RecordingIndexEntity);
  }

  static async open(path: string, blobs: RecordingBlobSource): Promise<RecordingIndex> {
    return new RecordingIndex(await openRecordings(path), blobs);
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
    await this.rows.save({
      id: event.id,
      digest,
      startAt: event.startAt,
      value: JSON.stringify(value),
    });
  }

  async get(id: string): Promise<RecordingValueRecord | null> {
    const row = await this.rows.findOneBy({ id });
    if (!row) return null;
    // Rows are written by `add`; this returns the persisted JSON exactly.
    return JSON.parse(row.value) as RecordingValueRecord;
  }

  async list(
    cursor?: string,
  ): Promise<{ items: RecordingValueRecord[]; nextCursor: string | null }> {
    let query = this.rows.createQueryBuilder('recording');
    if (cursor) {
      const [startAt, id] = cursorValue(cursor);
      query = query.where(
        'recording.startAt < :startAt OR (recording.startAt = :startAt AND recording.id < :id)',
        { startAt, id },
      );
    }
    const rows = await query
      .orderBy('recording.startAt', 'DESC')
      .addOrderBy('recording.id', 'DESC')
      .take(201)
      .getMany();
    const items = rows.slice(0, 200).map((row) => JSON.parse(row.value) as RecordingValueRecord);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > 200 && last
          ? Buffer.from(JSON.stringify([last.startAt, last.id])).toString('base64url')
          : null,
    };
  }

  async storageRows(): Promise<RecordingValueRecord[]> {
    const rows = await this.rows.find({ select: { value: true } });
    return rows.map((row) => JSON.parse(row.value) as RecordingValueRecord);
  }

  async remove(digest: string): Promise<void> {
    await this.rows.delete({ digest });
  }

  close(): Promise<void> {
    this.closing ??= this.source.isInitialized ? this.source.destroy() : Promise.resolve();
    return this.closing;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
