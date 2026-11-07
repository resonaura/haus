/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface EntityActionQueueOptions {
  readonly maxDepthPerEntity?: number;
}

/** Preserve click order for one device while allowing different devices to update together. */
export class EntityActionQueue {
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly depths = new Map<string, number>();
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
