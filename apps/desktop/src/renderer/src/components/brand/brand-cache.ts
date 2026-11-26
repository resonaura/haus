/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  buildMonogramBadgeSvgUri,
  getBrandIconCacheEpoch,
  getBrandIconCacheVersion,
  inflightBrandTiles as inflightTiles,
  invalidateBrandIconCache,
  reconcileHubBrandIconRevision,
  registerBrandTileCacheClearHook,
  rememberResolvedBrandTile as rememberResolvedTile,
  resetBrandIconCacheForTesting,
  resolvedBrandTileCache as resolvedTileCache,
  useBrandIconCacheVersion,
} from '@haus/ui/components';
import { clearRenderedBrandTileCache } from './engine/render';

registerBrandTileCacheClearHook(clearRenderedBrandTileCache);

export {
  buildMonogramBadgeSvgUri,
  getBrandIconCacheEpoch,
  getBrandIconCacheVersion,
  inflightTiles,
  invalidateBrandIconCache,
  reconcileHubBrandIconRevision,
  rememberResolvedTile,
  resetBrandIconCacheForTesting,
  resolvedTileCache,
  useBrandIconCacheVersion,
};
