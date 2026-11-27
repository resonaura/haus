/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HomeRuntime, RuntimeError } from '@haus/core/runtime';
import { subscribeWithSelector } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import {
  OPTIMISTIC_TIMEOUT_NOTICE,
  type HomeState,
  type HomeStore,
  type HomeStoreOptions,
  type Projection,
  type SnapshotFreshness,
  type ValueObservation,
} from './types.js';

export {
  OPTIMISTIC_TIMEOUT_NOTICE,
  type HomeState,
  type HomeStore,
  type HomeStoreOptions,
  type Projection,
  type SnapshotFreshness,
  type ValueObservation,
};

function actionError(error: unknown): string {
  return error instanceof RuntimeError ? error.code : 'action-failed';
}

function safeActionFailure(error: unknown): RuntimeError {
  return error instanceof RuntimeError ? error : new RuntimeError('connection-failed');
}

function unrefTimer(timer: unknown): void {
  if (timer && typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }
}

/**
 * One home-scoped source of truth for devices across every OS. Cached entities remain visible
 * offline, while freshness, connectivity, and reversible optimistic overlays stay strictly separate.
 */
export function createHomeStore<S, V, A>(options: HomeStoreOptions<S, V, A>) {
  const now = options.now ?? Date.now;
  const optimistic = options.projection.optimistic;
  let rawSnapshot: S | null = null;
  let expiryTimer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let store: HomeStore<S, V, A>;

  const runExpiry = (at: number): { expired: number; timedOut: number } =>
    optimistic.expireTransactions
      ? optimistic.expireTransactions(at)
      : { expired: optimistic.expire(at), timedOut: 0 };

  const project = () => {
    const snapshot = rawSnapshot ? optimistic.project(rawSnapshot) : null;
    const pendingEntityIds = snapshot ? options.projection.pending(snapshot) : [];
    if (pendingEntityIds.length > 0 && expiryTimer === undefined) {
      expiryTimer = setInterval(() => {
        const { expired, timedOut } = runExpiry(now());
        if (expired > 0) {
          publishProjection(timedOut > 0 ? OPTIMISTIC_TIMEOUT_NOTICE : undefined);
        }
      }, 500);
      unrefTimer(expiryTimer);
    } else if (pendingEntityIds.length === 0 && expiryTimer !== undefined) {
      clearInterval(expiryTimer);
      expiryTimer = undefined;
    }
    return snapshot;
  };

  const publishProjection = (noticeOverride?: string) => {
    const failures = optimistic.takeFailures();
    const nextNotice = noticeOverride ?? failures.at(-1);
    store.setState((state) => {
      const snapshot = project();
      return {
        snapshot,
        entities: snapshot ? options.projection.values(snapshot) : state.entities,
        commandNotice: nextNotice ?? state.commandNotice,
        revision: state.revision + 1,
      };
    });
  };

  const reconcileIncomingValues = (incoming: readonly V[], correlationId?: string): V[] => {
    const at = now();
    const idOf = options.projection.valueId;
    const previousById =
      idOf && rawSnapshot
        ? new Map(options.projection.values(rawSnapshot).map((item) => [idOf(item), item]))
        : undefined;
    const accepted: V[] = [];
    for (const rawValue of incoming) {
      const copied = options.projection.copyValue(rawValue);
      const result = optimistic.reconcile(copied, correlationId, at);
      if (result === false && idOf && previousById) {
        const previous = previousById.get(idOf(copied));
        if (previous) accepted.push(previous);
        continue;
      }
      accepted.push(copied);
    }
    runExpiry(at);
    return accepted;
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
        const nextEntities = reconcileIncomingValues(entities);
        if (rawSnapshot) rawSnapshot = options.projection.withValues(rawSnapshot, nextEntities);
        const failures = optimistic.takeFailures();
        const snapshot = project();
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
      observation(homeId, observation) {
        store.getState().applyObservation(homeId, observation);
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
    {
      subject: options.projection.subject,
      coalesce: options.projection.coalesce,
    },
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
        const states =
          current.entitiesFreshness === 'live'
            ? rawSnapshot
              ? options.projection.values(rawSnapshot)
              : [...current.entities]
            : reconcileIncomingValues(options.projection.values(snapshot));
        rawSnapshot = options.projection.copy(options.projection.withValues(snapshot, states));
        const failures = optimistic.takeFailures();
        const projected = project();
        set((state) => ({
          snapshot: projected,
          entities: projected ? options.projection.values(projected) : [],
          snapshotFreshness: 'live',
          entitiesFreshness: 'live',
          lastLiveAt: new Date(now()).toISOString(),
          commandNotice: failures.at(-1) ?? state.commandNotice,
          revision: state.revision + 1,
        }));
      },
      syncLiveSnapshot(homeId, snapshot) {
        const current = get();
        if (disposed || current.homeId !== homeId || current.connection !== 'connected') return;
        const cleaned = options.projection.copy(snapshot);
        const reconciled = reconcileIncomingValues(options.projection.values(cleaned));
        rawSnapshot = options.projection.withValues(cleaned, reconciled);
        const failures = optimistic.takeFailures();
        const projected = project();
        set((state) => ({
          snapshot: projected,
          entities: projected ? options.projection.values(projected) : reconciled,
          snapshotFreshness: 'live',
          entitiesFreshness: 'live',
          lastLiveAt: new Date(now()).toISOString(),
          commandNotice: failures.at(-1) ?? state.commandNotice,
          revision: state.revision + 1,
        }));
      },
      applyObservation(homeId, observation) {
        const current = get();
        const idOf = options.projection.valueId;
        if (disposed || current.homeId !== homeId || current.connection !== 'connected' || !idOf)
          return;
        const at = now();
        if (observation.value !== null) {
          const copied = options.projection.copyValue(observation.value);
          if (optimistic.reconcile(copied, observation.correlationId, at) === false) return;
          runExpiry(at);
          if (rawSnapshot) {
            const existing = options.projection.values(rawSnapshot);
            const idx = existing.findIndex((item) => idOf(item) === observation.entityId);
            const nextValues =
              idx >= 0
                ? existing.map((item, i) => (i === idx ? copied : item))
                : [...existing, copied];
            rawSnapshot = options.projection.withValues(rawSnapshot, nextValues);
          }
          const failures = optimistic.takeFailures();
          const projected = project();
          set((state) => {
            const base = state.entities;
            const idx = base.findIndex((item) => idOf(item) === observation.entityId);
            const fallback =
              idx >= 0 ? base.map((item, i) => (i === idx ? copied : item)) : [...base, copied];
            return {
              snapshot: projected,
              snapshotFreshness: rawSnapshot ? 'live' : state.snapshotFreshness,
              entities: projected ? options.projection.values(projected) : fallback,
              entitiesFreshness: 'live',
              lastLiveAt: new Date(at).toISOString(),
              commandNotice: failures.at(-1) ?? state.commandNotice,
              revision: state.revision + 1,
            };
          });
          return;
        }
        if (rawSnapshot) {
          const filtered = options.projection
            .values(rawSnapshot)
            .filter((item) => idOf(item) !== observation.entityId);
          rawSnapshot = options.projection.withValues(rawSnapshot, filtered);
        }
        const projected = project();
        set((state) => ({
          snapshot: projected,
          entities: projected
            ? options.projection.values(projected)
            : state.entities.filter((item) => idOf(item) !== observation.entityId),
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
        return get().executeBatch([action]);
      },
      callService(action) {
        return get().executeBatch([action]);
      },
      async executeBatch(actions) {
        if (disposed) throw new RuntimeError('session-changed');
        const { homeId, connection } = get();
        if (!homeId || connection !== 'connected') throw new RuntimeError('offline');
        if (actions.length === 0) return;

        const startedAt = now();
        const entries = actions.map((action) => ({
          action,
          subject: options.projection.subject(action),
          transactionId:
            rawSnapshot && !options.projection.isStateless?.(action)
              ? optimistic.begin(rawSnapshot, action, startedAt)
              : undefined,
        }));
        if (entries.some((entry) => entry.transactionId !== undefined)) {
          publishProjection();
        }

        let firstFailure: RuntimeError | undefined;
        await Promise.all(
          entries.map(async ({ action, subject, transactionId }) => {
            try {
              const response = await client.execute(action);
              if (transactionId !== undefined && rawSnapshot) {
                optimistic.acknowledge(transactionId, response.correlationId, rawSnapshot, now());
                publishProjection();
              }
              set((state) => {
                if (!(subject in state.commandErrors)) return state;
                const commandErrors = { ...state.commandErrors };
                delete commandErrors[subject];
                return { commandErrors, revision: state.revision + 1 };
              });
            } catch (error) {
              if (transactionId !== undefined) optimistic.reject(transactionId, now());
              const message = actionError(error);
              if (get().homeId === homeId && !disposed) {
                const snapshot = project();
                const failures = optimistic.takeFailures();
                set((state) => ({
                  snapshot,
                  entities: snapshot ? options.projection.values(snapshot) : state.entities,
                  commandErrors: {
                    ...state.commandErrors,
                    [subject]: message,
                  },
                  commandNotice: failures.at(-1) ?? state.commandNotice,
                  revision: state.revision + 1,
                }));
              }
              firstFailure ??= safeActionFailure(error);
            }
          }),
        );
        if (firstFailure) throw firstFailure;
      },
      clearCommandError(entityId) {
        set((state) => {
          if (!(entityId in state.commandErrors)) return state;
          const commandErrors = { ...state.commandErrors };
          delete commandErrors[entityId];
          return { commandErrors, revision: state.revision + 1 };
        });
      },
      clearCommandNotice() {
        set((state) =>
          state.commandNotice === null
            ? state
            : { commandNotice: null, revision: state.revision + 1 },
        );
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
