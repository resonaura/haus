/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { setTimeout as pause } from 'node:timers/promises';

/** Keep slow encoder work out of a single long-lived ingress response. */
export async function recordingPreparation(
  request: () => Promise<Response>,
  signal: AbortSignal,
  { pollMs = 1000, timeoutMs = 600000 } = {},
) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    const response = await request();
    if (response.status !== 202) return response;
    await response.body?.cancel();
    await pause(Math.min(pollMs, Math.max(0, deadline - performance.now())), undefined, { signal });
  }
  throw new Error('This recording is taking longer to prepare. Try again shortly.');
}
