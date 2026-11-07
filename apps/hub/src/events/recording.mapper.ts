/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { PlaybackInfo } from './playback.js';
import type {
  CameraAvailabilityRecord,
  EventDetection,
  EventRecord,
  RawEventRow,
} from './recording.types.js';
import type { CameraAvailabilityRow, RecordingEventRow } from './recording.entities.js';

export function toRawEvent(row: RecordingEventRow): RawEventRow {
  return {
    id: row.id,
    camera_id: row.cameraId,
    start_at: row.startAt,
    end_at: row.endAt,
    media_start_at: row.mediaStartAt,
    status: row.status,
    kinds: row.kinds,
    detections: row.detections,
    duration: row.duration,
    bytes: row.bytes,
    error: row.error,
    playback_version: row.playbackVersion,
    playback_bytes: row.playbackBytes,
    playback_info: row.playbackInfo,
    media_revision: row.mediaRevision,
    local_original: Number(row.localOriginal),
    local_playback: Number(row.localPlayback),
  };
}

export function toEventRecord(row: RawEventRow): EventRecord {
  const playbackInfo = row.playback_info
    ? (JSON.parse(row.playback_info) as PlaybackInfo)
    : undefined;
  const playbackDuration = playbackInfo?.duration;
  const duration =
    playbackDuration !== undefined && Number.isFinite(playbackDuration) && playbackDuration > 0
      ? playbackDuration
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

export function toAvailabilityRecord(row: CameraAvailabilityRow): CameraAvailabilityRecord {
  return { cameraId: row.cameraId, startAt: row.startAt, endAt: row.endAt, state: row.state };
}
