/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { entityDomain } from './capabilities.js';
import { isScaleReading, isSoftwareMediaEndpoint, knownScaleReading } from './device-telemetry.js';
import { friendlyName, isSecondary } from './matchers.js';
import { isStatefulScene } from './scene.js';
import type { Device, EntityRegistryEntry, HausAccessory, HausModel, Snapshot } from './types.js';

export function collectAttention(
  snapshot: Snapshot,
  registry: Map<string, EntityRegistryEntry>,
  devices: ReadonlyMap<string, Device>,
  activityReplaced: ReadonlySet<string>,
  accessories: readonly HausAccessory[],
): HausModel['attention'] {
  const attention: HausModel['attention'] = [];
  for (const entity of snapshot.states) {
    if (activityReplaced.has(entity.entity_id)) continue;
    const entry = registry.get(entity.entity_id);
    if (entry?.disabled_by || entry?.hidden_by) continue;
    const name = entry?.name || friendlyName(entity);
    const deviceClass = entity.attributes.device_class;
    if (
      deviceClass === 'battery' &&
      Number.isFinite(Number(entity.state)) &&
      Number(entity.state) <= 20
    ) {
      attention.push({
        id: `${entity.entity_id}:battery`,
        title: `${name} is low`,
        description: `${entity.state}% battery remaining`,
        entityId: entity.entity_id,
        severity: 'warning',
      });
    }
    if (
      entityDomain(entity) === 'binary_sensor' &&
      entity.state === 'on' &&
      ['moisture', 'smoke', 'gas', 'carbon_monoxide'].includes(String(deviceClass))
    ) {
      attention.push({
        id: `${entity.entity_id}:safety`,
        title: `${name} detected`,
        description: 'Check this sensor in your home.',
        entityId: entity.entity_id,
        severity: 'critical',
      });
    }
    if (entity.state === 'unavailable' && !isSecondary(entry)) {
      if (isSoftwareMediaEndpoint(entity, entry)) continue;
      const owner = accessories.find((accessory) => accessory.entityIds.includes(entity.entity_id));
      if (
        owner &&
        (owner.primaryEntityId !== entity.entity_id || owner.availability !== 'unavailable')
      )
        continue;
      const dev = entry?.device_id ? devices.get(entry.device_id) : undefined;
      if (owner && isScaleReading(entity, dev) && knownScaleReading(owner.secondaryEntities, dev))
        continue;
      if (isStatefulScene(entity, entry, dev)) continue;
      attention.push({
        id: `${entity.entity_id}:unavailable`,
        title: `${name} is offline`,
        description: 'Home Assistant cannot reach this accessory.',
        entityId: entity.entity_id,
        severity: 'warning',
      });
    }
  }
  return attention;
}
