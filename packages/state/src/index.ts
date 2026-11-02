/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HomeAssistantClient, HaClientError } from '@haus/core/ha-client';
import { OptimisticState } from '@haus/core/optimistic';
import type { HaConnectionState, HaTransport } from '@haus/core/ha-client';
import type { HassEntity, HausAction, Snapshot } from '@haus/core/types';
import { subscribeWithSelector } from 'zustand/middleware';
import { createStore, type StoreApi } from 'zustand/vanilla';

export type SnapshotFreshness = 'none' | 'cached' | 'live';
export interface HausHomeState {
  homeId: string | null;
  connection: HaConnectionState;
  snapshot: Snapshot | null;
  snapshotFreshness: SnapshotFreshness;
  entities: readonly HassEntity[];
  entitiesFreshness: SnapshotFreshness;
  lastLiveAt: string | null;
  revision: number;
  commandErrors: Readonly<Record<string, string>>;
  commandNotice: string | null;
  hydrateSnapshot(homeId: string, snapshot: Snapshot): void;
  connectHome(homeId: string, cachedSnapshot?: Snapshot): Promise<void>;
  disconnect(): void;
  callService(action: HausAction): Promise<void>;
  clearCommandError(entityId: string): void;
  dispose(): void;
}

export interface HausHomeStoreOptions {
  openTransport(homeId: string): Promise<HaTransport>;
  now?(): number;
}

interface SelectorSubscribe<T> {
  (listener: (state: T, previous: T) => void): () => void;
  <Value>(
    selector: (state: T) => Value,
    listener: (value: Value, previous: Value) => void,
    options?: { equalityFn?: (left: Value, right: Value) => boolean; fireImmediately?: boolean },
  ): () => void;
}

export type HausHomeStore = Omit<StoreApi<HausHomeState>, 'subscribe'> & {
  subscribe: SelectorSubscribe<HausHomeState>;
};

function copySnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    states: snapshot.states.map((entity) => ({ ...entity, attributes: { ...entity.attributes } })),
    areas: snapshot.areas.map((area) => ({ ...area })),
    devices: snapshot.devices.map((device) => ({ ...device })),
    entities: snapshot.entities.map((entity) => ({ ...entity })),
    services: { ...snapshot.services },
    config: { ...snapshot.config },
    user: { ...snapshot.user },
  };
}

function contextIdFrom(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const context = (value as Record<string, unknown>).context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) return;
  const id = (context as Record<string, unknown>).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function actionError(error: unknown): string {
  return error instanceof HaClientError ? error.code : 'action-failed';
}

function safeActionFailure(error: unknown): HaClientError {
  return error instanceof HaClientError ? error : new HaClientError('connection-failed');
}

/**
 * One home-scoped source of truth for devices. Cached entities remain visible offline,
 * while freshness and connectivity stay separate so cached state is never shown as live.
 */
