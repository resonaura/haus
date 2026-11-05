/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface DeadbandOptions {
  /** Minimum numerical delta required to pass through the filter. */
  readonly minDelta?: number;
  /** Minimum elapsed time (ms) between emissions (rate limit). */
  readonly minIntervalMs?: number;
  /** Maximum elapsed time (ms) without an emission before a heartbeat update is forced. */
  readonly maxQuietIntervalMs?: number;
}

/**
 * Deadband and rate-limiting filter for high-frequency sensor readings (power meters, accelerometers).
 * Protects event loops, message buses, and database storage from telemetry storms.
 */
export class DeadbandFilter {
  private lastValue?: number;
  private lastEmitTime = 0;

  constructor(private readonly options: DeadbandOptions = {}) {}

  /**
   * Tests whether a new numerical value should be emitted based on delta and time limits.
   * If true, updates internal tracking state.
   */
  shouldEmit(value: number, nowMs = Date.now()): boolean {
    if (this.lastValue === undefined) {
      this.lastValue = value;
      this.lastEmitTime = nowMs;
      return true;
    }

    const elapsed = nowMs - this.lastEmitTime;

    // Force periodic heartbeat if max quiet interval has passed
    if (
      this.options.maxQuietIntervalMs !== undefined &&
      elapsed >= this.options.maxQuietIntervalMs
    ) {
      this.lastValue = value;
      this.lastEmitTime = nowMs;
      return true;
    }

    // Suppress if minInterval has not elapsed
    if (this.options.minIntervalMs !== undefined && elapsed < this.options.minIntervalMs) {
      return false;
    }

    // Check delta threshold
    if (this.options.minDelta !== undefined) {
      const delta = Math.abs(value - this.lastValue);
      if (delta < this.options.minDelta) {
        return false;
      }
    }

    this.lastValue = value;
    this.lastEmitTime = nowMs;
    return true;
  }

  reset(): void {
    this.lastValue = undefined;
    this.lastEmitTime = 0;
  }
}

/**
 * Keyed command queue that coalesces pending commands targeting the same endpoint and capability,
 * keeping only the latest desired state (LIFO) to prevent relay chatter and command queue flooding.
 */
export class CommandCoalescingQueue<TCommand extends { endpointId: string; capabilityId: string }> {
  private readonly pending = new Map<string, TCommand>();

  enqueue(command: TCommand): void {
    const key = `${command.endpointId}:${command.capabilityId}`;
    this.pending.set(key, command);
  }

  dequeue(): TCommand | undefined {
    const nextKey = this.pending.keys().next().value;
    if (nextKey === undefined) return undefined;
    const command = this.pending.get(nextKey);
    this.pending.delete(nextKey);
    return command;
  }

  size(): number {
    return this.pending.size;
  }

  clear(): void {
    this.pending.clear();
  }
}
