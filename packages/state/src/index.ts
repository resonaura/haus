/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  HomeRuntime,
  RuntimeError,
  type ConnectionState,
  type RuntimeTransport,
} from '@haus/core/runtime';
import { subscribeWithSelector } from 'zustand/middleware';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface Projection<S, V, A> {
  copy(snapshot: S): S;
  copyValue(value: V): V;
  values(snapshot: S): readonly V[];
  withValues(snapshot: S, values: readonly V[]): S;
  pending(snapshot: S): readonly string[];
  subject(action: A): string;
  optimistic: {
    project(snapshot: S): S;
    clear(): void;
    begin(snapshot: S, action: A, at: number): number | undefined;
    acknowledge(id: number, correlation: string | undefined, snapshot: S, at: number): void;
    reject(id: number, at: number): void;
    reconcile(value: V, correlation: undefined, at: number): unknown;
    expire(at: number): number;
    takeFailures(): string[];
  };
}

export type SnapshotFreshness = 'none' | 'cached' | 'live';
export interface HomeState<S, V, A> {
  homeId: string | null;
  connection: ConnectionState;
  snapshot: S | null;
  snapshotFreshness: SnapshotFreshness;
  entities: readonly V[];
  entitiesFreshness: SnapshotFreshness;
  lastLiveAt: string | null;
  revision: number;
  commandErrors: Readonly<Record<string, string>>;
  commandNotice: string | null;
  hydrateSnapshot(homeId: string, snapshot: S): void;
  hydrateLiveSnapshot(homeId: string, snapshot: S): void;
  confirmedSnapshot(): S | null;
  connectHome(homeId: string, cachedSnapshot?: S): Promise<void>;
  disconnect(): void;
  execute(action: A): Promise<void>;
  callService(action: A): Promise<void>;
  clearCommandError(entityId: string): void;
  dispose(): void;
}

