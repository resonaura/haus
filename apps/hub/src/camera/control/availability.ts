/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface CameraAvailabilityItem {
  id: string;
  aliases?: string[];
  enabled?: boolean;
  available?: boolean;
  nativeProvider?: unknown;
  independentSource?: boolean;
}

export interface CameraAvailabilityBuffer {
  status?: string;
  stopped?: boolean;
  lastAdvance?: number;
}

interface AvailabilityEntry {
  online: boolean;
  lostAt?: number;
}

/** Keep already flowing recordings through a brief HA proxy/snapshot outage. */
export class CameraAvailability {
  now: () => number;
  wallNow: () => number;
  graceMs: number;
  progressMs: number;
  entries = new Map<string, AvailabilityEntry>();

  constructor({
    now = () => performance.now(),
    wallNow = () => Date.now(),
    graceMs = 30_000,
    progressMs = 10_000,
  }: {
    now?: () => number;
    wallNow?: () => number;
    graceMs?: number;
    progressMs?: number;
  } = {}) {
    this.now = now;
    this.wallNow = wallNow;
    this.graceMs = graceMs;
    this.progressMs = progressMs;
  }

  apply(
    cameras: CameraAvailabilityItem[],
    states: { entity_id: string; state: string }[],
    buffers?: Map<string, CameraAvailabilityBuffer>,
  ): boolean {
    const at = this.now();
    const stateMap = new Map(states.map((state) => [state.entity_id, state.state]));
    const ids = new Set(cameras.map((camera) => camera.id));
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);
    let changed = false;
    for (const camera of cameras) {
      // Native provider progress has its own bounded freshness; an HA presentation is not its source.
      if (camera.nativeProvider || camera.independentSource) continue;
      // An idle Generic wrapper can serve placeholder frames indefinitely. Its
      // physical aliases must recover too before starting a new grace period.
      const sourceStates = [camera.id, ...(camera.aliases ?? [])].map((id) => stateMap.get(id));
      let entry = this.entries.get(camera.id);
      const online = sourceStates.every(
        (state) => state && !['unknown', 'unavailable', 'off'].includes(state),
      );
      if (online) entry = { online: true };
      else {
        entry ??= { online: false };
        entry.lostAt ??= at;
        const buffer = buffers?.get(camera.id);
        const flowing =
          buffer?.status === 'buffering' &&
          !buffer.stopped &&
          typeof buffer.lastAdvance === 'number' &&
          Number.isFinite(buffer.lastAdvance) &&
          Math.max(0, this.wallNow() - buffer.lastAdvance) < this.progressMs;
        // Placeholder frames cannot keep an offline source available forever.
        // Only actual HA recovery starts a new grace period.
        entry.online =
          !sourceStates.includes('off') &&
          Boolean(camera.enabled) &&
          entry.online &&
          flowing &&
          at - entry.lostAt < this.graceMs;
      }
      this.entries.set(camera.id, entry);
      const available = !!entry.online;
      if (camera.available !== available) changed = true;
      camera.available = available;
    }
    return changed;
  }
}
