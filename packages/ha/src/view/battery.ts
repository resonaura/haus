/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { batteryChargingValue, batteryNameScore, effectiveArea, friendlyName } from './matchers.js';
import type { Device, EntityRegistryEntry, HassEntity, HausAccessory, Snapshot } from './types.js';

export function associateBatteries(
  snapshot: Snapshot,
  accessories: HausAccessory[],
  registry: Map<string, EntityRegistryEntry>,
  devices: ReadonlyMap<string, Device>,
): void {
  const batteryEntities = snapshot.states.filter((entity) => {
    const entry = registry.get(entity.entity_id);
    return (
      entity.attributes.device_class === 'battery' &&
      !entry?.disabled_by &&
      !entry?.hidden_by &&
      Number.isFinite(Number(entity.state)) &&
      Number(entity.state) >= 0 &&
      Number(entity.state) <= 100
    );
  });
  const batteryChargingEntities = snapshot.states.filter((entity) => {
    const entry = registry.get(entity.entity_id);
    return (
      entity.attributes.device_class === 'battery_charging' &&
      !entry?.disabled_by &&
      !entry?.hidden_by &&
      batteryChargingValue(entity) !== undefined
    );
  });
  const accessoryBatteryEntities = new Map<string, HassEntity[]>();
  const accessoryBatteryChargingEntities = new Map<string, HassEntity[]>();
  const accessoryByDevice = new Map<string, HausAccessory>();
  for (const accessory of accessories) {
    if (!accessory.deviceId) continue;
    const current = accessoryByDevice.get(accessory.deviceId);
    const currentDomain = current?.primaryEntityId.split('.')[0];
    const nextDomain = accessory.primaryEntityId.split('.')[0];
    if (
      !current ||
      (['switch', 'input_boolean'].includes(currentDomain ?? '') &&
        !['switch', 'input_boolean'].includes(nextDomain))
    )
      accessoryByDevice.set(accessory.deviceId, accessory);
  }
  const associateBatteryEntity = (battery: HassEntity) => {
    const entry = registry.get(battery.entity_id);
    let deviceId = entry?.device_id ?? undefined;
    const visited = new Set<string>();
    let owner: HausAccessory | undefined;
    while (deviceId && !visited.has(deviceId)) {
      visited.add(deviceId);
      owner = accessoryByDevice.get(deviceId);
      if (owner) break;
      deviceId = devices.get(deviceId)?.parent_device_id ?? undefined;
    }
    if (!owner) {
      const batteryDevice = entry?.device_id ? devices.get(entry.device_id) : undefined;
      const label = String(
        batteryDevice?.name_by_user || batteryDevice?.name || friendlyName(battery),
      );
      const batteryArea = effectiveArea(entry, devices);
      const scored = accessories
        .filter((item) => !batteryArea || !item.areaId || item.areaId === batteryArea)
        .map((item) => {
          const ownerDevice = item.deviceId ? devices.get(item.deviceId) : undefined;
          const names = [
            item.name,
            item.state.attributes.friendly_name,
            ownerDevice?.name,
            ownerDevice?.name_by_user,
          ].filter((name): name is string => typeof name === 'string');
          return { item, score: batteryNameScore(label, names) };
        })
        .sort((a, b) => b.score - a.score);
      if (scored[0]?.score >= 0.75 && scored[0].score > (scored[1]?.score ?? 0))
        owner = scored[0].item;
    }
    if (!owner) return;
    const destination =
      battery.attributes.device_class === 'battery_charging'
        ? accessoryBatteryChargingEntities
        : accessoryBatteryEntities;
    destination.set(owner.id, [...(destination.get(owner.id) ?? []), battery]);
  };
  for (const battery of [...batteryEntities, ...batteryChargingEntities])
    associateBatteryEntity(battery);
  for (let index = 0; index < accessories.length; index += 1) {
    const accessory = accessories[index];
    const batteryReadings = accessoryBatteryEntities.get(accessory.id) ?? [];
    const batteryChargingReadings = accessoryBatteryChargingEntities.get(accessory.id) ?? [];
    const levels = batteryReadings.map((item) => Number(item.state)).filter(Number.isFinite);
    const attributeCharging = [accessory.state, ...batteryReadings]
      .map((item) => item.attributes.is_charging)
      .find((value): value is boolean => typeof value === 'boolean');
    if (
      batteryReadings.length ||
      batteryChargingReadings.length ||
      attributeCharging !== undefined
    ) {
      const charging =
        batteryChargingReadings.map(batteryChargingValue).find((value) => value !== undefined) ??
        attributeCharging;
      const relatedBatteryEntities = [...batteryReadings, ...batteryChargingReadings];
      accessories[index] = {
        ...accessory,
        entityIds: [
          ...new Set([
            ...accessory.entityIds,
            ...relatedBatteryEntities.map((item) => item.entity_id),
          ]),
        ],
        secondaryEntities: [
          ...accessory.secondaryEntities,
          ...relatedBatteryEntities.filter(
            (battery) =>
              !accessory.secondaryEntities.some((item) => item.entity_id === battery.entity_id),
          ),
        ],
        ...(levels.length ? { batteryLevel: Math.min(...levels) } : {}),
        ...(charging !== undefined ? { batteryCharging: charging } : {}),
      };
    }
  }
}
