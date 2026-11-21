/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface EntityActionQueueOptions {
  readonly maxDepthPerEntity?: number;
}

interface PendingCoalescedSlot {
  payload: unknown;
  readonly waiters: Array<{
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>;
}

/** Preserve click order for one device while allowing different devices to update together. */
export class EntityActionQueue {
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly depths = new Map<string, number>();
  private readonly coalescedTail = new Map<string, PendingCoalescedSlot>();
  private readonly maxDepthPerEntity: number;

  constructor(options: EntityActionQueueOptions = {}) {
    this.maxDepthPerEntity = options.maxDepthPerEntity ?? 64;
    if (!Number.isInteger(this.maxDepthPerEntity) || this.maxDepthPerEntity <= 0) {
      throw new Error('invalid_entity_queue_limit');
    }
  }

  getDepth(entityId: string): number {
    return this.depths.get(entityId) ?? 0;
  }

  run<T>(entityId: string, operation: () => Promise<T>): Promise<T> {
    // Non-coalesced operations act as strict FIFO barriers.
    this.coalescedTail.delete(entityId);
    return this.enqueue(entityId, operation);
  }

  /**
   * Enqueues an operation whose waiting (not-yet-started) tail entry can be merged with a newer
   * idempotent update for the same entity (e.g. rapid light brightness/color slider drags).
   * Calls whose `merge` returns `undefined` preserve strict FIFO ordering as a barrier.
   */
  runCoalesced<TPayload, TResult>(
    entityId: string,
    payload: TPayload,
    merge: (pending: TPayload, incoming: TPayload) => TPayload | undefined,
    execute: (finalPayload: TPayload) => Promise<TResult>,
  ): Promise<TResult> {
    const existing = this.coalescedTail.get(entityId);
    if (existing) {
      const merged = merge(existing.payload as TPayload, payload);
      if (merged !== undefined) {
        existing.payload = merged;
        return new Promise<TResult>((resolve, reject) => {
          existing.waiters.push({
            resolve: resolve as (value: unknown) => void,
            reject,
          });
        });
      }
      this.coalescedTail.delete(entityId);
    }

    if ((this.depths.get(entityId) ?? 0) >= this.maxDepthPerEntity) {
      return Promise.reject(new Error('entity_action_queue_overflow'));
    }

    const slot: PendingCoalescedSlot = { payload, waiters: [] };
    if (this.pending.has(entityId)) {
      this.coalescedTail.set(entityId, slot);
    }

    return this.enqueue(entityId, async () => {
      if (this.coalescedTail.get(entityId) === slot) {
        this.coalescedTail.delete(entityId);
      }
      try {
        const result = await execute(slot.payload as TPayload);
        for (const waiter of slot.waiters) waiter.resolve(result);
        return result;
      } catch (err) {
        for (const waiter of slot.waiters) waiter.reject(err);
        throw err;
      }
    });
  }

  private enqueue<T>(entityId: string, operation: () => Promise<T>): Promise<T> {
    const currentDepth = this.depths.get(entityId) ?? 0;
    if (currentDepth >= this.maxDepthPerEntity) {
      return Promise.reject(new Error('entity_action_queue_overflow'));
    }
    this.depths.set(entityId, currentDepth + 1);

    const result = (this.pending.get(entityId) ?? Promise.resolve())
      .catch(() => {})
      .then(operation);
    this.pending.set(entityId, result);
    void result
      .finally(() => {
        const nextDepth = (this.depths.get(entityId) ?? 1) - 1;
        if (nextDepth <= 0) {
          this.depths.delete(entityId);
        } else {
          this.depths.set(entityId, nextDepth);
        }
        if (this.pending.get(entityId) === result) this.pending.delete(entityId);
      })
      .catch(() => {});
    return result;
  }
}
