/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Snapshot } from './types';

/** Real-home bootstrap has no fictional rooms, devices or administrator identity. */
export function createEmptySnapshot(): Snapshot {
  return {
    states: [],
    areas: [],
    devices: [],
    entities: [],
    services: {},
    config: { location_name: 'Home' },
    user: { name: '', is_admin: false },
  };
}
