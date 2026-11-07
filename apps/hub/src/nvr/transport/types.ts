/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Capacity, Detectors } from '@haus/ai';
import type { HostTelemetry } from '@haus/servers';
import type { HomeKitMedia } from '@haus/homekit/media';
import type { RtspPeer } from '@haus/media/camera';
import type { Blobs } from '../blobs.js';
import type { Catalog } from '../catalog.js';
import type { RecordingIndex } from '../recording-index.js';
import type { NodeSettings } from '../settings.js';
import type { StorageUsage } from '../storage-usage.js';
import type { CameraSessions } from '../camera/sessions.js';
import type { CameraAccess } from '../camera/access.js';
import type { CameraActivity } from '../camera/activity.js';
import type { CameraContinuity } from '../camera/continuity.js';
import type { CameraRecordings } from '../camera/recordings.js';
import type { WorkerStreams } from '../playback/streams.js';
import type { Playback } from '../playback/playback.js';

export interface NvrOptions {
  /** Composition owns resources; transport drains requests between stop and closeStorage. */
  lifetime?: { stop(): Promise<void>; closeStorage(): Promise<void> };
  key: string;
  blobs: Pick<Blobs, 'status' | 'verify' | 'put' | 'info' | 'openRead' | 'remove'>;
  catalog?: Pick<Catalog, 'list' | 'add' | 'remove'>;
  recordings?: Pick<RecordingIndex, 'list' | 'get' | 'add' | 'remove' | 'close'>;
  nodeId?: string;
  instanceId?: string;
  roles?: string[];
  maxStreams?: number;
  capacity?: Pick<Capacity, 'pressured' | 'status'>;
  detectors?: Pick<Detectors, 'status' | 'handle' | 'stop'>;
  playback?: Pick<Playback, 'status' | 'handle' | 'stop'>;
  settings?: Pick<NodeSettings, 'status' | 'update'>;
  host?: Pick<HostTelemetry, 'status' | 'stop'>;
  storageUsage?: Pick<StorageUsage, 'status' | 'stop'>;
  streams?: Pick<WorkerStreams, 'handle' | 'origin' | 'size' | 'capacity' | 'stop'>;
  cameras?: Pick<CameraSessions, 'sessions' | 'status' | 'handle' | 'otherStreams' | 'stop'>;
  cameraAccess?: Pick<CameraAccess, 'handle' | 'provision' | 'reconcile' | 'revoke'>;
  continuity?: Pick<CameraContinuity, 'update' | 'status' | 'stop'>;
  cameraRecordings?: Pick<
    CameraRecordings,
    | 'list'
    | 'get'
    | 'acknowledge'
    | 'interruptedActivities'
    | 'acknowledgeInterrupted'
    | 'pending'
    | 'stop'
  >;
  cameraActivity?: Pick<CameraActivity, 'trigger' | 'status' | 'update' | 'stop'>;
  homekit?: Pick<HomeKitMedia, 'command' | 'status' | 'stop'>;
  peers?: Pick<RtspPeer, 'grant' | 'upgrade' | 'stop'>;
}
