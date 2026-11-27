/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

const POSITIVE_TTL_MS = 24 * 60 * 60_000;
const FALLBACK_TTL_MS = 2 * 60_000;

interface CacheEntry {
  readonly value: string | null;
  readonly expiresAt: number;
}

/** Bounded LRU cache and in-flight coalescing registry for resolved brand icon data URIs. */
export class BrandIconCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(private readonly maxEntries = 600) {}

  getInFlight(key: string): Promise<string | null> | undefined {
    return this.inFlight.get(key);
  }

  setInFlight(key: string, promise: Promise<string | null>): void {
    this.inFlight.set(key, promise);
  }

  clearInFlight(key: string): void {
    this.inFlight.delete(key);
  }

  get(key: string): string | null | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string | null, isFallback: boolean): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (isFallback ? FALLBACK_TTL_MS : POSITIVE_TTL_MS),
    });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
