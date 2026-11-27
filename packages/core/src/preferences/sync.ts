/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mergePreference } from './merge.js';
import { changedPreferences } from './shared.js';

export interface SharedDocument {
  revision: string;
  value: Record<string, unknown>;
  updatedAt: number;
  conflict?: boolean;
}

export interface PreferenceSyncAdapter {
  local: () => Record<string, unknown>;
  apply: (patch: Record<string, unknown>) => void;
  read: () => Promise<SharedDocument>;
  write: (revision: string, patch: Record<string, unknown>) => Promise<SharedDocument>;
  baseline?: (value: Record<string, unknown>) => void;
  seedMissing?: boolean;
  status: (status: 'syncing' | 'synced' | 'offline') => void;
}

/** Per-field changes plus compare-and-swap prevent an idle client overwriting another device. */
export class PreferenceSync {
  private observed: Record<string, unknown>;
  private pending = new Map<string, { before: unknown; after: unknown; version: number }>();
  private version = 0;
  private again = false;
  private active = true;
  private busy = false;

  constructor(
    private adapter: PreferenceSyncAdapter,
    baseline?: Record<string, unknown>,
  ) {
    this.observed = baseline ?? adapter.local();
    this.changed();
  }

  changed(): void {
    for (const [key, after] of Object.entries(
      changedPreferences(this.observed, this.adapter.local()),
    )) {
      const previous = this.pending.get(key);
      this.pending.set(key, {
        before: previous ? previous.before : this.observed[key],
        after,
        version: ++this.version,
      });
    }
    this.observed = this.adapter.local();
  }

  async sync(): Promise<void> {
    if (!this.active) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    this.changed();
    this.adapter.status('syncing');
    try {
      for (let attempt = 0; attempt < 3 && this.active; attempt++) {
        const remote = await this.adapter.read();
        if (!this.active) return;
        this.changed();
        this.adapter.baseline?.(remote.value);
        // A brand-new Hub/helper adopts this home's existing layout once. Existing fields win on other clients.
        if (this.adapter.seedMissing !== false) {
          for (const [key, after] of Object.entries(this.adapter.local()))
            if (!(key in remote.value) && !this.pending.has(key))
              this.pending.set(key, { before: undefined, after, version: ++this.version });
        }
        const submitted = new Map(this.pending);
        const patch = Object.fromEntries(
          [...submitted].map(([key, edit]) => [
            key,
            mergePreference(key, edit.before, edit.after, remote.value[key]),
          ]),
        );
        const merged = { ...remote.value, ...patch };
        this.adapter.apply(merged);
        this.observed = this.adapter.local();
        if (!Object.keys(patch).length) {
          this.adapter.status('synced');
          return;
        }
        const saved = await this.adapter.write(remote.revision, patch);
        if (!this.active) return;
        if (saved.conflict) continue;
        this.adapter.baseline?.(saved.value);
        this.changed();
        for (const [key, edit] of submitted)
          if (this.pending.get(key)?.version === edit.version) this.pending.delete(key);
        if (this.pending.size) this.again = true;
        this.adapter.status(this.pending.size ? 'syncing' : 'synced');
        return;
      }
      if (this.active) this.adapter.status('offline');
    } catch {
      if (this.active) this.adapter.status('offline');
    } finally {
      this.busy = false;
      if (this.again && this.active) {
        this.again = false;
        void this.sync();
      }
    }
  }

  stop(): void {
    this.active = false;
  }
}
