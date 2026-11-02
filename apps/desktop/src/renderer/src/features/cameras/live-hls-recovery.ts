/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

interface LiveFragment {
  start: number;
  duration: number;
}

/** Move past a failed live access unit; never repeatedly feed the same fragment. */
export class LiveHlsRecovery {
  private attempts = 0;
  private attemptedAt = -Infinity;
  private position = -Infinity;

  next(now: number, mediaTime: number, fragments: readonly LiveFragment[]): number | undefined {
    if (now - this.attemptedAt >= 60000) this.attempts = 0;
    if (this.attempts >= 2 || !Number.isFinite(mediaTime)) return undefined;
    const failedAt = Math.max(mediaTime, this.position);
    const next = fragments.find(
      (fragment) =>
        Number.isFinite(fragment.start) &&
        Number.isFinite(fragment.duration) &&
        fragment.duration > 0 &&
        fragment.start > failedAt + 0.05,
    );
    if (!next) return undefined;
    this.attempts++;
    this.attemptedAt = now;
    this.position = next.start + 0.001;
    return this.position;
  }
}
