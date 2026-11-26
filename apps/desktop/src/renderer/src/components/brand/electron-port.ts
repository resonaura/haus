/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo } from 'react';
import { registerBrandTileCacheClearHook, type BrandIconPort } from '@haus/ui/components';
import { clearRenderedBrandTileCache, renderBrandIconTile } from './engine/render';
import { useIconStyle } from './useIconStyle';

registerBrandTileCacheClearHook(clearRenderedBrandTileCache);

const ELECTRON_BRAND_RESOLVERS: Omit<BrandIconPort, 'iconStyle'> = {
  resolveTile: (kind, id, style, hint) =>
    window.hausNative?.brandIconTile
      ? window.hausNative.brandIconTile(kind, id, style, hint)
      : Promise.resolve(null),
  resolveSource: (kind, id, dark, hint) =>
    window.hausNative?.brandIcon
      ? window.hausNative.brandIcon(kind, id, dark, hint)
      : Promise.resolve(null),
  renderLocalTile: (rawSource, style, size) => renderBrandIconTile(rawSource, style, size),
  subscribeInvalidation: (listener) => {
    if (typeof window === 'undefined' || !window.hausNative?.onEvent) return () => {};
    return window.hausNative.onEvent((event) => {
      if (event.type === 'brand-icons-invalidated') {
        listener(event.version);
      } else if (event.type === 'connection' && event.status === 'disconnected') {
        listener();
      }
    });
  },
};

/** Connects Electron's IPC brand icon tiles, Canvas 2D fallback, and icon style to `@haus/ui`. */
export function useElectronBrandIconPort(): BrandIconPort {
  const iconStyle = useIconStyle();
  return useMemo<BrandIconPort>(
    () => ({
      ...ELECTRON_BRAND_RESOLVERS,
      iconStyle,
    }),
    [iconStyle],
  );
}
