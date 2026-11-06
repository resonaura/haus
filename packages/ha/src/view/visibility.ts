/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HausAccessory } from './types.js';

export const accessoryVisibilityIds = (accessory: HausAccessory) =>
  (accessory.visibilityEntityIds ?? accessory.entityIds).filter((id) => !id.startsWith('scene.'));

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
