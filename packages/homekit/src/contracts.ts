/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ChildProcess, spawn } from 'node:child_process';
import type { PassThrough } from 'node:stream';
import type { Socket } from 'node:dgram';
import type * as Hap from '@homebridge/hap-nodejs';
import type { MediaRuntime } from '@haus/media/pipeline';
import type { HomeKitInputProfile, HomeKitVideo } from '@haus/media/stream';

export interface HomeKitSettings {
  enabled: boolean;
  processor: string;
}
export interface Camera {
  id: string;
  name?: string;
  available: boolean;
}
export interface Registry {
  cameras: Camera[];
}
export interface Node {
  id: string;
  name: string;
  url: string;
  key: string;
  enabled: boolean;
  roles: string[];
}
export interface SourceSession {
  id: string;
  node: Node;
}
export interface MediaContext {
  cameraId: string;
  owner: string;
  sessionId: string;
  address: string;
}
export type Video = HomeKitVideo;
export interface RecordingSettings {
  video: Video;
  fragmentLength: number;
  prebufferLength: number;
  audio: boolean;
  audioRate: number;
  audioBitrate: number;
}
export interface WireCrypto {
  port: number;
  srtpCryptoSuite: number;
  key: string;
  salt: string;
}
export interface PrepareRequest {
  sessionID: string;
  targetAddress: string;
  video: WireCrypto;
  audio: WireCrypto;
}
export type StartRequest = Hap.StartStreamRequest;
/** Only the fields consumed by Haus cross the NVR media boundary. */
export interface MediaStartRequest {
  sessionID: string;
  video: Omit<Video, 'bitrate'> & { max_bit_rate: number; pt: number; mtu: number };
  audio: {
    codec: string;
    sample_rate: number;
    pt: number;
    max_bit_rate: number;
    packet_time: number;
  };
}
export type Configure = MediaContext & {
  action: 'configure';
  configuration: RecordingSettings | null;
  generation: number;
};
export type Packet = MediaContext & {
  action: 'open' | 'next' | 'close';
  readerId?: string;
  cursor?: number;
};
export type Prepare = MediaContext & { action: 'prepare'; request: PrepareRequest };
export type Start = MediaContext & {
  action: 'start';
  request: MediaStartRequest;
  talkback?: boolean;
  microphoneMuted?: boolean;
  microphoneVolume?: number;
  speakerVolume?: number;
};
export type MediaCommand =
  | Configure
  | Packet
  | Prepare
  | Start
  | (MediaContext & { action: 'stop' | 'talk'; sessionID: string })
  | (MediaContext & { action: 'snapshot' })
  | (MediaContext & { action: 'lease'; sessionID?: string });
