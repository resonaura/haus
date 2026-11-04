/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export interface StoredSession {
  url: string;
  name: string;
  clientId: string;
  refreshToken: string;
}
export interface NativeSession {
  url: string;
  name: string;
}
export interface CachedCameraSnapshot {
  image: string;
  receivedAt: number;
  capturedAt?: number;
}
export interface CameraSnapshotFrame extends CachedCameraSnapshot {
  fresh: boolean;
}
export type NativeEvent =
  | {
      type: 'connection';
      status: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
      error?: string;
    }
  | {
      type: 'ha-event';
      event: {
        event_type: string;
        data: Record<string, unknown>;
        context?: { id?: string; parent_id?: string | null; user_id?: string | null };
      };
    };
export interface CredentialStore {
  assertAvailable(): void;
  loadSession(): Promise<StoredSession | null>;
  saveSession(value: StoredSession): Promise<void>;
  clearSession(): Promise<void>;
  loadHomeCache(): Promise<unknown>;
  saveHomeCache(value: unknown): Promise<void>;
  readonly cameraSnapshots: {
    get(home: string, id: string): Promise<CachedCameraSnapshot | null>;
    put(home: string, id: string, value: CachedCameraSnapshot): void;
  };
}
export interface DiscoveredServer {
  id: string;
  name: string;
  url: string;
  host: string;
  port: number;
  version?: string;
}
