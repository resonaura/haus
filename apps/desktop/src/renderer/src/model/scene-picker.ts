/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { EntityRegistryEntry, HassEntity, HausAccessory } from './types';
import { isSegmentEntity } from './normalize';

/** Existing scene targets stay editable; only the add picker excludes technical entities. */
export function isScenePickerTarget(
  entity: HassEntity,
  registry?: EntityRegistryEntry,
  owner?: HausAccessory,
) {
  return (
    /^(light|switch|climate|cover|media_player|fan|lock|input_boolean)\./.test(entity.entity_id) &&
    !registry?.disabled_by &&
    !registry?.hidden_by &&
    !registry?.entity_category &&
    !owner?.isService &&
    !(owner && owner.primaryEntityId !== entity.entity_id && isSegmentEntity(entity))
  );
}
