/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Preserve click order for one device while allowing different devices to update together. */
export class EntityActionQueue {
  private pending = new Map<string, Promise<unknown>>();
  run<T>(entityId: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.pending.get(entityId) ?? Promise.resolve())
      .catch(() => {})
      .then(operation);
    this.pending.set(entityId, result);
    void result
      .finally(() => {
        if (this.pending.get(entityId) === result) this.pending.delete(entityId);
      })
      .catch(() => {});
    return result;
  }
}
