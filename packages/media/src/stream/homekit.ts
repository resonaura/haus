/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { join } from 'node:path';
import type { MediaRuntime } from '../pipeline/tools.js';

export interface HomeKitVideo {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  profile: number;
  level: number;
}

export interface HomeKitInputProfile {
  realtime?: boolean;
  loop?: boolean;
  lowLatency?: boolean;
}

export interface HomeKitAudioProfile {
  sampleRate: number;
  bitrate: number;
}

export interface HomeKitRecordingProfile {
  source: string;
  input?: HomeKitInputProfile;
  video: HomeKitVideo;
  fragmentLength: number;
  audio?: HomeKitAudioProfile;
}

export interface HomeKitRtpOutput {
  payloadType: number;
  ssrc: number;
  key: string;
  salt: string;
  port: number;
  packetSize: number;
}

export interface HomeKitStreamProfile {
  source: string;
  input?: HomeKitInputProfile;
  video: HomeKitVideo;
  videoOutput: HomeKitRtpOutput;
  audioOutput: HomeKitRtpOutput;
  audio: {
    codec: 'opus';
    sampleRate: number;
    bitrate: number;
    packetTime: number;
  };
  microphoneVolume: number;
}

function validInteger(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function normalizeHomeKitVideo(value: HomeKitVideo): HomeKitVideo {
  if (
    !value ||
    !validInteger(value.width, 160, 1920) ||
    !validInteger(value.height, 120, 1080) ||
    value.width % 2 !== 0 ||
    value.height % 2 !== 0 ||
    !validInteger(value.fps, 1, 30) ||
    !validInteger(value.bitrate, 32, 8000) ||
    !validInteger(value.profile, 0, 2) ||
    !validInteger(value.level, 0, 2)
  )
    throw new Error('invalid_homekit_video');
  return { ...value };
}

function inputArgs(source: string, profile: HomeKitInputProfile = {}): string[] {
  if (!source || source.includes('\0')) throw new Error('invalid_media_source');
  return [
    ...(profile.realtime ? ['-re'] : []),
    ...(profile.loop ? ['-stream_loop', '-1'] : []),
    ...(/^rtsps?:/i.test(source)
      ? [
          ...(profile.lowLatency ? ['-fflags', 'nobuffer'] : []),
          '-rtsp_transport',
          'tcp',
          '-timeout',
          '10000000',
          '-probesize',
          profile.lowLatency ? '524288' : '2097152',
          '-analyzeduration',
          profile.lowLatency ? '1000000' : '3000000',
        ]
      : []),
    '-i',
    source,
  ];
}

function videoArgs(value: HomeKitVideo, seconds: number): string[] {
  const video = normalizeHomeKitVideo(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('invalid_homekit_video');
  return [
    '-map',
    '0:v:0',
    '-sn',
    '-dn',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-threads',
    '1',
    '-vf',
    `scale=${video.width}:${video.height}:force_original_aspect_ratio=decrease,pad=${video.width}:${video.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    '-r',
    String(video.fps),
    '-b:v',
    `${video.bitrate}k`,
    '-maxrate',
    `${video.bitrate}k`,
    '-bufsize',
    `${video.bitrate * 2}k`,
    '-profile:v',
    ['baseline', 'main', 'high'][video.profile]!,
    '-level:v',
    ['3.1', '3.2', '4.0'][video.level]!,
    '-g',
    String(Math.max(1, Math.round(video.fps * seconds))),
    '-keyint_min',
    String(Math.max(1, Math.round(video.fps * seconds))),
    '-sc_threshold',
    '0',
  ];
}

function spawn(runtime: MediaRuntime, args: string[], stdio: SpawnOptions['stdio']): ChildProcess {
  return runtime.spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
    stdio,
    windowsHide: true,
  });
}

export function spawnHomeKitRecorder(
  runtime: MediaRuntime,
  profile: HomeKitRecordingProfile,
): ChildProcess {
  const args = [
    ...inputArgs(profile.source, profile.input),
    ...videoArgs(profile.video, profile.fragmentLength / 1000),
    ...(profile.audio
      ? [
          '-map',
          '0:a:0',
          '-c:a',
          'aac',
          '-ar',
          String(profile.audio.sampleRate),
          '-ac',
          '1',
          '-b:a',
          `${profile.audio.bitrate}k`,
        ]
      : ['-an']),
    '-f',
    'mp4',
    '-movflags',
    '+frag_keyframe+empty_moov+default_base_moof',
    '-flush_packets',
    '1',
    'pipe:1',
  ];
  return spawn(runtime, args, ['ignore', 'pipe', 'ignore']);
}

function rtpArgs(output: HomeKitRtpOutput, track: 'audio' | 'video'): string[] {
  if (
    !validInteger(output.payloadType, 96, 127) ||
    !validInteger(output.ssrc, 0, 0xffffffff) ||
    !/^[a-f0-9]{32}$/.test(output.key) ||
    !/^[a-f0-9]{28}$/.test(output.salt) ||
    !validInteger(output.port, 1, 65535) ||
    !validInteger(output.packetSize, 188, 1400)
  )
    throw new Error('invalid_homekit_crypto');
  const key = Buffer.from(`${output.key}${output.salt}`, 'hex').toString('base64');
  return [
    '-payload_type',
    String(output.payloadType),
    '-ssrc',
    String(output.ssrc | 0),
    '-f',
    'rtp',
    '-srtp_out_suite',
    'AES_CM_128_HMAC_SHA1_80',
    '-srtp_out_params',
    key,
    `srtp://127.0.0.1:${output.port}?rtcpport=${output.port}&pkt_size=${track === 'video' ? output.packetSize : 400}`,
  ];
}

export function spawnHomeKitStream(
  runtime: MediaRuntime,
  profile: HomeKitStreamProfile,
): ChildProcess {
  if (
    profile.audio.codec !== 'opus' ||
    ![16000, 24000].includes(profile.audio.sampleRate) ||
    !validInteger(profile.audio.bitrate, 8, 128) ||
    ![20, 40, 60].includes(profile.audio.packetTime)
  )
    throw new Error('invalid_homekit_stream');
  const volume = Number.isFinite(profile.microphoneVolume)
    ? Math.max(0, Math.min(1, profile.microphoneVolume))
    : 0;
  const args = [
    ...inputArgs(profile.source, profile.input),
    ...videoArgs(profile.video, 1),
    ...rtpArgs(profile.videoOutput, 'video'),
    '-map',
    '0:a:0',
    '-vn',
    '-c:a',
    'libopus',
    '-application',
    'lowdelay',
    '-frame_duration',
    String(profile.audio.packetTime),
    '-ar',
    String(profile.audio.sampleRate),
    '-ac',
    '1',
    '-b:a',
    `${profile.audio.bitrate}k`,
    '-af',
    `volume=${volume}`,
    ...rtpArgs(profile.audioOutput, 'audio'),
    '-progress',
    'pipe:1',
  ];
  return spawn(runtime, args, ['ignore', 'pipe', 'ignore']);
}

export function spawnHomeKitTalkback(
  runtime: MediaRuntime,
  sdp: string,
  volume: number,
): ChildProcess {
  const normalized = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
  return spawn(
    runtime,
    [
      '-protocol_whitelist',
      'pipe,udp,rtp,crypto',
      '-f',
      'sdp',
      '-i',
      'pipe:0',
      '-vn',
      '-c:a',
      'libopus',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-b:a',
      '24k',
      '-af',
      `volume=${normalized}`,
      '-f',
      'webm',
      '-live',
      '1',
      '-cluster_time_limit',
      '100',
      'pipe:1',
    ],
    ['pipe', 'pipe', 'ignore'],
  );
}

export function spawnHomeKitSnapshot(
  runtime: MediaRuntime,
  source: string,
  options: { lowLatency?: boolean } = {},
): ChildProcess {
  return spawn(
    runtime,
    [
      ...inputArgs(source, { lowLatency: options.lowLatency }),
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-an',
      '-vf',
      'scale=640:-2',
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
      'pipe:1',
    ],
    ['ignore', 'pipe', 'ignore'],
  );
}

/** Extracts one scaled JPEG snapshot frame from a local recording or buffer segment file. */
export function spawnMediaFrameSnapshot(runtime: MediaRuntime, filePath: string): ChildProcess {
  if (!filePath || filePath.includes('\0')) throw new Error('invalid_media_source');
  return spawn(
    runtime,
    [
      '-i',
      filePath,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-an',
      '-vf',
      'scale=640:-2',
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
      'pipe:1',
    ],
    ['ignore', 'pipe', 'ignore'],
  );
}

export function spawnCameraHls(
  runtime: MediaRuntime,
  source: string,
  outputDir: string,
  options: { stderrPipe?: boolean } = {},
): ChildProcess {
  return spawn(
    runtime,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputArgs(source, { lowLatency: true }),
      ...(/^rtsps?:/i.test(source) ? ['-avoid_negative_ts', 'make_zero'] : []),
      '-map',
      '0:v:0',
      '-c:v',
      'copy',
      '-an',
      '-f',
      'hls',
      '-hls_time',
      '1',
      '-hls_list_size',
      '5',
      '-hls_flags',
      'delete_segments+independent_segments+temp_file',
      '-hls_segment_filename',
      join(outputDir, 'segment-%09d.ts'),
      join(outputDir, 'index.m3u8'),
    ],
    ['ignore', 'ignore', options.stderrPipe ? 'pipe' : 'ignore'],
  );
}
