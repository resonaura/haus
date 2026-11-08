/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface MediaQueueActiveWork {
  priority: number;
  startedAt: number;
}

interface PendingWorkItem {
  work: () => Promise<unknown>;
  priority: number;
  key?: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** One encoder on the helper; completed recordings take priority over speculative playback work. */
export class MediaQueue {
  readonly limit: number;
  pending: PendingWorkItem[] = [];
  active = false;
  activeWork?: MediaQueueActiveWork;
  stopped = false;

  constructor(limit = 12) {
    this.limit = limit;
  }

  run<T>(work: () => Promise<T>, priority = 0, key?: string): Promise<T> {
    if (this.stopped) return Promise.reject(new Error('media_stopped'));
    if (this.pending.length >= this.limit) return Promise.reject(new Error('media_queue_busy'));
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        work: () => work(),
        priority,
        key,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.pending.sort((a, b) => b.priority - a.priority);
      void this.next();
    });
  }

  promote(key: string, priority: number): void {
    for (const item of this.pending) {
      if (item.key === key) item.priority = Math.max(item.priority, priority);
    }
    this.pending.sort((a, b) => b.priority - a.priority);
  }

  async next(): Promise<void> {
    if (this.active || this.stopped) return;
    const item = this.pending.shift();
    if (!item) return;
    this.active = true;
    this.activeWork = { priority: item.priority, startedAt: Date.now() };
    try {
      item.resolve(await item.work());
    } catch (error) {
      item.reject(error);
    } finally {
      this.active = false;
      this.activeWork = undefined;
      void this.next();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const item of this.pending) item.reject(new Error('media_stopped'));
    this.pending = [];
  }
}
