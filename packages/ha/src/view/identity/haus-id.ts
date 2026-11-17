/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  deriveDeviceHausAddress,
  deriveEndpointHausAddress,
  formatAddress,
  parseAddress,
  resolveGlobalDomain,
} from '@haus/core/identity';
import type { Area, Device, EntityRegistryEntry, HassEntity, Snapshot } from '../../types.js';
import { entityDomain } from '../capabilities.js';
import { deviceDisplayName } from '../device-name.js';
import { deviceArea } from '../registry.js';
import type { Category, HausAccessory } from '../types.js';

export interface ResolveDeviceHausIdOptions {
  readonly category?: Category | string | null;
  readonly primaryEntity?: HassEntity;
  readonly areaId?: string | null;
  readonly areas?: readonly Area[];
  readonly devices?: readonly Device[];
  readonly used?: Set<string>;
}

export interface ResolveEntityHausIdOptions {
  readonly entity?: HassEntity;
  readonly entry?: EntityRegistryEntry;
  readonly device?: Device;
  readonly deviceHausId?: string;
  readonly category?: Category | string | null;
  readonly used?: Set<string>;
}

function allocateUniqueAddress(candidate: string, used: Set<string>, isEndpoint: boolean): string {
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const parsed = parseAddress(candidate);
  if (!parsed) {
    let suffix = 2;
    while (used.has(`${candidate}-${suffix}`)) suffix += 1;
    const unique = `${candidate}-${suffix}`;
    used.add(unique);
    return unique;
  }
  for (let suffix = 2; ; suffix += 1) {
    const next = isEndpoint
      ? formatAddress({
          type: parsed.type,
          area: parsed.area,
          device: parsed.device,
          entity: parsed.entity ? `${parsed.entity}-${suffix}` : String(suffix),
        })
      : formatAddress({
          type: parsed.type,
          area: parsed.area,
          device: `${parsed.device}-${suffix}`,
          ...(parsed.entity ? { entity: parsed.entity } : {}),
        });
    if (!used.has(next)) {
      used.add(next);
      return next;
    }
  }
}

function areaNameFor(areas: readonly Area[], areaId?: string | null): string | undefined {
  if (!areaId) return undefined;
  return areas.find((area) => area.area_id === areaId)?.name;
}

function deviceRawName(device: Device): string {
  return String(device.name_by_user || device.name || device.id);
}

function deviceCategoryField(device: Device): string | undefined {
  return typeof device.category === 'string' && device.category.trim()
    ? device.category.trim()
    : undefined;
}

function inferPrimaryEntityForDevice(
  deviceId: string,
  snapshot: Snapshot,
): { entry?: EntityRegistryEntry; state?: HassEntity; domain?: string } {
  const entries = snapshot.entities.filter(
    (entry) => entry.device_id === deviceId && !entry.disabled_by,
  );
  const stateById = new Map(snapshot.states.map((s) => [s.entity_id, s]));
  const preferred =
    entries.find(
      (entry) =>
        !entry.entity_category &&
        !entry.entity_id.startsWith('sensor.') &&
        !entry.entity_id.startsWith('binary_sensor.'),
    ) ??
    entries.find((entry) => !entry.entity_category) ??
    entries[0];
  if (!preferred) return {};
  const state = stateById.get(preferred.entity_id);
  const domain = state ? entityDomain(state) : preferred.entity_id.split('.')[0];
  return { entry: preferred, state, domain };
}

/** Resolves a canonical `type::area:device` Haus ID for an HA or Hub device record. */
export function resolveDeviceHausId(
  device: Device,
  snapshot: Snapshot,
  options: ResolveDeviceHausIdOptions = {},
): string {
  const areas = options.areas ?? snapshot.areas;
  const devices = options.devices ?? snapshot.devices;
  const areaId = options.areaId !== undefined ? options.areaId : deviceArea(device, devices);
  const areaName = areaNameFor(areas, areaId);
  const inferred = options.primaryEntity
    ? undefined
    : inferPrimaryEntityForDevice(device.id, snapshot);
  const primaryDomain = options.primaryEntity
    ? entityDomain(options.primaryEntity)
    : inferred?.domain;
  const displayName = deviceDisplayName(deviceRawName(device), areaName, device.id);
  const base = deriveDeviceHausAddress({
    existingAddress: device.haus_id,
    category: options.category ?? deviceCategoryField(device),
    primaryDomain,
    areaName,
    areaId,
    deviceName: displayName,
    deviceId: device.id,
  });
  return options.used ? allocateUniqueAddress(base, options.used, false) : base;
}

