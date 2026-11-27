/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import {
  isUnassignedRoomId,
  readExplicitNameAssignment,
  readExplicitRoomAssignment,
  reconcileDeviceUserAssignments,
  type HausDevice,
} from '@haus/core';
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
    for (const dup of duplicates) {
      nextCanonical = reconcileDeviceUserAssignments(dup, nextCanonical);
    }
    if (!readExplicitRoomAssignment(nextCanonical) && isUnassignedRoomId(nextCanonical.roomId)) {
      const donorWithRoom = duplicates.find((dup) => !isUnassignedRoomId(dup.roomId));
      if (donorWithRoom?.roomId) {
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

const stashedMqttAssignments = new WeakMap<object, Map<string, HausDevice>>();

/** Stashes explicit user room/name assignments before MQTT topic removal so transient add-on restarts preserve them. */
export function stashAndRemoveMqttDevice(
  homeService: HomeDeduplicateHost | undefined,
  device: HausDevice,
): void {
  if (!homeService) return;
  if (readExplicitRoomAssignment(device) || readExplicitNameAssignment(device)) {
    let bucket = stashedMqttAssignments.get(homeService);
    if (!bucket) {
      bucket = new Map();
      stashedMqttAssignments.set(homeService, bucket);
    }
    bucket.set(device.id, device);
    if (device.source.externalId) bucket.set(`ext:${device.source.externalId}`, device);
  }
  homeService.removeDevice(device.id);
}

/** Restores stashed user room/name assignments when an MQTT device re-registers after transient removal. */
export function restoreStashedMqttAssignments(
  homeService: object | undefined,
  rawDevId: string,
  device: HausDevice,
): HausDevice {
  if (!homeService) return device;
  const bucket = stashedMqttAssignments.get(homeService);
  if (!bucket) return device;
  const donor = bucket.get(device.id) ?? bucket.get(`ext:${rawDevId}`);
  if (!donor) return device;
  bucket.delete(device.id);
  bucket.delete(`ext:${rawDevId}`);
  return reconcileDeviceUserAssignments(donor, device);
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
