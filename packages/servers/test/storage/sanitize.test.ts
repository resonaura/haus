/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { sanitizeHostReport } from '../../src/index.js';

test('collector sanitizer keeps additive metadata, accepts legacy reports and removes invalid parents', () => {
  const report = {
    sampledAt: new Date().toISOString(),
    scope: 'host',
    cpu: { logicalCores: 4 },
    memory: { totalBytes: 100, availableBytes: 50, usedBytes: 50 },
    disks: [
      { id: 'disk', kind: 'disk', totalBytes: 100 },
      {
        id: 'mapped',
        kind: 'volume',
        type: 'container',
        physical: false,
        parentId: 'disk',
        parentIds: ['disk', 'mapped', 22],
      },
      {
        id: 'unrecognized',
        kind: 'volume',
        type: 'execute',
        physical: 'yes',
        totalBytes: 100,
      },
    ],
  };
  report.disks[1].totalBytes = 100;
  const result = sanitizeHostReport(report);
  assert.equal(result.disks[0].type, 'disk');
  assert.equal(result.disks[0].physical, null);
  assert.equal(result.disks[1].type, 'container');
  assert.deepEqual(result.disks[1].parentIds, ['disk']);
  assert.equal(result.disks[2].type, 'volume');
  assert.equal(result.disks[2].physical, null);
});