export interface HomeStoreOptions<S, V, A> {
  projection: Projection<S, V, A>;
  openTransport(homeId: string): Promise<RuntimeTransport<V, A>>;
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

export type HomeStore<S, V, A> = Omit<StoreApi<HomeState<S, V, A>>, 'subscribe'> & {
  subscribe: SelectorSubscribe<HomeState<S, V, A>>;
};

function actionError(error: unknown): string {
  return error instanceof RuntimeError ? error.code : 'action-failed';
}

function safeActionFailure(error: unknown): RuntimeError {
  return error instanceof RuntimeError ? error : new RuntimeError('connection-failed');
}

/**
 * One home-scoped source of truth for devices. Cached entities remain visible offline,
 * while freshness and connectivity stay separate so cached state is never shown as live.
 */
export function createHomeStore<S, V, A>(options: HomeStoreOptions<S, V, A>) {
  const now = options.now ?? Date.now;
  const optimistic = options.projection.optimistic;
  let rawSnapshot: S | null = null;
  let expiryTimer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let store: HomeStore<S, V, A>;

  const project = () => {
    const snapshot = rawSnapshot ? optimistic.project(rawSnapshot) : null;
    const pendingEntityIds = snapshot ? options.projection.pending(snapshot) : [];
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
        entities: snapshot ? options.projection.values(snapshot) : state.entities,
        revision: state.revision + 1,
      };
    });
  };

  const client = new HomeRuntime(
    options.openTransport,
    {
      state(homeId, connection) {
        if (store.getState().homeId !== homeId) return;
        if (connection !== 'connected') optimistic.clear();
        const snapshot = connection === 'connected' ? undefined : project();
        store.setState((state) => ({
          connection,
          snapshot: connection === 'connected' ? state.snapshot : snapshot,
          entities: snapshot ? options.projection.values(snapshot) : state.entities,
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
      values(homeId, entities) {
        const state = store.getState();
        if (state.homeId !== homeId || state.connection !== 'connected') return;
        const nextEntities = entities.map(options.projection.copyValue);
        if (rawSnapshot) rawSnapshot = options.projection.withValues(rawSnapshot, nextEntities);
        for (const entity of nextEntities) optimistic.reconcile(entity, undefined, now());
        optimistic.expire(now());
        const failures = optimistic.takeFailures();
        const snapshot = rawSnapshot ? optimistic.project(rawSnapshot) : null;
        store.setState((current) => ({
          snapshot,
          snapshotFreshness: rawSnapshot ? 'live' : current.snapshotFreshness,
          entities: snapshot ? options.projection.values(snapshot) : nextEntities,
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
    },
    options.projection.subject,
  );

  store = createStore<HomeState<S, V, A>>()(
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
        rawSnapshot = options.projection.copy(snapshot);
        set((state) => ({
          homeId,
          connection: state.homeId === homeId ? state.connection : 'disconnected',
          snapshot: project(),
          snapshotFreshness: 'cached',
          entities: rawSnapshot ? options.projection.values(rawSnapshot) : [],
          entitiesFreshness: 'cached',
          lastLiveAt: state.homeId === homeId ? state.lastLiveAt : null,
          revision: state.revision + 1,
          commandErrors: state.homeId === homeId ? state.commandErrors : {},
          commandNotice: state.homeId === homeId ? state.commandNotice : null,
        }));
      },
      hydrateLiveSnapshot(homeId, snapshot) {
        const current = get();
        if (disposed || current.homeId !== homeId || current.connection !== 'connected') return;
        // Registry/bootstrap replies can finish after newer entity subscriptions.
        // Preserve the raw live facts, never the optimistic projection shown by the UI.
        const states =
          current.entitiesFreshness === 'live'
            ? rawSnapshot
              ? options.projection.values(rawSnapshot)
              : [...current.entities]
            : options.projection.values(snapshot);
        rawSnapshot = options.projection.copy(options.projection.withValues(snapshot, states));
        const projected = project();
        set((state) => ({
          snapshot: projected,
          entities: projected ? options.projection.values(projected) : [],
          snapshotFreshness: 'live',
          entitiesFreshness: 'live',
          lastLiveAt: new Date(now()).toISOString(),
          revision: state.revision + 1,
        }));
      },
      confirmedSnapshot() {
        return !disposed && rawSnapshot ? options.projection.copy(rawSnapshot) : null;
      },
      async connectHome(homeId, cachedSnapshot) {
        if (disposed) throw new RuntimeError('session-changed');
        if (get().homeId !== homeId) {
          client.disconnect();
          optimistic.clear();
          rawSnapshot = null;
        }
        if (cachedSnapshot) rawSnapshot = options.projection.copy(cachedSnapshot);
        set((state) => ({
          homeId,
          connection: 'connecting',
          snapshot: project(),
          snapshotFreshness: rawSnapshot ? 'cached' : 'none',
          entities: rawSnapshot
            ? options.projection.values(rawSnapshot)
            : state.homeId === homeId
              ? state.entities
              : [],
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
                error instanceof RuntimeError && error.code === 'auth-required'
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
      execute(action) {
        return get().callService(action);
      },
      async callService(action) {
        if (disposed) throw new RuntimeError('session-changed');
        const { homeId, connection } = get();
        if (!homeId || connection !== 'connected') throw new RuntimeError('offline');
        const transactionId = rawSnapshot
          ? optimistic.begin(rawSnapshot, action, now())
          : undefined;
        if (transactionId !== undefined) publishProjection();
        try {
          const response = await client.execute(action);
          if (transactionId !== undefined && rawSnapshot) {
            optimistic.acknowledge(transactionId, response.correlationId, rawSnapshot, now());
            publishProjection();
          }
          set((state) => {
            const commandErrors = { ...state.commandErrors };
            delete commandErrors[options.projection.subject(action)];
            return { commandErrors, revision: state.revision + 1 };
          });
        } catch (error) {
          if (transactionId !== undefined) optimistic.reject(transactionId, now());
          const message = actionError(error);
          if (get().homeId === homeId && !disposed) {
            const snapshot = project();
            set((state) => ({
              snapshot,
              entities: snapshot ? options.projection.values(snapshot) : state.entities,
              commandErrors: {
                ...state.commandErrors,
                [options.projection.subject(action)]: message,
              },
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
