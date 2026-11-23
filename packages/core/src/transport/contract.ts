/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type HomeTransportMode = 'live' | 'demo';

export type HomeTransportStatus =
  'restoring' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'demo';

export interface TransportEntityState {
  readonly entity_id: string;
  readonly state: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly last_changed?: string;
  readonly last_updated?: string;
}

export interface TransportAreaEntry {
  readonly area_id: string;
  readonly name: string;
  readonly [key: string]: unknown;
}

export interface TransportDeviceEntry {
  readonly id: string;
  readonly area_id?: string | null;
  readonly name_by_user?: string | null;
  readonly [key: string]: unknown;
}

export interface TransportEntityRegistryEntry {
  readonly entity_id: string;
  readonly area_id?: string | null;
  readonly name?: string | null;
  readonly [key: string]: unknown;
}

export interface TransportAction {
  readonly domain: string;
  readonly service: string;
  readonly target: { readonly entity_id: string };
  readonly service_data?: Readonly<Record<string, unknown>>;
}

export interface TransportSnapshot {
  readonly states: readonly TransportEntityState[];
  readonly areas: readonly TransportAreaEntry[];
  readonly devices: readonly TransportDeviceEntry[];
  readonly entities: readonly TransportEntityRegistryEntry[];
  readonly services: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly config: Readonly<Record<string, unknown>>;
  readonly user: Readonly<Record<string, unknown>>;
  readonly sceneConfigs?: Readonly<Record<string, Record<string, unknown>>>;
}

export type HomeTransportRequest = Readonly<Record<string, unknown>> & {
  readonly type: string;
};

export type HomeTransportEvent<TEntity extends TransportEntityState = TransportEntityState> =
  | {
      readonly type: 'connection';
      readonly status: HomeTransportStatus;
      readonly error?: string;
    }
  | {
      readonly type: 'state_changed';
      readonly entityId: string;
      readonly newState: TEntity | null;
      readonly oldState: TEntity | null;
      readonly context?: {
        readonly id?: string;
        readonly parent_id?: string | null;
        readonly user_id?: string | null;
      };
    }
  | {
      readonly type: 'registry_updated';
      readonly eventType: string;
    }
  | {
      readonly type: 'mode_changed';
      readonly mode: HomeTransportMode;
    };

/**
 * Storage port for remembering local Demo Mode override per client instance
 * (e.g. `localStorage` on Desktop/Web, MMKV/SecureStore on Mobile). Never synced to the Hub.
 */
export interface DemoModeStorage {
  read(): boolean;
  write(enabled: boolean): void;
}

export interface SwitchModeOptions {
  /** Re-initialize demo fixture snapshot when entering demo mode. Defaults to `true`. */
  readonly resetDemo?: boolean;
  /** Persist local override to `DemoModeStorage`. Defaults to `true`. */
  readonly persist?: boolean;
}

/**
 * Shared OOP client transport contract consumed by Desktop (Electron IPC), Mobile (Expo/WS/HTTP),
 * Web (Fetch/WS), and offline Demo Mode so UI components remain 100% transport-agnostic.
 */
export interface HomeTransport<TEntity extends TransportEntityState = TransportEntityState> {
  readonly mode: HomeTransportMode;
  request<T = unknown>(message: HomeTransportRequest): Promise<T>;
  subscribe<T = unknown>(
    message: HomeTransportRequest,
    onEvent: (event: T) => void,
  ): Promise<() => void>;
  onEvent(listener: (event: HomeTransportEvent<TEntity>) => void): () => void;
  getSceneConfig(entityId: string, sceneId: string): Promise<Record<string, unknown> | null>;
  dispose(): void;
}
