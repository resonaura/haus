/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test, expect } from 'vitest';
import { nodeRoles } from '../../src/nvr/roles.js';

test('monitoring is explicit while an omitted setting preserves existing NVR roles', () => {
  expect(nodeRoles(undefined)).toEqual(['storage', 'stream']);
  expect(nodeRoles('')).toEqual([]);
  expect(nodeRoles('  ')).toEqual([]);
  expect(nodeRoles('stream, storage,stream')).toEqual(['stream', 'storage']);
  for (const input of [null, [], 'monitor', 'storage,', 'storage,other'])
    expect(() => nodeRoles(input)).toThrow(/Invalid roles/);
});
