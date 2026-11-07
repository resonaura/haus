/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export { blobPath, Blobs, parseRange, digestPattern } from './blobs.js';
export { BlobReaders, openBlobRead, sameFile } from './blob-readers.js';
export { BlobVerification } from './blob-verification.js';
export { Catalog } from './catalog.js';
export { mediaGrant, verifyGrant } from './grants.js';
export {
  RecordingIndex,
  type RecordingValueRecord,
  type RecordingVariant,
  type RecordingBlobSource,
} from './recording-index.js';
export { recordingProvenance } from './recording-provenance.js';
export { StorageUsage } from '../storage/usage/scanner.js';
export type { StorageUsageReport, StorageRoot, StorageClassifier } from '../storage/usage/types.js';
export { nodeStorageCategory, addStorageRole } from './storage/usage.js';
export { decryptBackup } from './recovery.js';
export { NodeSettings, storageLimitFromEnvironment } from './settings.js';
export { nodeRoles } from './roles.js';
export { json, body } from './http.js';
export { sign, authenticator, EMPTY_DIGEST, type AuthHeaders } from './auth.js';
export {
  CameraContinuity,
  type ContinuityPlan,
  type ContinuitySource,
  type ContinuityCameraSession,
  type ContinuityEngine,
  type ContinuityRecordings,
} from './camera/continuity.js';
export {
  CameraActivity,
  type CameraActivityCapture,
  type CameraActivityEvent,
  type CameraActivityJob,
  type CameraActivityDetector,
  type CameraActivityRecordings,
  type CameraActivityEngine,
} from './camera/activity.js';
export {
  CameraAccess,
  cameraAccessKey,
  type CameraAccessGrant,
  type CameraAccessCameras,
  type CameraAccessSession,
  type CameraAccessViewer,
  type CameraAccessStatus,
  type CameraAccessCameraSession,
} from './camera/access.js';
export {
  CameraRecordings,
  captureMetadata,
  type CameraRecordingMetadata,
  type CameraRecordingsOptions,
} from './camera/recordings.js';
export {
  CameraSessions,
  type CameraSessionsSource,
  type CameraSessionsEngine,
  type CameraSessionsBlobs,
  type CameraSessionsSession,
  type CameraSessionsSessionDescription,
  type CameraSessionsOptions,
} from './camera/sessions.js';
export {
  Playback,
  type PlaybackCapacity,
  type PlaybackBlobs,
  type RecordingEncoder,
  type RecordingEncoderResult,
  type PlaybackOptions,
  type PlaybackStatus,
} from './playback/playback.js';
export { WorkerStreams, type WorkerStreamsOptions } from './playback/streams.js';
export type {
  BlobStatus,
  WorkspaceStatus,
  BackingSample,
  VolumeSample,
  BackingSample as NvrBackingSample,
} from './blobs.js';
export { NvrTransport, createNode } from './transport/service.js';
export type { NvrOptions } from './transport/types.js';
export { NvrModule } from './transport/module.js';
