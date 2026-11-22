/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HassEntity } from './types';
import { lightColor } from './light-color';
import { lightActiveEffectOption, type LightEffectOption } from './light-profile';

import { isEntityActive } from '@haus/ha/view/device-state';
export { isEntityActive, binaryStateDescription } from '@haus/ha/view/device-state';

export interface DeviceAppearance {
  active: boolean;
  accent: string;
  actualColor: string | undefined;
  effect?: LightEffectOption;
}

/** Light output keeps its color or active effect palette; other active devices share a neutral highlight. */
export function deviceAppearance(entity: HassEntity): DeviceAppearance {
  const active = isEntityActive(entity);
  const domain = entity.entity_id.split('.')[0];
  const effect = active && domain === 'light' ? lightActiveEffectOption(entity) : undefined;
  const actualColor = active ? (effect?.palette[0] ?? lightColor(entity)) : undefined;
  const accent =
    domain === 'light' ? (actualColor ?? 'var(--cat-lights)') : 'var(--device-neutral)';
  return { active, accent, actualColor, ...(effect ? { effect } : {}) };
}

/** Builds unified CSS custom property map for solid light color or animated effect light wash. */
export function deviceSurfaceVars(
  accent: string,
  effect?: LightEffectOption,
  includeAccent = false,
): Record<string, string> {
  return {
    '--device-color': accent,
    ...(includeAccent ? { '--accent': accent } : {}),
    ...(effect
      ? {
          '--effect-c1': effect.palette[0],
          '--effect-c2': effect.palette[1],
          '--effect-c3': effect.palette[2],
        }
      : {}),
  };
}