export function createHausHomeStore(options: HausHomeStoreOptions) {
  const now = options.now ?? Date.now;
  const optimistic = new OptimisticState();
  let rawSnapshot: Snapshot | null = null;
  let expiryTimer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let store: HausHomeStore;

  const project = () => {
    const snapshot = rawSnapshot ? optimistic.project(rawSnapshot) : null;
    const pendingEntityIds = snapshot?.pendingEntityIds ?? [];
    if (pendingEntityIds.length > 0 && expiryTimer === undefined) {
      expiryTimer = setInterval(() => {
        if (optimistic.expire(now()) > 0) publishProjection();
      }, 1000);
    } else if (pendingEntityIds.length === 0 && expiryTimer !== undefined) {
      clearInterval(expiryTimer);
      expiryTimer = undefined;
    }
    return snapshot;
  };

  const publishProjection = () => {
    store.setState((state) => {
      const snapshot = project();
      return {
        snapshot,
        entities: snapshot?.states ?? state.entities,
        revision: state.revision + 1,
      };
    });
  };

  const client = new HomeAssistantClient(options.openTransport, {
    state(homeId, connection) {
      if (store.getState().homeId !== homeId) return;
      if (connection !== 'connected') optimistic.clear();
      const snapshot = connection === 'connected' ? undefined : project();
      store.setState((state) => ({
        connection,
        snapshot: connection === 'connected' ? state.snapshot : snapshot,
        entities: snapshot?.states ?? state.entities,
        snapshotFreshness:
          connection === 'connected' ? state.snapshotFreshness : snapshot ? 'cached' : 'none',
        entitiesFreshness:
          connection === 'connected'
            ? state.entitiesFreshness
            : state.entities.length
              ? 'cached'
              : 'none',
        revision: state.revision + 1,
      }));
    },
    entities(homeId, entities) {
      const state = store.getState();
      if (state.homeId !== homeId || state.connection !== 'connected') return;
      const nextEntities = entities.map((entity) => ({
        ...entity,
        attributes: { ...entity.attributes },
      }));
      if (rawSnapshot) rawSnapshot = { ...rawSnapshot, states: nextEntities };
      for (const entity of nextEntities) optimistic.reconcile(entity, undefined, now());
      optimistic.expire(now());
      const failures = optimistic.takeFailures();
      const snapshot = rawSnapshot ? optimistic.project(rawSnapshot) : null;
      store.setState((current) => ({
        snapshot,
        snapshotFreshness: rawSnapshot ? 'live' : current.snapshotFreshness,
        entities: snapshot?.states ?? nextEntities,
        entitiesFreshness: 'live',
        lastLiveAt: new Date(now()).toISOString(),
        revision: current.revision + 1,
        commandNotice: failures.at(-1) ?? current.commandNotice,
      }));
    },
    authRequired(homeId) {
      if (store.getState().homeId !== homeId) return;
      store.setState((state) => ({
        connection: 'auth-required',
        snapshotFreshness: state.snapshot ? 'cached' : 'none',
        entitiesFreshness: state.entities.length ? 'cached' : 'none',
        revision: state.revision + 1,
      }));
    },
  });

  store = createStore<HausHomeState>()(
    subscribeWithSelector((set, get) => ({
      homeId: null,
      connection: 'disconnected',
      snapshot: null,
      snapshotFreshness: 'none',
      entities: [],
      entitiesFreshness: 'none',
      lastLiveAt: null,
      revision: 0,
      commandErrors: {},
      commandNotice: null,
      hydrateSnapshot(homeId, snapshot) {
        if (disposed) return;
        if (get().homeId !== homeId) {
          client.disconnect();
          optimistic.clear();
          rawSnapshot = null;
        }
        rawSnapshot = copySnapshot(snapshot);
        set((state) => ({
          homeId,
          connection: state.homeId === homeId ? state.connection : 'disconnected',
          snapshot: project(),
          snapshotFreshness: 'cached',
          entities: rawSnapshot?.states ?? [],
          entitiesFreshness: 'cached',
          lastLiveAt: state.homeId === homeId ? state.lastLiveAt : null,
          revision: state.revision + 1,
          commandErrors: state.homeId === homeId ? state.commandErrors : {},
          commandNotice: state.homeId === homeId ? state.commandNotice : null,
        }));
      },
      async connectHome(homeId, cachedSnapshot) {
        if (disposed) throw new HaClientError('session-changed');
        if (get().homeId !== homeId) {
          client.disconnect();
          optimistic.clear();
          rawSnapshot = null;
        }
        if (cachedSnapshot) rawSnapshot = copySnapshot(cachedSnapshot);
        set((state) => ({
          homeId,
          connection: 'connecting',
          snapshot: project(),
          snapshotFreshness: rawSnapshot ? 'cached' : 'none',
          entities: rawSnapshot?.states ?? (state.homeId === homeId ? state.entities : []),
          entitiesFreshness:
            rawSnapshot || (state.homeId === homeId && state.entities.length) ? 'cached' : 'none',
          lastLiveAt: state.homeId === homeId ? state.lastLiveAt : null,
          revision: state.revision + 1,
          commandErrors: state.homeId === homeId ? state.commandErrors : {},
          commandNotice: state.homeId === homeId ? state.commandNotice : null,
        }));
        try {
          await client.connect(homeId);
        } catch (error) {
          if (get().homeId === homeId && !disposed) {
            set((state) => ({
              connection:
                error instanceof HaClientError && error.code === 'auth-required'
                  ? 'auth-required'
                  : 'disconnected',
              snapshotFreshness: rawSnapshot ? 'cached' : 'none',
              entitiesFreshness: get().entities.length ? 'cached' : 'none',
              revision: state.revision + 1,
            }));
          }
          throw error;
        }
      },
      disconnect() {
        if (disposed) return;
        client.disconnect();
        set((state) => ({
          connection: 'disconnected',
          snapshotFreshness: rawSnapshot ? 'cached' : 'none',
          entitiesFreshness: get().entities.length ? 'cached' : 'none',
          snapshot: project(),
          revision: state.revision + 1,
        }));
      },
      async callService(action) {
        if (disposed) throw new HaClientError('session-changed');
        const { homeId, connection } = get();
        if (!homeId || connection !== 'connected') throw new HaClientError('offline');
        const transactionId = rawSnapshot
          ? optimistic.begin(rawSnapshot, action, now())
          : undefined;
        if (transactionId !== undefined) publishProjection();
        try {
          const response = await client.callService(action);
          if (transactionId !== undefined && rawSnapshot) {
            optimistic.acknowledge(transactionId, contextIdFrom(response), rawSnapshot, now());
            publishProjection();
          }
          set((state) => {
            const commandErrors = { ...state.commandErrors };
            delete commandErrors[action.target.entity_id];
            return { commandErrors, revision: state.revision + 1 };
          });
        } catch (error) {
          if (transactionId !== undefined) optimistic.reject(transactionId, now());
          const message = actionError(error);
          if (get().homeId === homeId && !disposed) {
            const snapshot = project();
            set((state) => ({
              snapshot,
              entities: snapshot?.states ?? state.entities,
              commandErrors: { ...state.commandErrors, [action.target.entity_id]: message },
              revision: state.revision + 1,
            }));
          }
          throw safeActionFailure(error);
        }
      },
      clearCommandError(entityId) {
        set((state) => {
          if (!(entityId in state.commandErrors)) return state;
          const commandErrors = { ...state.commandErrors };
          delete commandErrors[entityId];
          return { commandErrors, revision: state.revision + 1 };
        });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        client.disconnect();
        optimistic.clear();
        if (expiryTimer !== undefined) clearInterval(expiryTimer);
        expiryTimer = undefined;
        rawSnapshot = null;
        set((state) => ({
          homeId: null,
          connection: 'disconnected',
          snapshot: null,
          snapshotFreshness: 'none',
          entities: [],
          entitiesFreshness: 'none',
          lastLiveAt: null,
          commandErrors: {},
          commandNotice: null,
          revision: state.revision + 1,
        }));
      },
    })),
  );

  return store;
}
