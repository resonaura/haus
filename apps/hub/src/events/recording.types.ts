/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdir } from 'node:fs/promises';
import type { PlaybackInfo } from './playback.js';

export interface EventDetection {
  kind: string;
  at: number;
  sensorId?: string;
}

export interface EventRecord {
  id: string;
  cameraId: string;
  startAt: number;
  endAt: number;
  mediaStartAt?: number;
  status: string;
  kinds: string[];
  detections: EventDetection[];
  duration: number;
  originalDuration?: number;
  bytes: number;
  error?: string | null;
  playbackVersion: number;
  playbackBytes: number;
  playbackInfo?: PlaybackInfo;
  mediaRevision: number;
  localOriginal: boolean;
  localPlayback: boolean;
  videoUrl?: string;
  thumbnailUrl?: string;
}

export interface CameraAvailabilityRecord {
  cameraId: string;
  startAt: number;
  endAt: number;
  state: string;
}

export interface StorageTotals {
  count: number;
  bytes: number;
  totalBytes: number;
  archivedBytes: number;
  localEvents: number;
  archivedEvents: number;
  unavailableBytes: number;
}

export interface RecordingEventListOptions {
  cameraId?: string;
  from?: number;
  to?: number;
  cursor?: string | null;
  limit?: number;
  kind?: string;
  status?: string;
  direction?: 'older' | 'newer';
}

export interface RawEventRow {
  id: string;
  camera_id: string;
  start_at: number;
  end_at: number;
  media_start_at: number | null;
  status: string;
  kinds: string;
  detections: string;
  duration: number;
  bytes: number;
  error: string | null;
  playback_version: number;
  playback_bytes: number;
  playback_info: string | null;
  media_revision: number;
  local_original: number;
  local_playback: number;
}

export function toRawEventRow(row: Record<string, unknown>): RawEventRow {
  return {
    id: String(row.id ?? ''),
    camera_id: String(row.camera_id ?? ''),
    start_at: Number(row.start_at ?? 0),
    end_at: Number(row.end_at ?? 0),
    media_start_at:
      row.media_start_at !== null && row.media_start_at !== undefined
        ? Number(row.media_start_at)
        : null,
    status: String(row.status ?? ''),
    kinds: String(row.kinds ?? '[]'),
    detections: String(row.detections ?? '[]'),
    duration: Number(row.duration ?? 0),
    bytes: Number(row.bytes ?? 0),
    error: row.error !== null && row.error !== undefined ? String(row.error) : null,
    playback_version: Number(row.playback_version ?? 0),
    playback_bytes: Number(row.playback_bytes ?? 0),
    playback_info:
      row.playback_info !== null && row.playback_info !== undefined
        ? String(row.playback_info)
        : null,
    media_revision: Number(row.media_revision ?? 0),
    local_original: Number(row.local_original ?? 1),
    local_playback: Number(row.local_playback ?? 1),
  };
}

export function decodeCursor(value: string): [number, string] {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !Number.isFinite(parsed[0]) ||
      typeof parsed[1] !== 'string' ||
      !/^[-a-f0-9]{36}$/.test(parsed[1])
    ) {
      throw new Error();
    }
    return [parsed[0] as number, parsed[1] as string];
  } catch {
    throw new Error('invalid_cursor');
  }
}

export async function prepareDirectories(config: { data: string; media: string }): Promise<void> {
  await mkdir(config.data, { recursive: true, mode: 0o700 });
  await mkdir(config.media, { recursive: true, mode: 0o750 });
}
