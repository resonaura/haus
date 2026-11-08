/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test, expect } from 'vitest';
import { mediaGrant, verifyGrant } from '../../src/nvr/grants.js';

const base = 'http://node';

test('a media capability expires, cannot change file, and contains no pairing key', () => {
  const key = 'pairing-key-that-never-enters-the-renderer';
  const digest = 'a'.repeat(64);
  const now = Date.now();
  const grant = mediaGrant(key, digest, now);
  expect(grant.path).not.toContain(key);
  expect(verifyGrant(key, new URL(grant.path, base), now)).toBe(digest);
  expect(verifyGrant(key, new URL(grant.path, base), now + 120001)).toBeNull();
  expect(
    verifyGrant(key, new URL(grant.path.replace(digest, 'b'.repeat(64)), base), now),
  ).toBeNull();
});
