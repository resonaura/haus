/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Bounded per-app ring buffer with live subscriber fan-out for real-time bridge log streaming. */
export class AppLogBuffer {
  private readonly linesByApp = new Map<string, string[]>();
  private readonly listenersByApp = new Map<string, Set<(line: string) => void>>();

  constructor(private readonly maxLines = 300) {}

  append(appId: string, formattedLine: string): void {
    const lines = this.linesByApp.get(appId) ?? [];
    lines.push(formattedLine);
    if (lines.length > this.maxLines) {
      lines.splice(0, lines.length - this.maxLines);
    }
    this.linesByApp.set(appId, lines);
    const listeners = this.listenersByApp.get(appId);
    if (listeners) {
      for (const listener of Array.from(listeners)) {
        try {
          listener(formattedLine);
        } catch {
          // Isolate failing log subscribers.
        }
      }
    }
  }

  get(appId: string): readonly string[] | undefined {
    const lines = this.linesByApp.get(appId);
    return lines ? [...lines] : undefined;
  }

  subscribe(appId: string, onLine: (line: string) => void): () => void {
    let set = this.listenersByApp.get(appId);
    if (!set) {
      set = new Set();
      this.listenersByApp.set(appId, set);
    }
    set.add(onLine);
    return () => {
      const current = this.listenersByApp.get(appId);
      if (!current) return;
      current.delete(onLine);
      if (current.size === 0) this.listenersByApp.delete(appId);
    };
  }

  delete(appId: string): void {
    this.linesByApp.delete(appId);
    this.listenersByApp.delete(appId);
  }
}
