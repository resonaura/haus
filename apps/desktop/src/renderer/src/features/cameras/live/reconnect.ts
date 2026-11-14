/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface LiveReconnectOptions {
  initialAttempt?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isVisible?: () => boolean;
  onTrigger: (nextAttempt: number) => void;
  onReset?: () => void;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  subscribeVisibility?: (listener: () => void) => () => void;
  subscribeOnline?: (listener: () => void) => () => void;
  random?: () => number;
}

/** Classifies hls.js error details into compact diagnostic categories. */
export function classifyHlsErrorDetail(
  details: string,
  resetDetail: string,
): 'reset' | 'append' | 'codec' | 'fragment' | 'manifest' | 'other' {
  if (details === resetDetail) return 'reset';
  if (details.includes('Append')) return 'append';
  if (details.includes('Codec')) return 'codec';
  if (details.startsWith('frag')) return 'fragment';
  if (details.startsWith('manifest')) return 'manifest';
  return 'other';
}

/** Computes jittered exponential backoff delay bounded between 500ms and maxDelayMs. */
export function computeReconnectDelayMs(
  attempt: number,
  baseDelayMs = 2000,
  maxDelayMs = 30000,
  random: () => number = Math.random,
): number {
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(Math.max(0, attempt), 5));
  const jitter = Math.round(capped * (0.8 + random() * 0.4));
  return Math.min(maxDelayMs, Math.max(500, jitter));
}

function defaultVisibilitySubscription(listener: () => void): () => void {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
    return () => {};
  }
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener?.('visibilitychange', listener);
}

function defaultOnlineSubscription(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  window.addEventListener('online', listener);
  return () => window.removeEventListener?.('online', listener);
}

/** Coordinates jittered reconnect backoff, visibility wakeup, and online recovery for live cameras. */
export class LiveReconnectController {
  private attempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly isVisible: () => boolean;
  private readonly onTrigger: (nextAttempt: number) => void;
  private readonly onReset?: () => void;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (id: ReturnType<typeof setTimeout>) => void;
  private readonly random: () => number;
  private readonly unsubscribeVisibility: () => void;
  private readonly unsubscribeOnline: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private waitingForVisible = false;
  private disposed = false;

  constructor(options: LiveReconnectOptions) {
    this.attempts = Math.max(0, options.initialAttempt ?? 0);
    this.baseDelayMs = options.baseDelayMs ?? 2000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
    this.isVisible =
      options.isVisible ??
      (() => (typeof document === 'undefined' ? true : document.visibilityState === 'visible'));
    this.onTrigger = options.onTrigger;
    this.onReset = options.onReset;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));
    this.random = options.random ?? Math.random;

    const onVisible = () => {
      if (this.disposed || !this.waitingForVisible || !this.isVisible()) return;
      this.waitingForVisible = false;
      this.trigger(this.attempts + 1);
    };
    const onOnline = () => {
      if (this.disposed || (this.timer === undefined && !this.waitingForVisible)) return;
      this.clearScheduledTimer();
      this.attempts = 0;
      if (this.isVisible()) {
        this.waitingForVisible = false;
        this.trigger(0);
      } else {
        this.waitingForVisible = true;
      }
    };

    this.unsubscribeVisibility = (options.subscribeVisibility ?? defaultVisibilitySubscription)(
      onVisible,
    );
    this.unsubscribeOnline = (options.subscribeOnline ?? defaultOnlineSubscription)(onOnline);
  }

  get currentAttempt(): number {
    return this.attempts;
  }

  schedule(): void {
    if (this.disposed) return;
    this.waitingForVisible = false;
    this.clearScheduledTimer();
    const delay = computeReconnectDelayMs(
      this.attempts,
      this.baseDelayMs,
      this.maxDelayMs,
      this.random,
    );
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      if (this.disposed) return;
      if (!this.isVisible()) {
        this.waitingForVisible = true;
        return;
      }
      this.trigger(this.attempts + 1);
    }, delay);
  }

  reset(): void {
    this.clearScheduledTimer();
    this.waitingForVisible = false;
    this.attempts = 0;
    this.onReset?.();
  }

  cancel(): void {
    this.clearScheduledTimer();
    this.waitingForVisible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.unsubscribeVisibility();
    this.unsubscribeOnline();
  }

  private clearScheduledTimer(): void {
    if (this.timer === undefined) return;
    this.clearTimer(this.timer);
    this.timer = undefined;
  }

  private trigger(nextAttempt: number): void {
    this.attempts = nextAttempt;
    this.onTrigger(nextAttempt);
  }
}
