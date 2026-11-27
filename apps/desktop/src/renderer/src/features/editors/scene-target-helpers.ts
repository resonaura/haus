/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  describeSavedTargetValues,
  describeSceneTargetState,
  inferSceneTargetDomain,
  missingSceneTargetColor,
  missingSceneTargetName,
  replaceSceneEntity,
  resolveSceneTargetVisual,
  sceneTargetEntity,
  targetConfig,
  toggleSceneTargetState,
  transferSceneTarget,
} from '@haus/core/transport';
import type { Category, HassEntity, HausAccessory } from '../../model';
import { describeAccessory } from '../../model/presentation';

export {
  describeSavedTargetValues,
  inferSceneTargetDomain,
  missingSceneTargetColor,
  missingSceneTargetName,
  replaceSceneEntity,
  resolveSceneTargetVisual,
  toggleSceneTargetState,
  transferSceneTarget,
};

const DOMAIN_TO_CATEGORY: Readonly<Record<string, Category>> = {
  light: 'lights',
  switch: 'outlets',
  input_boolean: 'outlets',
  climate: 'climate',
  fan: 'climate',
  cover: 'covers',
  lock: 'security',
  media_player: 'media',
  water_heater: 'water',
};

export function missingSceneTargetAccessory(id: string, setting: unknown): HausAccessory {
  const domain = inferSceneTargetDomain(id, setting);
  const category: Category = DOMAIN_TO_CATEGORY[domain] ?? 'other';
  const name = missingSceneTargetName(id);
  const entityId = `${domain === 'other' ? 'switch' : domain}.unavailable`;
  return {
    id: `missing:${id}`,
    primaryEntityId: entityId,
    entityIds: [entityId],
    category,
    name,
    availability: 'unavailable',
    capabilities: [],
    state: {
      entity_id: entityId,
      state: 'unavailable',
      attributes: { friendly_name: name },
      last_changed: '',
    },
    secondaryEntities: [],
  };
}

export function scenePreviewAccessory(
  id: string,
  entity: HassEntity,
  owner: HausAccessory | undefined,
  setting: unknown,
  useSetting: boolean,
): HausAccessory {
  const rawDraft = useSetting ? sceneTargetEntity(entity, setting) : entity;
  const domain = id.split('.')[0] ?? 'other';
  const attrs = { ...rawDraft.attributes };
  if (useSetting && domain === 'climate' && attrs.temperature != null) {
    delete attrs.current_temperature;
  }
  if (useSetting && domain === 'media_player' && targetConfig(setting).media_title == null) {
    delete attrs.media_title;
  }
  const name = String(entity.attributes.friendly_name ?? owner?.name ?? id);
  return {
    id: owner?.id ?? id,
    deviceId: owner?.deviceId,
    primaryEntityId: id,
    entityIds: [id],
    areaId: owner?.areaId,
    manufacturer: owner?.manufacturer,
    model: owner?.model,
    deviceType: owner?.deviceType,
    category: owner?.category ?? DOMAIN_TO_CATEGORY[domain] ?? 'other',
    name,
    availability: useSetting
      ? 'available'
      : entity.state === 'unavailable'
        ? 'unavailable'
        : entity.state === 'unknown'
          ? 'unknown'
          : 'available',
    capabilities: owner?.capabilities ?? [],
    state: { ...rawDraft, attributes: attrs },
    secondaryEntities: [],
  };
}

export function describeSceneTarget(
  id: string,
  entity: HassEntity | undefined,
  setting: unknown,
): string {
  const fallback = entity
    ? describeAccessory(scenePreviewAccessory(id, entity, undefined, setting, true))
    : undefined;
  return describeSceneTargetState(id, entity, setting, fallback);
}
