/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { readExplicitRoomAssignment, type HausDevice } from '@haus/core';
import { consolidateLegacyMqttDevices, sanitizeMqttId } from '@haus/mqtt';
import type { StandaloneHomeService } from '../home/home.service.js';
import type { MqttIdentities } from './identity.js';
import { mqttOwned } from './sources.js';

interface HomePruneHost {
  listDevices(): readonly HausDevice[];
  registerDevice(device: HausDevice): HausDevice;
}

interface HomeDeduplicateHost extends HomePruneHost {
  getDevice(deviceId: string): HausDevice | undefined;
  removeDevice(deviceId: string): boolean;
  removeEndpointState?(endpointId: string): void;
}

/** True when a device already carries endpoints materialized by modern MQTT discovery. */
export function hasDiscoveredMqttEndpoints(device: HausDevice): boolean {
  return device.endpoints.some((endpoint) =>
    endpoint.sourceRefs?.some((ref) => ref.protocol === 'mqtt' && Boolean(ref.domain)),
  );
}

/**
 * Strips any synthetic hash-suffixed self-reference (`<externalId>-<hash>`) that legacy
 * startup consolidation may have attached when running on a node without identity records.
 */
export function withoutSyntheticHashSourceRef(device: HausDevice): HausDevice {
  if (device.source.instanceId !== 'haus-mqtt' || !device.sourceRefs?.length) return device;
  const rawExternalId = device.source.externalId;
  const sanitizedPrefix = `${sanitizeMqttId(rawExternalId)}-`;
  const strippedId = device.id.replace(/^mqtt_/, '');
  if (!strippedId.startsWith(sanitizedPrefix)) return device;
  const filtered = device.sourceRefs.filter(
    (ref) => !(ref.protocol === 'mqtt' && !ref.metadata && ref.externalId === strippedId),
  );
  return filtered.length === device.sourceRefs.length
    ? device
    : { ...device, sourceRefs: filtered };
}

/**
 * Removes superseded duplicate `haus-mqtt` device records that share the same physical
 * `source.externalId` as `canonicalId`, preserving any user room assignment.
 */
export function deduplicateMqttDeviceForExternalId(
  homeService: HomeDeduplicateHost,
  canonicalId: string,
  rawExternalId: string,
): number {
  const duplicates = homeService
    .listDevices()
    .filter(
      (device) =>
        device.id !== canonicalId &&
        device.source.instanceId === 'haus-mqtt' &&
        device.source.externalId === rawExternalId &&
        device.endpoints.every(mqttOwned),
    );
  if (duplicates.length === 0) return 0;

  const canonical = homeService.getDevice(canonicalId);
  if (canonical) {
    let nextCanonical = withoutSyntheticHashSourceRef(canonical);
    if (!readExplicitRoomAssignment(nextCanonical)) {
      const explicitRoom = duplicates.map((dup) => readExplicitRoomAssignment(dup)).find(Boolean);
      const donorWithRoom = duplicates.find((dup) =>
        Boolean(dup.roomId && dup.roomId !== 'unassigned'),
      );
      if (explicitRoom) {
        const roomId = explicitRoom.roomId;
        nextCanonical = {
          ...nextCanonical,
          roomId,
          areaId: roomId !== 'unassigned' ? roomId : undefined,
          opaqueMetadata: {
            ...nextCanonical.opaqueMetadata,
            roomAssignment: explicitRoom,
          },
        };
      } else if (
        (!nextCanonical.roomId || nextCanonical.roomId === 'unassigned') &&
        donorWithRoom?.roomId
      ) {
        nextCanonical = {
          ...nextCanonical,
          roomId: donorWithRoom.roomId,
          areaId: donorWithRoom.roomId,
        };
      }
    }
    if (nextCanonical !== canonical) {
      homeService.registerDevice(nextCanonical);
    }
  }

  const canonicalEndpointIds = new Set(
    (homeService.getDevice(canonicalId)?.endpoints ?? []).map((ep) => ep.id),
  );
  for (const dup of duplicates) {
    homeService.removeDevice(dup.id);
    for (const ep of dup.endpoints) {
      if (!canonicalEndpointIds.has(ep.id)) {
        homeService.removeEndpointState?.(ep.id);
      }
    }
  }
  return duplicates.length;
}

/**
 * Runs startup MQTT deduplication and legacy pre-discovery entity consolidation without
 * mutating or re-synthesizing modern discovery-managed devices.
 */
export async function runStartupMqttConsolidation(
  home: StandaloneHomeService,
  identities: MqttIdentities,
): Promise<{ readonly consolidated: number; readonly deduplicated: number }> {
  const managed = await identities.managedDevices();
  const byExternalId = new Map<string, HausDevice[]>();
  for (const device of home.listDevices()) {
    if (device.source.instanceId !== 'haus-mqtt' || !device.source.externalId) continue;
    const group = byExternalId.get(device.source.externalId) ?? [];
    group.push(device);
    byExternalId.set(device.source.externalId, group);
  }

  const canonicalExternalIds = new Set<string>();
  let deduplicated = 0;
  for (const [externalId, group] of byExternalId) {
    const canonical =
      group.find((device) => managed.has(device.id)) ??
      group.find((device) => hasDiscoveredMqttEndpoints(device));
    if (!canonical) continue;
    canonicalExternalIds.add(externalId);
    const cleaned = withoutSyntheticHashSourceRef(canonical);
    if (cleaned !== canonical) {
      home.registerDevice(cleaned);
    }
    deduplicated += deduplicateMqttDeviceForExternalId(home, canonical.id, externalId);
  }

  const consolidated = consolidateLegacyMqttDevices({
    listDevices: () =>
      home
        .listDevices()
        .filter(
          (device) =>
            !managed.has(device.id) &&
            !hasDiscoveredMqttEndpoints(device) &&
            !(
              device.source.instanceId === 'haus-mqtt' &&
              canonicalExternalIds.has(device.source.externalId)
            ) &&
            device.endpoints.every(mqttOwned),
        ),
    registerDevice: (device) => home.registerDevice(device),
    removeDevice: (id) => home.removeDevice(id),
    getEndpointState: (id) => home.getEndpointState(id),
    updateEndpointState: (id, patch, dispatch) => home.updateEndpointState(id, patch, dispatch),
  });

  return { consolidated, deduplicated };
}

/** Remove unplayable placeholder `_camera` endpoints left by legacy MQTT name heuristics. */
export function pruneSyntheticVideoEndpoints(
  homeService: HomePruneHost,
  hasBinding: (endpointId: string) => boolean,
  syntheticVideoEndpoints: Set<string>,
): void {
  for (const device of homeService.listDevices()) {
    if (device.source.instanceId !== 'haus-mqtt') continue;
    const kept = device.endpoints.filter(
      (ep) =>
        !(
          ep.id.endsWith('_camera') &&
          !ep.mediaId &&
          !ep.sourceOwner &&
          !ep.sourceRefs?.length &&
          ep.capabilities.length === 1 &&
          ep.capabilities[0]?.id === 'video' &&
          ep.capabilities[0].operations.length === 0 &&
          !hasBinding(ep.id)
        ),
    );
    if (kept.length === device.endpoints.length) continue;
    const removedIds = new Set(
      device.endpoints.filter((ep) => !kept.includes(ep)).map((ep) => ep.id),
    );
    for (const id of removedIds) syntheticVideoEndpoints.delete(id);
    const services = device.services?.filter(
      (svc) => !removedIds.has(svc.id.replace(/^service_/, '')),
    );
    homeService.registerDevice({
      ...device,
      endpoints: kept,
      ...(services ? { services } : {}),
    });
  }
}
