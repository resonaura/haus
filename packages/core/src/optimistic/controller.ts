/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { EntityActionQueue } from '../command-queue.js';
import { dispatchQueuedHausAction, extractContextId, isStatelessAction } from './coalesce.js';
import { OptimisticState } from './state.js';
import {
  OPTIMISTIC_TIMEOUT_NOTICE,
  type EntityAction,
  type EntitySnapshot,
  type EntityState,
} from './types.js';

function unrefTimer(timer: unknown): void {
  if (timer && typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }
}

export interface ExecuteQueuedActionParams<
  S extends EntitySnapshot = EntitySnapshot,
  A extends EntityAction = EntityAction,
> {
  readonly action: A;
  readonly queue: EntityActionQueue;
  readonly optimistic: OptimisticState;
  readonly getSnapshot: () => S;
  readonly getGeneration: () => number;
  readonly invalidate: () => void;
  readonly reportFailures: () => void;
  readonly send: (active: A) => Promise<unknown>;
  readonly now?: () => number;
}

/**
 * Shared single-action execution primitive used by desktop/mobile composition roots.
 * Begins an optimistic transaction immediately, dispatches coalesced/FIFO over the queue,
 * correlates acknowledgements, and rolls back cleanly on failure without replaying on session changes.
 */
export async function executeQueuedHausAction<
  S extends EntitySnapshot = EntitySnapshot,
  A extends EntityAction = EntityAction,
>(params: ExecuteQueuedActionParams<S, A>): Promise<void> {
  const {
    action,
    queue,
    optimistic,
    getSnapshot,
    getGeneration,
    invalidate,
    reportFailures,
    send,
    now = Date.now,
  } = params;
  const generation = getGeneration();
  const run = (active: A) => {
    if (generation !== getGeneration()) {
      throw new Error('The home connection changed before this command could be sent.');
    }
    return send(active);
  };
  if (isStatelessAction(action)) {
    await dispatchQueuedHausAction(queue, action, run);
    return;
  }
  const transaction = optimistic.begin(getSnapshot(), action, now());
  invalidate();
  try {
    const result = await dispatchQueuedHausAction(queue, action, run);
    if (generation !== getGeneration()) return;
    optimistic.acknowledge(transaction, extractContextId(result), getSnapshot(), now());
    reportFailures();
    invalidate();
  } catch (error) {
    if (generation === getGeneration()) {
      optimistic.reject(transaction, now());
      reportFailures();
      invalidate();
    }
    throw error;
  }
}

export interface OptimisticSessionControllerOptions<
  S extends EntitySnapshot = EntitySnapshot,
  A extends EntityAction = EntityAction,
> {
  readonly getServerSnapshot: () => S | null;
  readonly onInvalidate: () => void;
  readonly onNotice?: (message: string) => void;
  readonly send: (action: A) => Promise<unknown>;
  readonly now?: () => number;
  readonly expiryIntervalMs?: number;
}

/**
 * Platform-neutral session controller pairing OptimisticState, EntityActionQueue,
 * generation fencing, atomic group batches, light memory, and bounded expiry timers.
 */
export class OptimisticSessionController<
  S extends EntitySnapshot = EntitySnapshot,
  A extends EntityAction = EntityAction,
