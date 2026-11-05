/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { probeRtspSource } from "@haus/media";

/** Prove that the primary source supplies a decoded picture before leaving HA. */
export async function probePrimarySource(input, signal) {
  signal.throwIfAborted();
  const ok = await probeRtspSource(input, signal);
  if (!ok) throw new Error("primary_source_unavailable");
}

/** Probe at most one fallback in the background, never interrupt an active event. */
export class PrimarySourceRecovery {
  constructor({
    now = () => performance.now(),
    probe = probePrimarySource,
    retryMs = 300000,
  } = {}) {
    this.now = now;
    this.probe = probe;
    this.retryMs = retryMs;
    this.next = new WeakMap();
    this.active = new Map();
  }
  consider(buffer, { eligible, find, promote }) {
    if (this.stopped) return;
    if (!eligible()) {
      this.active.get(buffer)?.abort.abort();
      return;
    }
    if (!this.next.has(buffer))
      this.next.set(buffer, this.now() + this.retryMs);
    if (this.active.size || this.now() < this.next.get(buffer)) return;
    this.next.set(buffer, this.now() + this.retryMs);
    const entry = { abort: new AbortController() };
    this.active.set(buffer, entry);
    entry.pending = (async () => {
      try {
        const input = await find();
        entry.abort.signal.throwIfAborted();
        if (input?.kind !== "rtsp") return;
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
  cancel(buffer) {
    this.active.get(buffer)?.abort.abort();
  }
  async stop() {
    this.stopped = true;
    for (const entry of this.active.values()) entry.abort.abort();
    await Promise.allSettled(
      [...this.active.values()].map((entry) => entry.pending),
    );
  }
}
