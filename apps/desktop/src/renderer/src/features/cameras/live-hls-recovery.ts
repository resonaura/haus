/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HlsConfig } from 'hls.js';

interface LiveFragment {
  start: number;
  duration: number;
}

const STREAM_LOAD_POLICY = {
  default: {
    maxTimeToFirstByteMs: 16000,
    maxLoadTimeMs: 20000,
    timeoutRetry: { maxNumRetry: 2, retryDelayMs: 1000, maxRetryDelayMs: 4000 },
    errorRetry: { maxNumRetry: 2, retryDelayMs: 1000, maxRetryDelayMs: 4000 },
  },
};

/** Default HLS player configuration tuned for cold standalone Hub camera startup. */
export const LIVE_HLS_CONFIG: Partial<HlsConfig> = {
  enableWorker: true,
  lowLatencyMode: true,
  backBufferLength: 20,
  maxBufferLength: 12,
  maxMaxBufferLength: 30,
  maxBufferSize: 24 * 1024 ** 2,
  manifestLoadPolicy: STREAM_LOAD_POLICY,
  playlistLoadPolicy: STREAM_LOAD_POLICY,
};

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
