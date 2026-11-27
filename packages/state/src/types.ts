/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { OPTIMISTIC_TIMEOUT_NOTICE } from '@haus/core/optimistic';
import type { ConnectionState, RuntimeTransport, ValueObservation } from '@haus/core/runtime';
import type { StoreApi } from 'zustand/vanilla';

export { OPTIMISTIC_TIMEOUT_NOTICE, type ValueObservation };

export interface Projection<S, V, A> {
  copy(snapshot: S): S;
  copyValue(value: V): V;
  valueId?(value: V): string;
  values(snapshot: S): readonly V[];
  withValues(snapshot: S, values: readonly V[]): S;
  pending(snapshot: S): readonly string[];
  subject(action: A): string;
  coalesce?(pending: A, incoming: A): A | undefined;
  isStateless?(action: A): boolean;
  optimistic: {
    project(snapshot: S): S;
    clear(): void;
    begin(snapshot: S, action: A, at: number): number | undefined;
    acknowledge(id: number, correlation: string | undefined, snapshot: S, at: number): void;
    reject(id: number, at: number): void;
    reconcile(value: V, correlation: string | undefined, at: number): boolean | unknown;
    expire(at: number): number;
    expireTransactions?(at: number): { readonly expired: number; readonly timedOut: number };
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
  syncLiveSnapshot(homeId: string, snapshot: S): void;
  applyObservation(homeId: string, observation: ValueObservation<V>): void;
  confirmedSnapshot(): S | null;
  connectHome(homeId: string, cachedSnapshot?: S): Promise<void>;
  disconnect(): void;
  execute(action: A): Promise<void>;
  executeBatch(actions: readonly A[]): Promise<void>;
  callService(action: A): Promise<void>;
  clearCommandError(entityId: string): void;
  clearCommandNotice(): void;
  dispose(): void;
}

export interface HomeStoreOptions<S, V, A> {
  projection: Projection<S, V, A>;
  openTransport(homeId: string): Promise<RuntimeTransport<V, A>>;
  now?(): number;
}

export interface SelectorSubscribe<T> {
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
