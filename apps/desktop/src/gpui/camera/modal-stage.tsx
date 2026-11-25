/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { recordingDay, type CameraEvent } from '@haus/core/transport';
import { cameraStageMediaStyle } from '@haus/ui/components';
import { rgba } from '@haus/ui/ir';
import { Image, Text, VideoSurface } from '@haus/ui/primitives';
import { demoCameraPreviewSrc } from './preview-image.js';
import type { GpuiCameraStreams } from './stream.js';

export type CameraLiveState = 'connecting' | 'playing' | 'reconnecting' | 'stopped';

export function shiftCameraDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return recordingDay(date);
}

export function formatEventDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const mins = Math.floor(rounded / 60);
  const rem = rounded % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

export function cameraStatusTag({
  selectedRecording,
  demo,
  available,
  entityState,
  streaming,
  liveState,
}: {
  readonly selectedRecording?: CameraEvent;
  readonly demo?: boolean;
  readonly available: boolean;
  readonly entityState: string;
  readonly streaming: boolean;
  readonly liveState: CameraLiveState;
}): string | undefined {
  if (selectedRecording) return undefined;
  if (demo) return 'DEMO · STILL IMAGE';
  if (!available) return entityState === 'off' ? 'OFF' : 'OFFLINE';
  if (streaming) return liveState === 'playing' ? undefined : liveState.toUpperCase();
  return 'SNAPSHOT';
}

export function CameraModalViewport({
  cameraId,
  title,
  demoScene,
  demo,
  available,
  playing,
  fill,
  selectedRecording,
  streaming,
  activeSnapshot,
  liveFrames,
  recordingFrames,
  onStateChange,
  onRecordingEnded,
}: {
  readonly cameraId: string;
  readonly title: string;
  readonly demoScene?: string;
  readonly demo?: boolean;
  readonly available: boolean;
  readonly playing: boolean;
  readonly fill: boolean;
  readonly selectedRecording?: CameraEvent;
  readonly streaming?: { readonly hub: string; readonly streams: GpuiCameraStreams };
  readonly activeSnapshot: string | null;
  readonly liveFrames: (signal: AbortSignal) => ReturnType<GpuiCameraStreams['open']>;
  readonly recordingFrames: (signal: AbortSignal) => ReturnType<GpuiCameraStreams['openRecording']>;
  readonly onStateChange: (state: CameraLiveState) => void;
  readonly onRecordingEnded: () => void;
}) {
  if (selectedRecording) {
    if (streaming && !demo && playing) {
      return (
        <VideoSurface
          key={`rec-${selectedRecording.id}`}
          id={`recording-${selectedRecording.id}`}
          frameSource={recordingFrames}
          objectFit="contain"
          style={cameraStageMediaStyle}
          onPlaying={() => onStateChange('playing')}
          onEnded={onRecordingEnded}
          onError={() => onStateChange('stopped')}
        />
      );
    }
    return (
      <Image
        src={demoCameraPreviewSrc(demoScene, 0)}
        alt={title}
        objectFit={fill ? 'cover' : 'contain'}
        style={cameraStageMediaStyle}
      />
    );
  }

  if (streaming && !demo && available) {
    return (
      <VideoSurface
        key={`live-${cameraId}`}
        id={`stream-${cameraId}`}
        frameSource={liveFrames}
        objectFit={fill ? 'cover' : 'contain'}
        style={cameraStageMediaStyle}
        onEnded={() => onStateChange('stopped')}
        onError={() => onStateChange('stopped')}
      />
    );
  }

  if (demo) {
    return (
      <Image
        src={demoCameraPreviewSrc(demoScene, 0)}
        alt={title}
        objectFit={fill ? 'cover' : 'contain'}
        style={cameraStageMediaStyle}
      />
    );
  }

  if (activeSnapshot) {
    return (
      <Image
        src={activeSnapshot}
        alt={title}
        objectFit={fill ? 'cover' : 'contain'}
        transitionMs={220}
        style={cameraStageMediaStyle}
      />
    );
  }

  return (
    <Text size={12} style={{ typography: { color: rgba(255, 255, 255, 0.56) } }}>
      {available ? 'Connecting to camera…' : 'Camera unavailable'}
    </Text>
  );
}
