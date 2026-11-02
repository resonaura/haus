/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validateFailure } from '../shared/recovery';

/** Two bounded private files survive restart; only compiled locations are kept. */
export class RecoveryDiagnostics {
  private tail = Promise.resolve();
  private queued = 0;
  constructor(
    private directory: string,
    private maxBytes = 64 * 1024,
  ) {}
  write(value: unknown) {
    if (this.queued >= 16) return;
    let report;
    try {
      report = validateFailure(value);
    } catch {
      return;
    }
    if (report.kind !== 'main') return;
    const input = value as { frames?: unknown; code?: unknown };
    const frames = Array.isArray(input.frames)
      ? input.frames
          .filter(
            (frame): frame is string =>
              typeof frame === 'string' && /^index\.[cm]?js:[1-9]\d{0,8}:[1-9]\d{0,8}$/.test(frame),
          )
          .slice(0, 8)
      : [];
    const code =
      typeof input.code === 'string' && /^E[A-Z0-9_]{1,63}$/.test(input.code)
        ? input.code
        : undefined;
    const line = JSON.stringify({ at: new Date().toISOString(), ...report, frames, code }) + '\n';
    if (Buffer.byteLength(line) > this.maxBytes) return;
    ++this.queued;
    this.tail = this.tail
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const file = join(this.directory, 'recovery.log');
        const size = await stat(file)
          .then((item) => item.size)
          .catch(() => 0);
        if (size + Buffer.byteLength(line) > this.maxBytes)
          await rename(file, join(this.directory, 'recovery.previous.log'));
        await appendFile(file, line, { mode: 0o600 });
      })
      .catch(() => {
        // Disk failure must not recursively become another main-process failure.
      })
      .finally(() => {
        --this.queued;
      });
  }
  flush() {
    return this.tail;
  }
}
