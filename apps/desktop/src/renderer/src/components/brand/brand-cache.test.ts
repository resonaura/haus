/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  getBrandIconCacheEpoch,
  getBrandIconCacheVersion,
  invalidateBrandIconCache,
  reconcileHubBrandIconRevision,
  rememberResolvedTile,
  resetBrandIconCacheForTesting,
  resolvedTileCache,
} from './brand-cache';

describe('renderer brand icon cache invalidation', () => {
  afterEach(() => {
    resetBrandIconCacheForTesting();
  });

  it('establishes initial Hub revision without clearing cache, then invalidates on revision rollover', () => {
    const initialEpoch = getBrandIconCacheEpoch();
    rememberResolvedTile(
      'k1',
      { dataUrl: 'data:image/png;base64,AA==', layout: 'inset' },
      initialEpoch,
    );
    expect(resolvedTileCache.size).toBe(1);

    // First observed Hub revision establishes baseline without wiping already-cached entries.
    expect(reconcileHubBrandIconRevision('v3-gnome-v4-cpp-11111111')).toBe(false);
    expect(resolvedTileCache.size).toBe(1);

    // Same revision is a no-op.
    expect(reconcileHubBrandIconRevision('v3-gnome-v4-cpp-11111111')).toBe(false);
    expect(resolvedTileCache.size).toBe(1);

    // New revision purges stale tiles and advances version token + epoch.
    expect(reconcileHubBrandIconRevision('v3-gnome-v4-cpp-22222222')).toBe(true);
    expect(resolvedTileCache.size).toBe(0);
    expect(getBrandIconCacheEpoch()).toBe(initialEpoch + 1);
    expect(getBrandIconCacheVersion()).toContain('v3-gnome-v4-cpp-22222222');

    // Late writes carrying the superseded epoch cannot repopulate the cache.
    rememberResolvedTile(
      'stale',
      { dataUrl: 'data:image/png;base64,AA==', layout: 'inset' },
      initialEpoch,
    );
    expect(resolvedTileCache.size).toBe(0);
  });

  it('clears caches and advances version token on explicit invalidation', () => {
    const beforeVersion = getBrandIconCacheVersion();
    const epoch = getBrandIconCacheEpoch();
    rememberResolvedTile('k2', { dataUrl: 'data:image/png;base64,AA==', layout: 'fill' }, epoch);
    expect(resolvedTileCache.size).toBe(1);

    invalidateBrandIconCache('');
    expect(resolvedTileCache.size).toBe(0);
    expect(getBrandIconCacheVersion()).not.toBe(beforeVersion);
  });
});
