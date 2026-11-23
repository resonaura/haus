/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ConnectionState } from '../runtime.js';
import type {
  DemoModeStorage,
  HomeTransport,
  HomeTransportEvent,
  HomeTransportRequest,
  HomeTransportStatus,
  TransportEntityState,
} from './contract.js';

export interface IpcBridgePort {
  request<T = unknown>(message: Record<string, unknown>): Promise<T>;
  subscribe?<T = unknown>(
    message: Record<string, unknown>,
    callback: (event: T) => void,
  ): Promise<() => void>;
  getSceneConfig?(entityId: string, sceneId: string): Promise<Record<string, unknown> | null>;
  onEvent?(callback: (event: unknown) => void): () => void;
}

function normalizeBridgeEvent<TEntity extends TransportEntityState>(
  raw: unknown,
): HomeTransportEvent<TEntity> | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as Record<string, unknown>;
  if (event.type === 'connection' && typeof event.status === 'string') {
    const status = event.status as HomeTransportStatus;
    return {
      type: 'connection',
      status,
      ...(typeof event.error === 'string' ? { error: event.error } : {}),
    };
  }
  if (event.type === 'ha-event' && event.event && typeof event.event === 'object') {
    const inner = event.event as Record<string, unknown>;
    const eventType = typeof inner.event_type === 'string' ? inner.event_type : '';
    const data =
      inner.data && typeof inner.data === 'object' ? (inner.data as Record<string, unknown>) : {};
    if (eventType === 'state_changed' && typeof data.entity_id === 'string') {
      const ctx =
        inner.context && typeof inner.context === 'object'
          ? (inner.context as { id?: string; parent_id?: string | null; user_id?: string | null })
          : undefined;
      return {
        type: 'state_changed',
        entityId: data.entity_id,
        newState: (data.new_state as TEntity | null) ?? null,
        oldState: (data.old_state as TEntity | null) ?? null,
        ...(ctx ? { context: ctx } : {}),
      };
    }
    if (eventType.endsWith('_registry_updated')) {
      return { type: 'registry_updated', eventType };
    }
  }
  return null;
}

/**
 * Adapts a native desktop IPC bridge (e.g. Electron preload `window.hausNative`)
 * to the platform-neutral `HomeTransport` contract.
 */
export class IpcBridgeTransport<
  TEntity extends TransportEntityState = TransportEntityState,
