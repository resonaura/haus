/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface DeviceDescriptor {
  nativeId?: string;
  providerNativeId?: string;
  name: string;
  type?: string;
  interfaces: string[];
  info?: Record<string, Json>;
}
export interface DeviceRecord extends DeviceDescriptor {
  id: string;
  state: Record<string, Json>;
}
export interface MediaObject {
  mimeType: string;
  data: Buffer;
  options?: Record<string, Json>;
  getData(): Promise<Buffer>;
}
export interface FFmpegInput {
  url?: string;
  inputArguments: string[];
  mediaStreamOptions?: Record<string, Json>;
}
export interface KitsuneEvent {
  type:
    | 'kitsune:device:discovered'
    | 'kitsune:device:removed'
    | 'kitsune:device:state'
    | 'kitsune:device:event'
    | 'kitsune:media';
  pluginId: string;
  deviceId: string;
  property?: string;
  interface?: string;
  value?: Json;
  device?: DeviceRecord;
}
export interface Diagnostic {
  component: 'kitsune:compat' | 'kitsune:runtime';
  event: string;
  pluginId: string;
  target?: string;
  message: string;
}
export interface StorageBackend {
  get(scope: string): Record<string, string>;
  set(scope: string, key: string, value: string | null): void;
}
export interface HostAdapters {
  storage: StorageBackend;
  emit(event: KitsuneEvent): void;
  diagnostic(event: Diagnostic): void;
  ffmpegPath: string;
  endpointBase: string;
  publicEndpointBase?: string;
  media?: {
    toBuffer(media: MediaObject, mimeType: string): Promise<Buffer>;
    toUrl(media: MediaObject, mimeType: string): Promise<string>;
  };
}
export interface PluginDevice {
  getDevice?(nativeId: string): unknown | Promise<unknown>;
  releaseDevice?(id: string, nativeId: string): unknown;
  getSettings?(): unknown | Promise<unknown>;
  putSetting?(key: string, value: Json): unknown | Promise<unknown>;
  getCreateDeviceSettings?(): unknown | Promise<unknown>;
  createDevice?(settings: Record<string, Json>): unknown | Promise<unknown>;
  getVideoStreamOptions?(): Promise<StreamOption[]>;
  getVideoStream?(options?: Record<string, Json>): Promise<MediaObject>;
  onRequest?(request: unknown, response: unknown): unknown;
}
export interface StreamOption {
  id?: string;
  name?: string;
  video?: {
    width?: number;
    height?: number;
    bitrate?: number;
    fps?: number;
    codec?: string;
  } | null;
  audio?: { codec?: string } | null;
  source?: string;
}
