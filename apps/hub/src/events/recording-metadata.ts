/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { playbackReady, PLAYBACK_VERSION } from './playback.js';
import type { PlaybackInfo } from './playback.js';

export interface RecordingMetadataInput {
  id: string;
  cameraId: string;
  startAt: number;
  endAt: number;
  mediaStartAt?: number;
  duration: number;
  originalDuration?: number;
  kinds: string[];
  playbackVersion?: number;
  playbackBytes?: number;
  playbackInfo?: PlaybackInfo;
}

export function recordingMetadata(event: RecordingMetadataInput): Record<string, unknown> {
  const adjusted = {
    ...event,
    ...(event.playbackVersion === PLAYBACK_VERSION && !playbackReady(event)
      ? { playbackVersion: 0 }
      : {}),
    ...(Number.isFinite(event.mediaStartAt)
      ? { mediaStartAt: Math.round(event.mediaStartAt!) }
      : {}),
  };

  const fields = [
    'id',
    'cameraId',
    'startAt',
    'endAt',
    'mediaStartAt',
    'duration',
    'originalDuration',
    'kinds',
    'playbackVersion',
  ] as const;

  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (adjusted[field] !== undefined) {
      result[field] = adjusted[field];
    }
  }

  if (adjusted.playbackInfo) {
    result.playbackInfo = {
      audio: adjusted.playbackInfo.audio,
      originalCompatible: adjusted.playbackInfo.originalCompatible,
      originalPolicyVersion: adjusted.playbackInfo.originalPolicyVersion,
      originalProvenance: adjusted.playbackInfo.originalProvenance,
      compatibilityRepaired: adjusted.playbackInfo.compatibilityRepaired,
      sourceAudioMissing: adjusted.playbackInfo.sourceAudioMissing,
      largestGap: adjusted.playbackInfo.largestGap,
      duration: adjusted.playbackInfo.duration,
      audioTailSeconds: adjusted.playbackInfo.audioTailSeconds,
      audioTrimSeconds: adjusted.playbackInfo.audioTrimSeconds,
    };
  }

  return result;
}
