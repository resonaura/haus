/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isDeepStrictEqual } from 'node:util';
import { normalizeDeviceEndpointsForHap, type HausDevice, type SourceServiceRef } from '@haus/core';
import type { HaRuntimeEntity } from '@haus/kitsune';
import type { StandaloneHomeService } from '../../home/home.service.js';
import type { IntegrationEntryState } from '../entry-helpers.js';

/** Prunes stale HA sub-devices whose endpoints were all absorbed by another active device in the same entry. */
export function pruneSupersededHaDevices(
  home: StandaloneHomeService | undefined,
  enabledEntries: ReadonlySet<string>,
  present: ReadonlySet<string>,
  inProgressInstances: ReadonlySet<string>,
): number {
  if (!home || present.size === 0) return 0;
  let pruned = 0;
  for (const device of home.devices.listDevices()) {
    if (!device.source.instanceId.startsWith('ha:')) continue;
    const entryId = device.source.instanceId.slice(3);
    if (!enabledEntries.has(entryId) || inProgressInstances.has(device.source.instanceId)) continue;
    if (present.has(device.id) || device.endpoints.length === 0) continue;
    const allAbsorbed = device.endpoints.every((ep) => {
      const owner = home.devices.getDeviceByEndpointId(ep.id);
      return (
        owner !== undefined &&
        owner.id !== device.id &&
        owner.source.instanceId === device.source.instanceId &&
        present.has(owner.id)
      );
    });
    if (allAbsorbed && home.removeDevice(device.id)) pruned += 1;
  }
  return pruned;
}

export function mapHaEntryState(rawState: string): IntegrationEntryState {
  if (rawState === 'loaded') return 'loaded';
  if (rawState === 'setup_retry') return 'setup_retry';
  if (rawState === 'not_loaded' || rawState === 'setup_in_progress') return 'not_loaded';
  return 'setup_error';
}

export function deviceStructureChanged(
  existing: HausDevice | undefined,
  next: HausDevice,
): boolean {
  if (!existing) return true;
  if (
    existing.name !== next.name ||
    existing.availability !== next.availability ||
    existing.roomId !== next.roomId ||
    existing.category !== next.category ||
    existing.manufacturer !== next.manufacturer ||
    existing.model !== next.model ||
    existing.endpoints.length !== next.endpoints.length
  ) {
    return true;
  }
  for (let i = 0; i < next.endpoints.length; i += 1) {
    const a = existing.endpoints[i];
    const b = next.endpoints[i];
    if (
      !a ||
      !b ||
      a.id !== b.id ||
      a.name !== b.name ||
      a.category !== b.category ||
      a.availability !== b.availability ||
      !isDeepStrictEqual(a.sourceOwner, b.sourceOwner) ||
      !isDeepStrictEqual(a.capabilities, b.capabilities)
    ) {
      return true;
    }
  }
  return false;
}

export function normalizeHaDevice(input: {
  readonly device: HausDevice;
  readonly existing: HausDevice | undefined;
  readonly entity: HaRuntimeEntity;
  readonly deviceEntities: readonly HaRuntimeEntity[];
  readonly source: SourceServiceRef;
  readonly roomId: string;
}): HausDevice {
  const { device, existing, entity, deviceEntities, source, roomId } = input;
  const states = deviceEntities.map((item) => item.state);
  const statelessReady = deviceEntities.some(
    (item) =>
      item.state === 'unknown' && ['notify', 'event', 'button', 'scene'].includes(item.domain),
  );
  const resolvedName = existing?.name ?? entity.deviceName ?? device.name;
  const rawNames = new Map(deviceEntities.map((item) => [item.entityId, item.name]));
  const rawEndpoints = device.endpoints.map((endpoint) => ({
    ...endpoint,
    name: rawNames.get(endpoint.id) ?? endpoint.name,
    sourceOwner: source,
  }));
  const endpoints = normalizeDeviceEndpointsForHap({
    name: resolvedName,
    category: device.category,
    model: entity.model ?? existing?.model ?? device.model,
    endpoints: rawEndpoints,
  });
  return {
    ...device,
    availability:
      states.some((state) => state !== 'unavailable' && state !== 'unknown') || statelessReady
        ? 'online'
        : states.includes('unavailable')
          ? 'offline'
          : 'unknown',
    name: resolvedName,
    source: { instanceId: `ha:${entity.entryId}`, externalId: entity.deviceId },
    sourceRefs: [
      { protocol: 'vendor', instanceId: entity.integration, externalId: entity.deviceId },
    ],
    manufacturer: entity.manufacturer,
    model: entity.model,
    roomId: existing?.roomId ?? roomId,
    endpoints,
  };
}
