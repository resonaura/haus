/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EntitySchema } from 'typeorm';
import type {
  CameraActivityEventRow,
  CameraActivityRequestRow,
  CameraRecordingOutboxRow,
  RecordingIndexRow,
} from './types.js';

/** These tables keep their legacy names so existing Node recording catalogs reopen in place. */
export const RecordingIndexEntity = new EntitySchema<RecordingIndexRow>({
  name: 'NvrRecordingIndex',
  tableName: 'recordings',
  columns: {
    id: { type: 'text', primary: true },
    digest: { type: 'text' },
    startAt: { type: 'integer', name: 'start_at' },
    value: { type: 'text' },
  },
  indices: [
    { name: 'recordings_time', columns: ['startAt', 'id'] },
    { name: 'recordings_digest', columns: ['digest'] },
  ],
});

export const CameraRecordingOutboxEntity = new EntitySchema<CameraRecordingOutboxRow>({
  name: 'NvrCameraRecordingOutbox',
  tableName: 'camera_recording_outbox',
  columns: {
    sequence: { type: 'integer', primary: true, generated: 'increment' },
    id: { type: 'text', unique: true },
    value: { type: 'text' },
    archived: { type: 'integer', default: 0 },
    acknowledged: { type: 'integer', default: 0 },
  },
});

export const CameraActivityEventEntity = new EntitySchema<CameraActivityEventRow>({
  name: 'NvrCameraActivityEvent',
  tableName: 'camera_activity_events',
  columns: {
    sequence: { type: 'integer' },
    id: { type: 'text', primary: true },
    value: { type: 'text' },
    state: { type: 'text' },
    error: { type: 'text', nullable: true },
    acknowledged: { type: 'integer', default: 0 },
  },
  indices: [
    { name: 'camera_activity_event_state', columns: ['state', 'acknowledged'] },
    { name: 'camera_activity_event_sequence', columns: ['sequence'] },
  ],
});

export const CameraActivityRequestEntity = new EntitySchema<CameraActivityRequestRow>({
  name: 'NvrCameraActivityRequest',
  tableName: 'camera_activity_requests',
  columns: {
    cameraId: { type: 'text', name: 'camera_id', primary: true },
    policyId: { type: 'text', name: 'policy_id', primary: true },
    requestId: { type: 'text', name: 'request_id', primary: true },
    eventId: { type: 'text', name: 'event_id' },
    createdAt: { type: 'integer', name: 'created_at' },
  },
  indices: [{ name: 'camera_activity_request_time', columns: ['createdAt'] }],
});
