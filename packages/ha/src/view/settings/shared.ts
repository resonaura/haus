/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Preferences } from '../preferences.js';
import type { HausAccessory } from '../types.js';
export const sharedPreferenceKeys = [
  'favorites',
  'hiddenApp',
  'hiddenHome',
  'unhiddenApp',
  'deviceOrder',
  'autoGroupLights',
  'disabledLightGroups',
  'roomIcons',
  'serverDevices',
  'iconAppearance',
  'iconVariation',
  'iconTintColor',
] as const;
export function sharedPreferences(preferences: Preferences) {
  return Object.fromEntries(
    sharedPreferenceKeys.map((key) => [
      key,
      preferences[key] ??
        (key === 'autoGroupLights'
          ? true
          : key === 'iconAppearance'
            ? 'default'
            : key === 'iconVariation'
              ? 'auto'
              : key === 'iconTintColor'
                ? 'automatic'
                : ['deviceOrder', 'roomIcons', 'serverDevices'].includes(key)
                  ? {}
                  : []),
    ]),
  );
}
export function changedPreferences(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return Object.fromEntries(
    sharedPreferenceKeys
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => [key, after[key]]),
  );
}

export function setAccessoryFavorite(
  favorites: readonly string[],
  accessory: Pick<HausAccessory, 'entityIds' | 'primaryEntityId' | 'lightGroup'>,
  favorite: boolean,
): string[] {
  if (!favorite) return favorites.filter((id) => !accessory.entityIds.includes(id));
  const ids = accessory.lightGroup?.members.map((member) => member.primaryEntityId) ?? [
    accessory.primaryEntityId,
  ];
  return [...new Set([...favorites, ...ids])];
}
