/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export const CLIENT_TIME_HEADER = 'x-haus-client-time';

export interface ClockSkewAssessment {
  readonly clientTimestampMs: number;
  readonly hostTimestampMs: number;
  readonly skewMs: number;
  readonly needsSync: boolean;
  readonly safeForTls: boolean;
}

// 24 hours in milliseconds
const MAX_ACCEPTABLE_SKEW_MS = 24 * 60 * 60 * 1000;
// 2020-01-01T00:00:00.000Z in ms
const MIN_SANE_TIMESTAMP_MS = 1577836800000;

export function evaluateClockSkew(
  clientTimestampMs: number,
  hostTimestampMs = Date.now(),
): ClockSkewAssessment {
  const skewMs = hostTimestampMs - clientTimestampMs;
  const absSkew = Math.abs(skewMs);

  // If host clock is near UNIX epoch 1970 (e.g. Raspberry Pi cold-start before NTP)
  const isColdStart = hostTimestampMs < MIN_SANE_TIMESTAMP_MS;
  const isSeverelySkewed = absSkew > MAX_ACCEPTABLE_SKEW_MS;

  const needsSync = isColdStart || isSeverelySkewed;
  const safeForTls = !needsSync;

  return {
    clientTimestampMs,
    hostTimestampMs,
    skewMs,
    needsSync,
    safeForTls,
  };
}

export function parseClientTimeHeader(headerValue: string | null | undefined): number | null {
  if (!headerValue) return null;
  const parsed = Number(headerValue);
  if (!Number.isFinite(parsed) || parsed < MIN_SANE_TIMESTAMP_MS) {
    return null;
  }
  return parsed;
}
