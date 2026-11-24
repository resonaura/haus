/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface VisibilityTargetDescriptor {
  readonly id: string;
  readonly name: string;
  readonly primaryEntityId: string;
  readonly entityIds: readonly string[];
  readonly visibilityEntityIds?: readonly string[];
  readonly defaultHidden?: boolean;
  readonly isLightGroup?: boolean;
  readonly lightGroup?: unknown;
}

export interface ClientVisibilityPreferences {
  readonly favorites: readonly string[];
  readonly hiddenApp: readonly string[];
  readonly hiddenHome: readonly string[];
  readonly unhiddenApp?: readonly string[];
  readonly disabledLightGroups?: readonly string[];
}

export interface VisibilityPreferencePatch {
  readonly hiddenApp?: string[];
  readonly hiddenHome?: string[];
  readonly unhiddenApp?: string[];
  readonly disabledLightGroups?: string[];
}

function visibilityIdsFor(item: VisibilityTargetDescriptor): string[] {
  return (item.visibilityEntityIds ?? item.entityIds).filter((id) => !id.startsWith('scene.'));
}

function isGroupedLight(item: VisibilityTargetDescriptor | undefined): boolean {
  return Boolean(item?.isLightGroup || item?.lightGroup);
}

export function resolveVisibilityTarget<T extends VisibilityTargetDescriptor>(
  target: string | T,
  items: readonly T[],
): {
  readonly accessory: T | undefined;
  readonly id: string;
  readonly entityIds: readonly string[];
} {
  const accessory =
    typeof target === 'string'
      ? target.startsWith('scene.')
        ? undefined
        : items.find((item) => item.primaryEntityId === target || item.entityIds.includes(target))
      : isGroupedLight(target)
        ? target
        : (items.find((item) => item.id === target.id) ?? target);
  const id = accessory?.primaryEntityId ?? (target as string);
  return { accessory, id, entityIds: accessory ? visibilityIdsFor(accessory) : [id] };
}

export function restoreFromAppPatch<T extends VisibilityTargetDescriptor>(
  target: string | T,
  items: readonly T[],
  preferences: ClientVisibilityPreferences,
): VisibilityPreferencePatch {
  const { accessory, id, entityIds: ids } = resolveVisibilityTarget(target, items);
  return {
    hiddenApp: preferences.hiddenApp.filter((item) => !ids.includes(item)),
    unhiddenApp: accessory?.defaultHidden
      ? Array.from(new Set([...(preferences.unhiddenApp ?? []), id]))
      : [...(preferences.unhiddenApp ?? [])],
  };
}

export function toggleAppVisibilityPatch<T extends VisibilityTargetDescriptor>(
  target: string | T,
  items: readonly T[],
  preferences: ClientVisibilityPreferences,
  isHidden?: boolean,
): { readonly hidden: boolean; readonly patch: VisibilityPreferencePatch } {
  const { accessory, id, entityIds: ids } = resolveVisibilityTarget(target, items);
  const hiddenSet = new Set(preferences.hiddenApp);
  const unhiddenSet = new Set(preferences.unhiddenApp ?? []);
  const currentlyHidden =
    isHidden ??
    (accessory
      ? accessory.defaultHidden
        ? !unhiddenSet.has(accessory.primaryEntityId) &&
          !accessory.entityIds.some((memberId) => unhiddenSet.has(memberId))
        : hiddenSet.has(accessory.primaryEntityId) ||
          accessory.entityIds.some((memberId) => hiddenSet.has(memberId))
      : ids.some((memberId) => hiddenSet.has(memberId)));

  if (currentlyHidden) {
    return {
      hidden: false,
      patch: restoreFromAppPatch(target, items, preferences),
    };
  }
  return {
    hidden: true,
    patch: {
      hiddenApp: Array.from(
        new Set([...preferences.hiddenApp, ...(isGroupedLight(accessory) ? ids : [id])]),
      ),
      unhiddenApp: (preferences.unhiddenApp ?? []).filter((item) => !ids.includes(item)),
    },
  };
}

export function toggleHomeVisibilityPatch<T extends VisibilityTargetDescriptor>(
  target: string | T,
  items: readonly T[],
  preferences: ClientVisibilityPreferences,
): { readonly hidden: boolean; readonly patch: VisibilityPreferencePatch } {
  const { accessory, id, entityIds: ids } = resolveVisibilityTarget(target, items);
  const currentlyHidden = ids.some((memberId) => preferences.hiddenHome.includes(memberId));
  return {
    hidden: !currentlyHidden,
    patch: {
      hiddenHome: currentlyHidden
        ? preferences.hiddenHome.filter((item) => !ids.includes(item))
        : [
            ...preferences.hiddenHome,
            ...(typeof target !== 'string' && isGroupedLight(accessory) ? ids : [id]),
          ],
    },
  };
}

export function separateLightGroupPatch(
  groupKey: string,
  preferences: ClientVisibilityPreferences,
): VisibilityPreferencePatch {
  return {
    disabledLightGroups: [...new Set([...(preferences.disabledLightGroups ?? []), groupKey])],
  };
}
