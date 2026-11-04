/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Inject a monotonic clock and cancellable platform timer. */
export interface CommandClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}

/** One gesture: bounded leading/trailing delivery with a single latest-value slot. */
export class ContinuousCommand<T> {
  private pending?: { value: T };
  private cancelTimer?: () => void;
  private lastSent = -Infinity;
  private disposed = false;
  private finishing = false;
  private running = false;
  private tail: Promise<void> = Promise.resolve();
  private failure?: { error: unknown };

  constructor(
    private readonly send: (value: T) => Promise<unknown>,
    private readonly clock: CommandClock,
    private readonly onError: (error: unknown) => void,
    private readonly intervalMs = 100,
  ) {
    if (!(intervalMs >= 80 && intervalMs <= 100)) throw new Error('invalid-command-interval');
  }

  update(value: T): void {
    if (this.disposed || this.finishing) return;
    this.pending = { value };
    this.pump(false);
  }

  private pump(force: boolean): void {
    if (this.disposed || this.running || !this.pending) return;
    const delay = this.intervalMs - (this.clock.now() - this.lastSent);
    if (!force && delay > 0) {
      this.cancelTimer ??= this.clock.schedule(() => {
        this.cancelTimer = undefined;
        this.pump(false);
      }, delay);
      return;
    }
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    const value = this.pending.value;
    this.pending = undefined;
    this.lastSent = this.clock.now();
    this.running = true;
    this.tail = (async () => {
      try {
        await this.send(value);
      } catch (error) {
        if (!this.disposed) {
          this.failure = { error };
          this.dispose();
          this.onError(error);
        }
      } finally {
        this.running = false;
        if (!this.finishing) this.pump(false);
      }
    })();
  }

  async finish(): Promise<void> {
    this.finishing = true;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    while (!this.disposed && (this.running || this.pending)) {
      this.pump(true);
      await this.tail;
    }
    if (this.failure) throw this.failure.error;
  }

  dispose(): void {
    this.disposed = true;
    this.pending = undefined;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }
}