function compatibleExistingEntityAddress(
  entry: EntityRegistryEntry | undefined,
  entityId: string,
  category?: string | null,
): string | undefined {
  if (!entry?.haus_id) return undefined;
  const parsed = parseAddress(entry.haus_id);
  if (!parsed) return undefined;
  const rawDomain = entityId.includes('.') ? entityId.split('.')[0] : undefined;
  const expectedDomain = resolveGlobalDomain(rawDomain, category ?? undefined, 'generic');
  return parsed.type === expectedDomain ? entry.haus_id : undefined;
}

/** Resolves a canonical `type::area:device(:entity)` Haus ID for an entity ID or secondary entity. */
export function resolveEntityHausId(
  entityId: string,
  snapshot: Snapshot,
  options: ResolveEntityHausIdOptions = {},
): string {
  const entry = options.entry ?? snapshot.entities.find((item) => item.entity_id === entityId);
  const entity = options.entity ?? snapshot.states.find((item) => item.entity_id === entityId);
  const device =
    options.device ??
    (entry?.device_id ? snapshot.devices.find((item) => item.id === entry.device_id) : undefined);
  const areaId = entry?.area_id ?? (device ? deviceArea(device, snapshot.devices) : undefined);
  const areaName = areaNameFor(snapshot.areas, areaId);
  const deviceHausId =
    options.deviceHausId ??
    (device ? resolveDeviceHausId(device, snapshot, { areaId }) : undefined);
  const rawName =
    (typeof entity?.attributes?.friendly_name === 'string' && entity.attributes.friendly_name) ||
    entry?.name ||
    entry?.original_name ||
    undefined;
  const base = deriveEndpointHausAddress({
    existingAddress: compatibleExistingEntityAddress(entry, entityId, options.category),
    domain: entity ? entityDomain(entity) : undefined,
    category: options.category ?? (device ? deviceCategoryField(device) : undefined),
    areaName,
    areaId,
    deviceName: device ? deviceDisplayName(deviceRawName(device), areaName, device.id) : undefined,
    deviceId: device?.id,
    entityId,
    entityName: rawName,
    deviceAddress: deviceHausId,
  });
  return options.used ? allocateUniqueAddress(base, options.used, true) : base;
}

/** Populates unique canonical `hausId` and `entityHausIds` across all normalized snapshot accessories. */
export function assignSnapshotHausIds(accessories: HausAccessory[], snapshot: Snapshot): void {
  const areaNameMap = new Map(snapshot.areas.map((area) => [area.area_id, area.name]));
  const deviceById = new Map(snapshot.devices.map((dev) => [dev.id, dev]));
  const entryById = new Map(snapshot.entities.map((entry) => [entry.entity_id, entry]));
  const stateById = new Map(snapshot.states.map((state) => [state.entity_id, state]));
  const usedDeviceAddresses = new Set<string>();
  const usedEntityAddresses = new Set<string>();

  for (const accessory of accessories) {
    const device = accessory.deviceId ? deviceById.get(accessory.deviceId) : undefined;
    const areaName = accessory.areaId ? areaNameMap.get(accessory.areaId) : undefined;
    const baseDeviceAddr = deriveDeviceHausAddress({
      existingAddress: accessory.hausId ?? device?.haus_id,
      category: accessory.category,
      primaryDomain: entityDomain(accessory.state),
      areaName,
      areaId: accessory.areaId,
      deviceName: accessory.name,
      deviceId: accessory.deviceId ?? accessory.id,
    });
    const deviceHausId = allocateUniqueAddress(baseDeviceAddr, usedDeviceAddresses, false);
    accessory.hausId = deviceHausId;

    const entityIds = new Set<string>([
      accessory.primaryEntityId,
      accessory.state.entity_id,
      ...accessory.entityIds,
      ...accessory.secondaryEntities.map((item) => item.entity_id),
    ]);
    const entityHausIds: Record<string, string> = {};
    for (const eid of entityIds) {
      entityHausIds[eid] = resolveEntityHausId(eid, snapshot, {
        entity:
          stateById.get(eid) ?? (accessory.state.entity_id === eid ? accessory.state : undefined),
        entry: entryById.get(eid),
        device,
        deviceHausId,
        category: accessory.category,
        used: usedEntityAddresses,
      });
    }
    accessory.entityHausIds = entityHausIds;
  }
}
