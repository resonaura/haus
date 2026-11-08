/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { probeRtspSource } from '@haus/media';

export interface PrimarySourceInput {
  readonly url: string;
  readonly kind?: string;
  readonly inputArguments?: string[];
}

interface RecoveryEntry {
  readonly abort: AbortController;
  pending?: Promise<void>;
}

/** Prove that the primary source supplies a decoded picture before leaving HA. */
export async function probePrimarySource(
  input: PrimarySourceInput,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const ok = await probeRtspSource(input, signal);
  if (!ok) throw new Error('primary_source_unavailable');
}

/** Probe at most one fallback in the background, never interrupt an active event. */
export class PrimarySourceRecovery {
  readonly now: () => number;
  readonly probe: (input: PrimarySourceInput, signal: AbortSignal) => Promise<void>;
  readonly retryMs: number;
  readonly next = new WeakMap<object, number>();
  readonly active = new Map<object, RecoveryEntry>();
  stopped = false;

  constructor({
    now = () => performance.now(),
    probe = probePrimarySource,
    retryMs = 300000,
  }: {
    now?: () => number;
    probe?: (input: PrimarySourceInput, signal: AbortSignal) => Promise<void>;
    retryMs?: number;
  } = {}) {
    this.now = now;
    this.probe = probe;
    this.retryMs = retryMs;
  }

  consider(
    buffer: object,
    {
      eligible,
      find,
      promote,
    }: {
      eligible: () => boolean;
      find: () =>
        Promise<PrimarySourceInput | null | undefined> | PrimarySourceInput | null | undefined;
      promote: () => void;
    },
  ): Promise<void> | undefined {
    if (this.stopped) return undefined;
    if (!eligible()) {
      this.active.get(buffer)?.abort.abort();
      return undefined;
    }
    if (!this.next.has(buffer)) {
      this.next.set(buffer, this.now() + this.retryMs);
    }
    const nextAt = this.next.get(buffer) ?? 0;
    if (this.active.size || this.now() < nextAt) return undefined;
    this.next.set(buffer, this.now() + this.retryMs);
    const entry: RecoveryEntry = { abort: new AbortController() };
    this.active.set(buffer, entry);
    entry.pending = (async () => {
      try {
        const input = await find();
        entry.abort.signal.throwIfAborted();
        if (input?.kind !== 'rtsp') return;
        await this.probe(input, entry.abort.signal);
        entry.abort.signal.throwIfAborted();
        if (!this.stopped && eligible()) promote();
      } catch {
        // A working fallback remains untouched; retry later without URL logs.
      } finally {
        this.active.delete(buffer);
      }
    })();
    return entry.pending;
  }

  cancel(buffer: object): void {
    this.active.get(buffer)?.abort.abort();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const entry of this.active.values()) entry.abort.abort();
    await Promise.allSettled(Array.from(this.active.values(), (entry) => entry.pending));
  }
}
