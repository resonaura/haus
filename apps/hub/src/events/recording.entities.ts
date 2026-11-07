/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EntitySchema } from 'typeorm';

export interface RecordingSettingRow {
  id: string;
  value: string;
}

export interface RecordingEventRow {
  id: string;
  cameraId: string;
  startAt: number;
  endAt: number;
  mediaStartAt: number | null;
  status: string;
  kinds: string;
  detections: string;
  duration: number;
  bytes: number;
  error: string | null;
  playbackVersion: number;
  playbackBytes: number;
  playbackInfo: string | null;
  mediaRevision: number;
  localOriginal: boolean;
  localPlayback: boolean;
}

export interface CameraAvailabilityRow {
  cameraId: string;
  startAt: number;
  endAt: number;
  state: string;
}

export interface EventArchiveRow {
  eventId: string;
  variant: string;
  digest: string;
  bytes: number;
  version: number;
}

export interface EventArchiveLocationRow extends EventArchiveRow {
  nodeId: string;
  verifiedAt: number;
}

export interface EventArchiveStateRow {
  id: number;
  generation: number;
}

export interface RecordingMigrationRow {
  id: string;
}

export const RecordingSettingEntity = new EntitySchema<RecordingSettingRow>({
  name: 'RecordingSetting',
  tableName: 'settings',
  columns: {
    id: { type: 'text', primary: true },
    value: { type: 'text' },
  },
});

export const RecordingEventEntity = new EntitySchema<RecordingEventRow>({
  name: 'RecordingEvent',
  tableName: 'events',
  columns: {
    id: { type: 'text', primary: true },
    cameraId: { type: 'text', name: 'camera_id' },
    startAt: { type: 'integer', name: 'start_at' },
    endAt: { type: 'integer', name: 'end_at' },
    mediaStartAt: { type: 'integer', name: 'media_start_at', nullable: true },
    status: { type: 'text' },
    kinds: { type: 'text' },
    detections: { type: 'text' },
    duration: { type: 'real', default: 0 },
    bytes: { type: 'integer', default: 0 },
    error: { type: 'text', nullable: true },
    playbackVersion: { type: 'integer', name: 'playback_version', default: 0 },
    playbackBytes: { type: 'integer', name: 'playback_bytes', default: 0 },
    playbackInfo: { type: 'text', name: 'playback_info', nullable: true },
    mediaRevision: { type: 'integer', name: 'media_revision', default: 0 },
    localOriginal: { type: 'boolean', name: 'local_original', default: true },
    localPlayback: { type: 'boolean', name: 'local_playback', default: true },
  },
  indices: [
    { name: 'events_camera_time', columns: ['cameraId', 'startAt', 'id'] },
    { name: 'events_camera_status_time', columns: ['cameraId', 'status', 'startAt', 'id'] },
  ],
});

export const CameraAvailabilityEntity = new EntitySchema<CameraAvailabilityRow>({
  name: 'CameraAvailability',
  tableName: 'camera_availability',
  columns: {
    cameraId: { type: 'text', name: 'camera_id', primary: true },
    startAt: { type: 'integer', name: 'start_at', primary: true },
    endAt: { type: 'integer', name: 'end_at' },
    state: { type: 'text' },
  },
  indices: [{ name: 'camera_availability_time', columns: ['cameraId', 'endAt'] }],
});

export const EventArchiveEntity = new EntitySchema<EventArchiveRow>({
  name: 'EventArchive',
  tableName: 'event_archive',
  columns: {
    eventId: { type: 'text', name: 'event_id', primary: true },
    variant: { type: 'text', primary: true },
    digest: { type: 'text' },
    bytes: { type: 'integer' },
    version: { type: 'integer' },
  },
});

export const EventArchiveLocationEntity = new EntitySchema<EventArchiveLocationRow>({
  name: 'EventArchiveLocation',
  tableName: 'event_archive_locations',
  columns: {
    eventId: { type: 'text', name: 'event_id', primary: true },
    variant: { type: 'text', primary: true },
    nodeId: { type: 'text', name: 'node_id', primary: true },
    digest: { type: 'text' },
    bytes: { type: 'integer' },
    version: { type: 'integer' },
    verifiedAt: { type: 'integer', name: 'verified_at' },
  },
});

export const EventArchiveStateEntity = new EntitySchema<EventArchiveStateRow>({
  name: 'EventArchiveState',
  tableName: 'event_archive_state',
  columns: {
    id: { type: 'integer', primary: true },
    generation: { type: 'integer' },
  },
});

export const RecordingMigrationEntity = new EntitySchema<RecordingMigrationRow>({
  name: 'RecordingMigration',
  tableName: 'migrations',
  columns: { id: { type: 'text', primary: true } },
});
