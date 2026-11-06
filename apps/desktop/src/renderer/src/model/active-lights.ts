/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HausAccessory } from './types';

/** One projection of existing devices; no copies/renames of their HA identities. */
export function activeLights(items: HausAccessory[]) {
  return items.filter(
    (item) =>
      item.category === 'lights' && item.availability === 'available' && item.state.state === 'on',
  );
}
