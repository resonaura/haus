/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { CameraRing, CameraRingOptions } from '@haus/media/recording';
import type { MediaRuntime } from '@haus/media/pipeline';
import type { OpenPeerRtspOptions, PeerRtspSession, cameraSource } from '@haus/media/camera';
import type { CameraRecordings } from './recordings.js';
import type { BlobRelease } from '../blob-readers.js';
export type CameraSessionsRing = Pick<CameraRing, 'jobs' | 'startedAt' | 'freshAt' | 'failed' | 'metadata' | 'ready' | 'start' | 'stop' | 'sample' | 'record' | 'removeRecording'>;
export type CameraSessionsRecordings = Pick<CameraRecordings, 'preserve' | 'interruptActivity' | 'beginActivity' | 'activityRequest' | 'rememberActivityRequest'>;

export interface CameraSessionsSource {
  kind: string;
  url: string;
  peer?: OpenPeerRtspOptions;
}
export interface CameraSessionsEngine {
  failed?: boolean;
  initialize: (advertiseHost: string) => Promise<unknown>;
  add: (
    id: string,
    url: string,
    input: { sourceKind: string; cameraId: string },
  ) => Promise<unknown>;
  localRtsp: (id: string) => string;
  log?: (event: string, payload: Record<string, unknown>) => void;
  remove: (id: string) => Promise<unknown> | unknown;
  stop: () => Promise<unknown> | unknown;
  offer: (
    sessionId: string,
    owner: string,
    offer: string,
  ) => Promise<{ viewerId: string; answer: Record<string, unknown>; candidates?: unknown[] }>;
  viewers: Map<string, { session: string | { id: string }; owner: string }>;
  closeViewer: (viewerId: string, owner: string) => unknown;
  candidate: (viewerId: string, owner: string, value: unknown) => unknown;
}

export interface CameraSessionsBlobs {
  reserveWorkspace?: (bytes: number) => Promise<BlobRelease>;
  reserveTransient?: (bytes: number) => Promise<BlobRelease>;
}

export interface CameraSessionsSession {
  id: string;
  cameraId: string;
  source: CameraSessionsSource;
  preRollSeconds: number;
  requireAudio: boolean;
  recordAudio: boolean;
  rotation: boolean;
  owners: Map<string, number>;
  peer?: PeerRtspSession;
  ring?: CameraSessionsRing;
  replacement?: CameraSessionsSession;
}

export interface CameraSessionsSessionDescription {
  id: string;
  state: string;
  expiresAt: number;
  capabilities: { webrtc: boolean; recording: boolean };
  audio: boolean;
  preRollSeconds: number;
  requireAudio: boolean;
  recordAudio: boolean;
}

export interface CameraSessionAcquireInput {
  cameraId: string;
  owner: string;
  advertiseHost: string;
  source?: { kind: unknown; url: string };
  peer?: OpenPeerRtspOptions;
  requireAudio?: boolean;
  preRollSeconds?: number;
  recordAudio?: boolean;
}

export interface CameraSessionsOptions {
  capacity?: { pressured?: boolean };
  blobs?: CameraSessionsBlobs;
  recordings?: CameraSessionsRecordings;
  max?: number;
  now?: () => number;
  runtime?: MediaRuntime;
  source?: (
    input: { kind: unknown; url: unknown },
    resolve?: Parameters<typeof cameraSource>[1],
  ) => Promise<CameraSessionsSource>;
  ring?: (path: string, input: string, options: CameraRingOptions) => CameraSessionsRing;
}

