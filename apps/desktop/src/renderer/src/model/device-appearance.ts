/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HassEntity } from './types';
import { lightColor } from './light-color';

import { isEntityActive } from '@haus/ha/view/device-state';
export { isEntityActive, binaryStateDescription } from '@haus/ha/view/device-state';

/** Light output keeps its color; other active devices share a neutral highlight. */
export function deviceAppearance(entity: HassEntity) {
  const active = isEntityActive(entity);
  const domain = entity.entity_id.split('.')[0];
  const actualColor = active ? lightColor(entity) : undefined;
  const accent = domain === 'light' ? 'var(--cat-lights)' : 'var(--device-neutral)';
  return { active, accent: actualColor ?? accent, actualColor };
}
