/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface RecordingIndexRow {
  id: string;
  digest: string;
  startAt: number;
  value: string;
}

export interface CameraRecordingOutboxRow {
  sequence: number;
  id: string;
  value: string;
  archived: number;
  acknowledged: number;
}

export interface CameraActivityEventRow {
  sequence: number;
  id: string;
  value: string;
  state: string;
  error: string | null;
  acknowledged: number;
}

export interface CameraActivityRequestRow {
  cameraId: string;
  policyId: string;
  requestId: string;
  eventId: string;
  createdAt: number;
}