export interface PrepareReply {
  addressOverride: string;
  video: { port: number; ssrc: number; srtp_key?: Buffer; srtp_salt?: Buffer };
  audio: { port: number; ssrc: number; srtp_key?: Buffer; srtp_salt?: Buffer };
}
export interface PacketReply {
  readerId: string;
  cursor: number;
  data?: string;
}
export interface Fragment {
  sequence: number;
  at: number;
  data: Buffer;
}
export interface Recorder {
  child: ChildProcess;
  fingerprint: string;
  configuration: RecordingSettings;
  fragments: Fragment[];
  bytes: number;
  sequence: number;
  until: number;
  readers: Map<string, number>;
  waiters: Set<() => void>;
  initialization?: Buffer;
  failed?: boolean;
}
export interface MediaSession {
  context: MediaContext;
  request: PrepareRequest;
  until: number;
  ssrc: Record<'audio' | 'video', number>;
  sockets: Partial<Record<'audio' | 'video', Socket>>;
  senders: Partial<Record<'audio' | 'video', Socket>>;
  forward: boolean;
  children: Set<ChildProcess>;
  talkPort?: number;
  talk?: PassThrough;
  talkClaimed?: boolean;
  started?: boolean;
}
export interface MediaOptions {
  input: (context: MediaContext) => Promise<string>;
  capacity?: { pressured?: boolean };
  maxEncoders?: number;
  spawnProcess?: typeof spawn;
  runtime?: MediaRuntime;
  now?: () => number;
  inputProfile?: HomeKitInputProfile;
  rtpPortRange?: [number, number];
}
export interface Identity {
  username: string;
  pincode: string;
  setupID: string;
}
export interface HomeKitIdentityStorage {
  list(): Promise<readonly { cameraId: string; value: string }[]>;
  save(cameraId: string, value: string): Promise<void>;
  delete(cameraId: string): Promise<void>;
}
export interface Route {
  local?: import('./media.js').HomeKitMedia;
  node?: Node;
  source?: SourceSession;
  name: string;
  context: MediaContext;
}
export interface Live {
  route: Route;
  request: Hap.PrepareStreamRequest;
  abort: AbortController;
  started?: StartRequest;
  talk?: { abort: AbortController; task: Promise<void> };
}
export interface Entry {
  cameraId: string;
  accessory: Hap.Accessory;
  identity: Identity;
  motion: Hap.Service;
  spotlight?: { service: Hap.Service; signature: string };
  operating?: Set<import('./operating.js').OperatingControl>;
  controller: Hap.CameraController & {
    recordingManagement: NonNullable<Hap.CameraController['recordingManagement']>;
  };
  live: Map<string, Live>;
  recordStreams: Map<number, AbortController>;
  owner: string;
  generation: number;
  closed: boolean;
  talkAvailable?: boolean;
  recordingActive?: boolean;
  configuration?: Hap.CameraRecordingConfiguration;
  error?: string;
  published?: boolean;
  pairUntil?: number;
  snapshot?: { at: number; buffer: Buffer };
  recordRoute?: Route;
  prebufferReady?: boolean;
  updating?: boolean;
  fingerprint?: string;
  lastActivity?: number;
}
export interface RpcOptions {
  method: string;
  data: object;
  signal?: AbortSignal;
  timeout: number;
}
export interface BridgeOptions {
  config: { data: string; homekit_address?: string };
  store: { overrides: () => Record<string, { homekit?: HomeKitSettings }> };
  identityStorage: HomeKitIdentityStorage;
  cluster: {
    nodes: () => Node[];
    health: Map<string, { remote?: { features?: { homekitMedia?: boolean } } }>;
  };
  sessions: {
    ensure: (
      camera: Camera,
      owner: string,
      buffered?: boolean,
      node?: Node,
      force?: boolean,
    ) => Promise<SourceSession>;
    ensureLive: (camera: Camera, owner: string) => Promise<SourceSession>;
    release: (cameraId: string, owner: string) => Promise<unknown>;
    advertiseHost: (node: Node) => Promise<string>;
  };
  registry: () => Registry;
  activity: { status: (id: string) => { available: boolean; active: boolean } };
  talkback: {
    available: (camera: Camera, registry: Registry) => Promise<boolean>;
    stream: (
      camera: Camera,
      registry: Registry,
      req: PassThrough & { headers: Record<string, string> },
      res: PassThrough & { writeHead: () => PassThrough; flushHeaders: () => void },
    ) => Promise<void>;
  };
  snapshot?: (camera: Camera) => Promise<{ buffer: Buffer }>;
  spotlight?: import('./spotlight.js').SpotlightSource;
  operating?: import('./operating.js').CameraOperatingSource;
  now?: () => number;
  hap?: typeof Hap;
  json: <T>(node: Node, path: string, options: RpcOptions) => Promise<T>;
  request: (node: Node, path: string, options: RpcOptions) => Promise<Response>;
  resolveSource: (
    camera: Camera,
    registry: Registry,
    options: { local: boolean },
  ) => { url: string };
  validateSource: (source: { kind: string; url: string }) => Promise<{ url: string }>;
}
