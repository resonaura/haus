/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo } from 'react';
import { buildHomeView, type HomeViewInput } from '../../model/home-view';
export function useHomeView({
  model,
  snapshot,
  preferences,
  route,
  search,
  selectedLightGroup,
}: HomeViewInput) {
  return useMemo(
    () => buildHomeView({ model, snapshot, preferences, route, search, selectedLightGroup }),
    [model, snapshot, preferences, route, search, selectedLightGroup],
  );
}
