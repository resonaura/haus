/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Preferences } from './preferences.js';

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

export function sharedPreferences(preferences: Preferences): Record<string, unknown> {
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
): Record<string, unknown> {
  return Object.fromEntries(
    sharedPreferenceKeys
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => [key, after[key]]),
  );
}

export interface FavoriteAccessoryTarget {
  readonly entityIds: readonly string[];
  readonly primaryEntityId: string;
  readonly lightGroup?: {
    readonly members: readonly { readonly primaryEntityId: string }[];
  };
}

export function setAccessoryFavorite(
  favorites: readonly string[],
  accessory: FavoriteAccessoryTarget,
  favorite: boolean,
): string[] {
  if (!favorite) return favorites.filter((id) => !accessory.entityIds.includes(id));
  const ids = accessory.lightGroup?.members.map((member) => member.primaryEntityId) ?? [
    accessory.primaryEntityId,
  ];
  return [...new Set([...favorites, ...ids])];
}

export const CAMERA_ORDER_SCOPE = 'home:cameras';

function resolveCameraKey(camera: { readonly entity_id?: string; readonly id?: string }): string {
  return camera.entity_id ?? camera.id ?? '';
}

export function orderCameras<T extends { readonly entity_id?: string; readonly id?: string }>(
  cameras: readonly T[],
  saved: readonly string[] = [],
): T[] {
  if (!saved.length) return [...cameras];
  const ranks = new Map(saved.map((id, index) => [id, index]));
  return [...cameras].sort(
    (a, b) =>
      (ranks.get(resolveCameraKey(a)) ?? Number.POSITIVE_INFINITY) -
      (ranks.get(resolveCameraKey(b)) ?? Number.POSITIVE_INFINITY),
  );
}

export function moveCamera(ids: readonly string[], from: string, to: string): string[] {
  const source = ids.indexOf(from);
  const target = ids.indexOf(to);
  if (source < 0 || target < 0 || source === target) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(source, 1);
  if (moved !== undefined) next.splice(target, 0, moved);
  return next;
}

/** Reorders visible camera slots without dropping hidden, temporarily missing, or newly added cameras. */
export function cameraOrderPatch(
  saved: readonly string[] = [],
  known: readonly string[],
  visible: readonly string[],
): string[] {
  const complete = [...new Set([...saved, ...known, ...visible])];
  const selected = new Set(visible);
  let index = 0;
  return complete.map((id) => (selected.has(id) ? (visible[index++] ?? id) : id));
}

/** Computes a shared `Preferences` patch moving `cameraId` earlier (`-1`) or later (`+1`) among `visibleCameraIds`. */
export function buildCameraMovePreferencePatch(
  preferences: Preferences,
  knownCameraIds: readonly string[],
  visibleCameraIds: readonly string[],
  cameraId: string,
  direction: -1 | 1,
): Partial<Preferences> | undefined {
  const index = visibleCameraIds.indexOf(cameraId);
  const target = visibleCameraIds[index + direction];
  if (index < 0 || !target) return undefined;
  const reordered = moveCamera(visibleCameraIds, cameraId, target);
  const saved = preferences.deviceOrder?.[CAMERA_ORDER_SCOPE];
  return {
    deviceOrder: {
      ...preferences.deviceOrder,
      [CAMERA_ORDER_SCOPE]: cameraOrderPatch(saved, knownCameraIds, reordered),
    },
  };
}
