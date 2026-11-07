/*
 * Haus — A thoughtful home for Haus Hub.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test, expect } from 'vitest';
import { nodeStorageCategory, addStorageRole } from '../../../src/nvr/storage/usage.js';

test('classifies only confirmed blob roles and separates active capture from pre-event data', async () => {
  const id = 'a'.repeat(64);
  const roles = new Map<string, string>();
  expect(nodeStorageCategory(`blobs/${id}`, roles)).toBe('other-media');
  addStorageRole(roles, id, 'originals');
  expect(nodeStorageCategory(`blobs/${id}`, roles)).toBe('originals');
  addStorageRole(roles, id, 'prepared');
  expect(nodeStorageCategory(`blobs/${id}`, roles)).toBe('shared');
  expect(nodeStorageCategory('camera-sessions/session/event-id/part.ts')).toBe('capture');
  expect(nodeStorageCategory('camera-sessions/session/part.ts')).toBe('prebuffer');
  expect(nodeStorageCategory('recordings.sqlite-wal')).toBe('databases');
  expect(nodeStorageCategory('camera-recordings/event.mp4')).toBe('capture');
  expect(nodeStorageCategory('blobs/.partial-x')).toBe('temporary');
});