> {
  readonly optimistic = new OptimisticState();
  readonly queue = new EntityActionQueue();
  private generation = 0;
  private expiryTimer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private readonly expiryIntervalMs: number;

  constructor(private readonly options: OptimisticSessionControllerOptions<S, A>) {
    this.now = options.now ?? Date.now;
    this.expiryIntervalMs = options.expiryIntervalMs ?? 500;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  project(serverSnapshot: S | null): S | null {
    if (!serverSnapshot) {
      this.syncExpiryTimer();
      return null;
    }
    const projected = this.optimistic.project(serverSnapshot);
    this.syncExpiryTimer();
    return projected;
  }

  /** Reconciles an incremental entity delta; returns false when suppressed as a stale local echo. */
  reconcileEntity(entity: EntityState, contextId?: string): boolean {
    const accepted = this.optimistic.reconcile(entity, contextId, this.now());
    this.drainFailures();
    this.syncExpiryTimer();
    return accepted;
  }

  /** Reconciles a full authoritative snapshot while preserving unconfirmed optimistic overlays. */
  reconcileSnapshot(previous: S | null, incoming: S): S {
    const at = this.now();
    const prevById = previous
      ? new Map(previous.states.map((entity) => [entity.entity_id, entity]))
      : undefined;
    const states = incoming.states.map((entity) => {
      const accepted = this.optimistic.reconcile(entity, undefined, at);
      if (!accepted && prevById) {
        return prevById.get(entity.entity_id) ?? entity;
      }
      return entity;
    });
    this.optimistic.expireTransactions(at);
    this.drainFailures();
    this.syncExpiryTimer();
    const cleaned: S = { ...incoming, states };
    delete cleaned.pendingEntityIds;
    delete cleaned.pendingSince;
    return cleaned;
  }

  /**
   * Atomically projects all actions in a batch on frame 0, then dispatches them sequentially
   * with per-entity/per-scene queueing so a lost acknowledgement stops remaining group actions
   * instead of firing blind physical commands over a broken connection.
   */
  async executeBatch(
    actions: readonly A[],
    batchOptions?: { readonly stopOnError?: boolean },
  ): Promise<void> {
    if (actions.length === 0) return;
    const snapshot = this.options.getServerSnapshot();
    if (!snapshot) return;
    const stopOnError = batchOptions?.stopOnError ?? actions.length > 1;
    const generation = this.generation;
    const startedAt = this.now();
    const entries = actions.map((action) => ({
      action,
      transaction: isStatelessAction(action)
        ? undefined
        : this.optimistic.begin(snapshot, action, startedAt),
    }));
    if (entries.some((item) => item.transaction !== undefined)) {
      this.syncExpiryTimer();
      this.options.onInvalidate();
    }

    const runEntry = async ({
      action,
      transaction,
    }: {
      action: A;
      transaction: number | undefined;
    }): Promise<void> => {
      const run = (active: A) => {
        if (generation !== this.generation) {
          throw new Error('The home connection changed before this command could be sent.');
        }
        return this.options.send(active);
      };
      try {
        const response = await dispatchQueuedHausAction(this.queue, action, run);
        if (generation !== this.generation) return;
        const latest = this.options.getServerSnapshot();
        if (transaction !== undefined && latest) {
          this.optimistic.acknowledge(transaction, extractContextId(response), latest, this.now());
          this.drainFailures();
          this.syncExpiryTimer();
          this.options.onInvalidate();
        }
      } catch (error) {
        if (generation === this.generation && transaction !== undefined) {
          this.optimistic.reject(transaction, this.now());
          this.drainFailures();
          this.syncExpiryTimer();
          this.options.onInvalidate();
        }
        throw error;
      }
    };

    if (stopOnError) {
      for (let i = 0; i < entries.length; i++) {
        try {
          await runEntry(entries[i]!);
        } catch (error) {
          if (generation === this.generation) {
            for (let rest = i + 1; rest < entries.length; rest++) {
              const tx = entries[rest]?.transaction;
              if (tx !== undefined) this.optimistic.reject(tx, this.now());
            }
            this.drainFailures();
            this.syncExpiryTimer();
            this.options.onInvalidate();
          }
          throw error;
        }
      }
      return;
    }

    let firstError: unknown;
    await Promise.all(
      entries.map(async (entry) => {
        try {
          await runEntry(entry);
        } catch (error) {
          firstError ??= error;
        }
      }),
    );
    if (firstError !== undefined) throw firstError;
  }

  reset(): void {
    ++this.generation;
    this.optimistic.clear();
    this.stopExpiryTimer();
  }

  dispose(): void {
    this.reset();
  }

  private drainFailures(): void {
    const failures = this.optimistic.takeFailures();
    if (failures.length > 0 && this.options.onNotice) {
      for (const failure of failures) this.options.onNotice(failure);
    }
  }

  private syncExpiryTimer(): void {
    if (this.optimistic.size > 0 && !this.expiryTimer) {
      this.expiryTimer = setInterval(() => {
        const { expired, timedOut } = this.optimistic.expireTransactions(this.now());
        if (expired <= 0) {
          this.syncExpiryTimer();
          return;
        }
        this.drainFailures();
        if (timedOut > 0) this.options.onNotice?.(OPTIMISTIC_TIMEOUT_NOTICE);
        this.syncExpiryTimer();
        this.options.onInvalidate();
      }, this.expiryIntervalMs);
      unrefTimer(this.expiryTimer);
    } else if (this.optimistic.size === 0 && this.expiryTimer) {
      this.stopExpiryTimer();
    }
  }

  private stopExpiryTimer(): void {
    if (!this.expiryTimer) return;
    clearInterval(this.expiryTimer);
    this.expiryTimer = undefined;
  }
}
