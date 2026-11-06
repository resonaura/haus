/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { CameraRing } from './ring.js';

export type VideoCodec = 'h264' | 'hevc' | 'av1';

export interface VideoCodecProfile {
  readonly codec: VideoCodec;
  readonly profile?: 'baseline' | 'main' | 'high';
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
}

export interface AudioCodecProfile {
  readonly codec: 'aac' | 'opus' | 'pcm_alaw' | 'pcm_mulaw';
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitrate?: number;
}

export interface SrtpSessionConfig {
  readonly clientIp: string;
  readonly videoPort: number;
  readonly videoSrtpKey: Buffer | Uint8Array;
  readonly audioPort: number;
  readonly audioSrtpKey: Buffer | Uint8Array;
}

export interface SrtpSessionHandle {
  readonly sessionId: string;
  readonly localVideoPort: number;
  readonly localAudioPort: number;
  stop(): Promise<void>;
}

export interface WebRtcSessionConfig {
  readonly streamId: string;
  readonly offerSdp: string;
}

export interface WebRtcSessionResult {
  readonly answerSdp: string;
  readonly sessionId: string;
}

export interface TranscodeFallbackConfig {
  readonly targetCodec: 'h264' | 'hevc';
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly targetFps: number;
  readonly targetBitrateKbps: number;
  readonly hardwareAcceleration?: 'videotoolbox' | 'vaapi' | 'nvenc' | 'qsv';
}

/**
 * Determines whether source and destination video profiles are compatible for direct
 * zero-transcode packet relay, avoiding unnecessary CPU/GPU decoding and re-encoding cycles.
 */
export function canZeroTranscodeRelay(
  source: VideoCodecProfile,
  target: VideoCodecProfile,
): boolean {
  if (source.codec !== target.codec) return false;

  // H.264 Baseline or Main is acceptable for Main target
  if (source.codec === 'h264' && target.codec === 'h264') {
    if (target.profile === 'baseline' && source.profile === 'high') {
      return false; // High profile cannot be passed directly to baseline-only client
    }
  }

  // If resolution constraints are defined, ensure source does not exceed target limits
  if (target.width && source.width && source.width > target.width) return false;
  if (target.height && source.height && source.height > target.height) return false;
  if (target.fps && source.fps && source.fps > target.fps) return false;

  return true;
}

/**
 * Universal Media Broker Interface matching the Haus protocol blueprint.
 * Coordinates go2rtc, MediaMTX, GStreamer, and hardware FFmpeg pipelines behind a neutral port.
 */
export interface MediaBroker {
  /** Ingests an incoming RTSP camera source stream */
  ingestRtsp(streamId: string, url: string): Promise<void>;

  /** Exposes an RTSP stream outbound */
  publishRtsp(streamId: string): Promise<string>;

  /** Handles WebRTC WHIP / WHEP sessions */
  startWebRtcSession(config: WebRtcSessionConfig): Promise<WebRtcSessionResult>;

  /** Configures an SRTP session for HomeKit live camera streaming */
  startSrtpSession(streamId: string, config: SrtpSessionConfig): Promise<SrtpSessionHandle>;

  /** Obtains the HKSV circular ring prebuffer for event recording */
  getHksvPrebuffer(streamId: string): CameraRing | undefined;

  /** Emits fragmented MP4 stream for live MSE or recording */
  streamFmp4(streamId: string): NodeJS.ReadableStream;

  /** Emits CMAF (Common Media Application Format) stream for ultra-low latency */
  streamCmaf(streamId: string): NodeJS.ReadableStream;

  /** Extracts an instant JPEG snapshot frame */
  extractSnapshot(streamId: string): Promise<Buffer>;

  /** Sends two-way return audio back to the camera speaker */
  sendTalkbackAudio(streamId: string, audioStream: NodeJS.ReadableStream): Promise<void>;

  /** Checks if direct packet relay is possible without transcoding */
  canDirectRelay(sourceProfile: VideoCodecProfile, targetProfile: VideoCodecProfile): boolean;

  /** Invokes hardware transcoding fallback when profiles are incompatible */
  startTranscodeFallback(
    streamId: string,
    config: TranscodeFallbackConfig,
  ): Promise<NodeJS.ReadableStream>;
}
