/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isRecord } from './record.js';

export const snapshotEnvelopeSchema = 'haus.snapshot' as const;
export const snapshotEnvelopeVersion = 1 as const;

export interface SnapshotEnvelope<T> {
  schema: typeof snapshotEnvelopeSchema;
  version: typeof snapshotEnvelopeVersion;
  scope: string;
  capturedAt: number;
  snapshot: T;
}

export interface ParseSnapshotEnvelopeOptions<T> {
  scope: string;
  now?: number;
  maxAgeMs: number;
  decode: (value: unknown) => T | undefined;
}

/** Wrap a local snapshot in a portable, explicitly versioned persistence contract. */
export function createSnapshotEnvelope<T>(
  scope: string,
  capturedAt: number,
  snapshot: T,
): SnapshotEnvelope<T> {
  if (!scope || scope.length > 256 || !Number.isSafeInteger(capturedAt))
    throw new TypeError('Invalid snapshot envelope metadata.');
  return {
    schema: snapshotEnvelopeSchema,
    version: snapshotEnvelopeVersion,
    scope,
    capturedAt,
    snapshot,
  };
}

/** Reject unknown schemas/versions, cross-account data, stale timestamps and invalid payloads. */
export function parseSnapshotEnvelope<T>(
  value: unknown,
  options: ParseSnapshotEnvelopeOptions<T>,
): SnapshotEnvelope<T> | undefined {
  if (
    !isRecord(value) ||
    value.schema !== snapshotEnvelopeSchema ||
    value.version !== snapshotEnvelopeVersion ||
    !options.scope ||
    options.scope.length > 256 ||
    value.scope !== options.scope ||
    !Number.isSafeInteger(value.capturedAt) ||
    !Number.isSafeInteger(options.now ?? Date.now()) ||
    !Number.isSafeInteger(options.maxAgeMs) ||
    options.maxAgeMs < 0
  )
    return;

  const capturedAt = Number(value.capturedAt);
  const now = options.now ?? Date.now();
  if (capturedAt > now || capturedAt < now - options.maxAgeMs) return;

  const snapshot = options.decode(value.snapshot);
  if (snapshot === undefined) return;

  return {
    schema: snapshotEnvelopeSchema,
    version: snapshotEnvelopeVersion,
    scope: options.scope,
    capturedAt,
    snapshot,
  };
}
