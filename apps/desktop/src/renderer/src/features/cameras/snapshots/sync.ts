/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { CameraSnapshotFrame } from '../../../../../shared/native';

export const SNAPSHOT_CYCLE_MS = 5_000;
export const SNAPSHOT_ROUND_WINDOW_MS = 2_500;
export const SNAPSHOT_CARRY_MAX_AGE_MS = 30_000;

export interface SnapshotSyncSubscriber {
  readonly entityId: string;
  readonly canFetch: () => boolean;
  readonly fetchSnapshot: () => Promise<CameraSnapshotFrame>;
  readonly onFrame: (frame: CameraSnapshotFrame) => void;
  readonly onVisibilityChange?: () => void;
}

interface SubscriberEntry {
  readonly sub: SnapshotSyncSubscriber;
  disposed: boolean;
  inFlight?: Promise<CameraSnapshotFrame | null>;
  carriedFrame?: CameraSnapshotFrame;
}

/**
 * Coordinates camera card snapshot polling on a shared interval so visible cameras
 * refresh together. If a camera misses or resolves after a round's commit window,
 * healthy cameras still commit on time and the missed camera catches up in the next round.
 */
export class CameraSnapshotSync {
  private readonly entries = new Set<SubscriberEntry>();
  private readonly pendingJoin = new Set<SubscriberEntry>();
  private joinScheduled = false;
  private cycleTimer?: ReturnType<typeof setInterval>;
  private activeWindowTimers = new Set<ReturnType<typeof setTimeout>>();
  private visibilityAttached = false;

  constructor(
    private readonly cycleMs = SNAPSHOT_CYCLE_MS,
    private readonly roundWindowMs = SNAPSHOT_ROUND_WINDOW_MS,
  ) {}

  subscribe(sub: SnapshotSyncSubscriber): () => void {
    const entry: SubscriberEntry = { sub, disposed: false };
    this.entries.add(entry);
    this.attachVisibility();
    this.pendingJoin.add(entry);
    if (!this.joinScheduled) {
      this.joinScheduled = true;
      queueMicrotask(() => this.flushJoins());
    }
    return () => {
      entry.disposed = true;
      entry.carriedFrame = undefined;
      this.entries.delete(entry);
      this.pendingJoin.delete(entry);
      if (this.entries.size === 0) {
        this.teardown();
      }
    };
  }

  private flushJoins(): void {
    this.joinScheduled = false;
    const joined = [...this.pendingJoin].filter((entry) => !entry.disposed);
    this.pendingJoin.clear();
    if (this.entries.size === 0) return;
    if (!this.cycleTimer) {
      this.startCycle();
      this.runRound([...this.entries]);
      return;
    }
    if (joined.length > 0) {
      this.runRound(joined);
    }
  }

  private isVisible(): boolean {
    return typeof document === 'undefined' || document.visibilityState === 'visible';
  }

  private readonly handleVisibilityChange = (): void => {
    for (const entry of this.entries) {
      if (!entry.disposed) entry.sub.onVisibilityChange?.();
    }
    if (!this.isVisible() || this.entries.size === 0) return;
    if (!this.cycleTimer) {
      this.startCycle();
    }
    this.runRound([...this.entries]);
  };

  private attachVisibility(): void {
    if (this.visibilityAttached || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.visibilityAttached = true;
  }

  private startCycle(): void {
    this.stopCycle();
    this.cycleTimer = setInterval(() => {
      if (this.entries.size === 0) return;
      this.runRound([...this.entries]);
    }, this.cycleMs);
  }

  private stopCycle(): void {
    if (this.cycleTimer !== undefined) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = undefined;
    }
  }

  private teardown(): void {
    this.stopCycle();
    for (const timer of this.activeWindowTimers) clearTimeout(timer);
    this.activeWindowTimers.clear();
    if (this.visibilityAttached && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.visibilityAttached = false;
    }
  }

  private startOrReuseFetch(entry: SubscriberEntry): Promise<CameraSnapshotFrame | null> {
    if (entry.inFlight) return entry.inFlight;
    const promise = entry.sub
      .fetchSnapshot()
      .then((frame) => (frame?.image ? frame : null))
      .catch(() => null)
      .finally(() => {
        if (entry.inFlight === promise) {
          entry.inFlight = undefined;
        }
      });
    entry.inFlight = promise;
    return promise;
  }

  private runRound(candidates: readonly SubscriberEntry[]): void {
    const participants = candidates.filter((entry) => !entry.disposed && entry.sub.canFetch());
    if (participants.length === 0) return;

    const roundResults = new Map<SubscriberEntry, CameraSnapshotFrame>();
    const settled = new Set<SubscriberEntry>();
    let committed = false;
    let windowTimer: ReturnType<typeof setTimeout> | undefined;

    const commit = () => {
      if (committed) return;
      committed = true;
      if (windowTimer !== undefined) {
        clearTimeout(windowTimer);
        this.activeWindowTimers.delete(windowTimer);
        windowTimer = undefined;
      }
      const committedAt = Date.now();
      for (const entry of participants) {
        if (entry.disposed) continue;
        const result = roundResults.get(entry);
        let chosen: CameraSnapshotFrame | undefined;
        if (result?.fresh) {
          entry.carriedFrame = undefined;
          chosen = { ...result, receivedAt: committedAt };
        } else if (entry.carriedFrame) {
          const carried = entry.carriedFrame;
          entry.carriedFrame = undefined;
          const age = committedAt - (carried.capturedAt ?? carried.receivedAt);
          if (age < SNAPSHOT_CARRY_MAX_AGE_MS) {
            chosen = { ...carried, receivedAt: committedAt };
          } else if (result) {
            chosen = result;
          }
        } else if (result) {
          chosen = result;
        }
        if (chosen) {
          entry.sub.onFrame(chosen);
        }
      }
    };

    if (participants.length > 1) {
      windowTimer = setTimeout(commit, this.roundWindowMs);
      this.activeWindowTimers.add(windowTimer);
    }

    for (const entry of participants) {
      void this.startOrReuseFetch(entry).then((frame) => {
        if (entry.disposed) return;
        if (!committed) {
          if (frame) roundResults.set(entry, frame);
          settled.add(entry);
          if (settled.size === participants.length) {
            commit();
          }
        } else if (frame?.fresh) {
          // Arrived after this round's window closed; hold it so it commits together in the next round.
          entry.carriedFrame = frame;
        }
      });
    }
  }
}

export const sharedCameraSnapshotSync = new CameraSnapshotSync();
