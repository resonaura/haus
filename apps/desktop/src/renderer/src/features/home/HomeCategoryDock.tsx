/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useLiquidGlassSurface } from '@haus/ui';
import { HomeCategoryDock as SharedHomeCategoryDock } from '@haus/ui/components';
import { useActiveLiquidGlass } from '../../hooks/useAppearance';

export interface HomeCategoryItem {
  id: string;
  name: string;
  summary: string;
}

/** The same sticky navigation dock on Home and every filtered Home view. */
export function HomeCategoryDock({
  categories,
  selected,
  onSelect,
}: {
  categories: HomeCategoryItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const activeGlass = useActiveLiquidGlass();
  const glass = useLiquidGlassSurface<HTMLElement>({
    settings: activeGlass.settings,
    cornerRadiusPx: 32,
    isDark: activeGlass.isDark,
  });

  return (
    <SharedHomeCategoryDock
      categories={categories}
      selected={selected}
      onSelect={onSelect}
      liquidGlass={{ enabled: glass.enabled }}
      dockRef={glass.ref}
      dockSurfaceTokens={glass.style as Record<string, string | number | undefined>}
      filterOverlay={glass.filterSvg}
    />
  );
}
