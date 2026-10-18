import type { HausAccessory } from './types';

export const accessoryVisibilityIds = (accessory: HausAccessory) =>
  accessory.entityIds.filter((id) => !id.startsWith('scene.'));

/** Scenes stay independently visible even when HA attaches them to a bridge/device. */
export function visibilityTarget(target: string | HausAccessory, accessories: HausAccessory[]) {
  const accessory =
    typeof target === 'string'
      ? target.startsWith('scene.')
        ? undefined
        : accessories.find(
            (item) => item.primaryEntityId === target || item.entityIds.includes(target),
          )
      : target;
  const id = accessory?.primaryEntityId ?? (target as string);
  return { accessory, id, entityIds: accessory ? accessoryVisibilityIds(accessory) : [id] };
}
