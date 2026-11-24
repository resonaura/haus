/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/** Computes jittered exponential backoff bounded between 500ms and maxDelayMs. */
export function computeReconnectDelayMs(
  attempt: number,
  baseDelayMs = 2000,
  maxDelayMs = 30000,
  random: () => number = Math.random,
): number {
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(Math.max(0, attempt), 5));
  const jitter = Math.round(capped * (0.8 + random() * 0.4));
  return Math.min(maxDelayMs, Math.max(500, jitter));
}
