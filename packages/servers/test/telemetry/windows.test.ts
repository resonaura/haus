/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { sanitizeHostReport, windowsTelemetry } from '../../src/index.js';

import { sample } from './support.js';
test('Windows disk use stays unknown when capacity or free space is missing', async () => {
  const rows = [
    { DeviceID: 'C:', Size: 1000, FreeSpace: null },
    { DeviceID: 'D:', Size: 1000 },
    { DeviceID: 'E:', Size: 1000, FreeSpace: '  ' },
    { DeviceID: 'F:', Size: 1000, FreeSpace: 0 },
    { DeviceID: 'G:', Size: null, FreeSpace: 200 },
    { DeviceID: 'H:', Size: 1000, FreeSpace: 400 },
  ];
  const { disks } = await windowsTelemetry(async () => JSON.stringify({ Disks: rows }));
  assert.deepEqual(
    disks.map((disk) => disk.usedBytes),
    [null, null, null, 1000, null, 600],
  );
  assert.deepEqual(
    disks.map((disk) => disk.availableBytes),
    [null, null, null, 0, 200, 400],
  );
  assert.equal(disks[4].totalBytes, null);
  const sanitized = sanitizeHostReport({ ...sample(), disks });
  assert.equal(sanitized.disks.length, rows.length);
  assert.equal(sanitized.disks[4].id, 'volume:G:');
  assert.equal(sanitized.disks[4].totalBytes, null);
  assert.equal(sanitized.disks[4].availableBytes, 200);
  assert.equal(sanitized.disks[4].usedBytes, null);
});
