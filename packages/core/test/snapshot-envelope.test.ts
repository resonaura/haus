/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  createSnapshotEnvelope,
  parseSnapshotEnvelope,
  snapshotEnvelopeSchema,
  snapshotEnvelopeVersion,
} from '../src/snapshot-envelope.js';

describe('snapshot envelope', () => {
  const options = {
    scope: 'account-hash',
    now: 10_000,
    maxAgeMs: 5_000,
    decode: (v: unknown) => v,
  };

  it('round trips a versioned snapshot without changing its payload', () => {
    const envelope = createSnapshotEnvelope('account-hash', 9_000, { rooms: ['Narnia'] });
    expect(envelope).toEqual({
      schema: snapshotEnvelopeSchema,
      version: snapshotEnvelopeVersion,
      scope: 'account-hash',
      capturedAt: 9_000,
      snapshot: { rooms: ['Narnia'] },
    });
    expect(parseSnapshotEnvelope(envelope, options)).toEqual(envelope);
  });

  it('rejects unknown versions, stale/future timestamps, wrong scope, and invalid payloads', () => {
    const valid = createSnapshotEnvelope('account-hash', 9_000, { ok: true });
    expect(parseSnapshotEnvelope({ ...valid, version: 2 }, options)).toBeUndefined();
    expect(parseSnapshotEnvelope({ ...valid, capturedAt: 4_999 }, options)).toBeUndefined();
    expect(parseSnapshotEnvelope({ ...valid, capturedAt: 10_001 }, options)).toBeUndefined();
    expect(parseSnapshotEnvelope({ ...valid, scope: 'other-account' }, options)).toBeUndefined();
    expect(parseSnapshotEnvelope(valid, { ...options, decode: () => undefined })).toBeUndefined();
  });
});