> implements HomeTransport<TEntity> {
  readonly mode = 'live' as const;
  private readonly listeners = new Set<(event: HomeTransportEvent<TEntity>) => void>();
  private readonly detachBridge?: () => void;

  constructor(private readonly bridge: IpcBridgePort) {
    if (bridge.onEvent) {
      this.detachBridge = bridge.onEvent((raw) => {
        const normalized = normalizeBridgeEvent<TEntity>(raw);
        if (!normalized) return;
        for (const listener of this.listeners) {
          listener(normalized);
        }
      });
    }
  }

  request<T = unknown>(message: HomeTransportRequest): Promise<T> {
    return this.bridge.request<T>({ ...message });
  }

  async subscribe<T = unknown>(
    message: HomeTransportRequest,
    onEvent: (event: T) => void,
  ): Promise<() => void> {
    if (!this.bridge.subscribe) return () => undefined;
    return this.bridge.subscribe<T>({ ...message }, onEvent);
  }

  onEvent(listener: (event: HomeTransportEvent<TEntity>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getSceneConfig(entityId: string, sceneId: string): Promise<Record<string, unknown> | null> {
    if (!this.bridge.getSceneConfig) return null;
    return this.bridge.getSceneConfig(entityId, sceneId);
  }

  dispose(): void {
    this.detachBridge?.();
    this.listeners.clear();
  }
}

export interface StreamingRpcPort<TEntity extends TransportEntityState = TransportEntityState> {
  readonly connected: boolean;
  close(): void;
  request<T>(message: { type: string } & Record<string, unknown>): Promise<T>;
  watchState(callback: (state: ConnectionState) => void): () => void;
  watchEntities(callback: (entities: readonly TEntity[]) => void): () => void;
}

function mapConnectionState(state: ConnectionState): HomeTransportStatus {
  switch (state) {
    case 'connecting':
    case 'connected':
    case 'reconnecting':
    case 'disconnected':
      return state;
    case 'auth-required':
      return 'disconnected';
  }
}

/**
 * Adapts a streaming WebSocket / Mobile RPC port to the platform-neutral `HomeTransport` contract.
 */
export class StreamingSocketTransport<
  TEntity extends TransportEntityState = TransportEntityState,
> implements HomeTransport<TEntity> {
  readonly mode = 'live' as const;
  private readonly listeners = new Set<(event: HomeTransportEvent<TEntity>) => void>();
  private readonly lastStates = new Map<string, TEntity>();
  private readonly stopState: () => void;
  private readonly stopEntities: () => void;

  constructor(private readonly socket: StreamingRpcPort<TEntity>) {
    this.stopState = socket.watchState((state) => {
      this.emit({
        type: 'connection',
        status: mapConnectionState(state),
        ...(state === 'auth-required' ? { error: 'Authentication required.' } : {}),
      });
    });
    this.stopEntities = socket.watchEntities((entities) => {
      for (const entity of entities) {
        const prev = this.lastStates.get(entity.entity_id) ?? null;
        if (prev !== entity) {
          this.lastStates.set(entity.entity_id, entity);
          this.emit({
            type: 'state_changed',
            entityId: entity.entity_id,
            newState: entity,
            oldState: prev,
          });
        }
      }
    });
  }

  request<T = unknown>(message: HomeTransportRequest): Promise<T> {
    return this.socket.request<T>({ ...message });
  }

  async subscribe<T = unknown>(
    _message: HomeTransportRequest,
    _onEvent: (event: T) => void,
  ): Promise<() => void> {
    return () => undefined;
  }

  onEvent(listener: (event: HomeTransportEvent<TEntity>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getSceneConfig(entityId: string, sceneId: string): Promise<Record<string, unknown> | null> {
    return this.request<Record<string, unknown> | null>({
      type: 'haus/scene_config',
      entity_id: entityId,
      scene_id: sceneId,
    }).catch(() => null);
  }

  dispose(): void {
    this.stopState();
    this.stopEntities();
    this.socket.close();
    this.listeners.clear();
    this.lastStates.clear();
  }

  private emit(event: HomeTransportEvent<TEntity>): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export interface HttpHubTransportOptions {
  readonly baseUrl: string;
  readonly getAuthHeader: () => Promise<string | null> | string | null;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Platform-neutral HTTP transport for Mobile (Expo/React Native) and Web clients
 * communicating with a Haus Hub `/api/rpc` endpoint.
 */
export class HttpHubTransport<
  TEntity extends TransportEntityState = TransportEntityState,
> implements HomeTransport<TEntity> {
  readonly mode = 'live' as const;
  private readonly listeners = new Set<(event: HomeTransportEvent<TEntity>) => void>();

  constructor(private readonly options: HttpHubTransportOptions) {}

  async request<T = unknown>(message: HomeTransportRequest): Promise<T> {
    const fetchFn = this.options.fetchImpl ?? globalThis.fetch;
    const auth = await this.options.getAuthHeader();
    const base = this.options.baseUrl.replace(/\/+$/, '');
    const response = await fetchFn(`${base}/api/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: auth } : {}),
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new Error(`Haus Hub transport error (${response.status})`);
    }
    return (await response.json()) as T;
  }

  async subscribe<T = unknown>(
    _message: HomeTransportRequest,
    _onEvent: (event: T) => void,
  ): Promise<() => void> {
    return () => undefined;
  }

  onEvent(listener: (event: HomeTransportEvent<TEntity>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getSceneConfig(entityId: string, sceneId: string): Promise<Record<string, unknown> | null> {
    return this.request<Record<string, unknown> | null>({
      type: 'haus/scene_config',
      entity_id: entityId,
      scene_id: sceneId,
    }).catch(() => null);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

/** Browser/Electron `localStorage` implementation of `DemoModeStorage`. */
export class WebStorageDemoModeStore implements DemoModeStorage {
  constructor(private readonly storageKey = 'haus.demoMode') {}

  read(): boolean {
    try {
      return (
        typeof globalThis.localStorage !== 'undefined' &&
        globalThis.localStorage.getItem(this.storageKey) === '1'
      );
    } catch {
      return false;
    }
  }

  write(enabled: boolean): void {
    try {
      if (typeof globalThis.localStorage === 'undefined') return;
      if (enabled) globalThis.localStorage.setItem(this.storageKey, '1');
      else globalThis.localStorage.removeItem(this.storageKey);
    } catch {
      /* Storage unavailable; in-memory mode remains active. */
    }
  }
}

/** In-memory `DemoModeStorage` for Mobile/SSR/tests without DOM storage. */
export class MemoryDemoModeStore implements DemoModeStorage {
  private enabled: boolean;

  constructor(initial = false) {
    this.enabled = initial;
  }

  read(): boolean {
    return this.enabled;
  }

  write(enabled: boolean): void {
    this.enabled = enabled;
  }
}
