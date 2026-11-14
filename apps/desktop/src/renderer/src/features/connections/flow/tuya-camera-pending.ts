/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { IntegrationEntry } from '../../../ha/management';
import type { Device, EntityRegistryEntry, HassEntity, Snapshot } from '../../../model';
import { cameraRelationships } from '../../../model/device-relationships';
import {
  isCameraDpEntity,
  providerBridgeId,
  type TuyaBridgeCamera,
  type TuyaBridgeProvider,
} from './tuya-cameras';

export type TuyaCameraPendingReason =
  'bridge_missing' | 'bridge_login_required' | 'camera_unimported';

export interface TuyaPendingCamera {
  deviceId: string;
  deviceName: string;
  entryId?: string;
  reason: TuyaCameraPendingReason;
  bridgeId?: string;
  physicalId?: string;
}

export interface PendingTuyaCamerasInput {
  snapshot: Snapshot;
  tuyaEntryIds?: ReadonlyArray<string>;
  disabledEntryIds?: ReadonlyArray<string>;
  pairedProviders?: ReadonlyArray<TuyaBridgeProvider>;
  pairedBridgeCameras?: Record<string, ReadonlyArray<TuyaBridgeCamera>>;
}

/** Splits config entries into active vs disabled Tuya entry IDs. */
export function splitTuyaEntryIds(
  entries: ReadonlyArray<Pick<IntegrationEntry, 'entry_id' | 'domain' | 'disabled_by'>>,
): { tuyaEntryIds: string[]; disabledTuyaEntryIds: string[] } {
  const tuyaEntryIds: string[] = [];
  const disabledTuyaEntryIds: string[] = [];
  for (const entry of entries) {
    if (entry.domain !== 'tuya') continue;
    if (entry.disabled_by) disabledTuyaEntryIds.push(entry.entry_id);
    else tuyaEntryIds.push(entry.entry_id);
  }
  return { tuyaEntryIds, disabledTuyaEntryIds };
}

const normalizeCameraName = (value: unknown): string =>
  String(value ?? '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const deviceConfigEntryIds = (device: Device): string[] =>
  Array.isArray(device.config_entries)
    ? device.config_entries.filter((value): value is string => typeof value === 'string')
    : [];

const isHubStubCamera = (device: Device, entities: ReadonlyArray<EntityRegistryEntry>): boolean =>
  device.id.startsWith('tuya:') ||
  entities.some(
    (entry) => typeof entry.unique_id === 'string' && entry.unique_id.startsWith('ep_tuya_'),
  );

const isTuyaEntityMarker = (
  entry: EntityRegistryEntry,
  knownTuyaEntries: ReadonlySet<string>,
): boolean =>
  entry.platform === 'tuya' ||
  (typeof entry.config_entry_id === 'string' && knownTuyaEntries.has(entry.config_entry_id)) ||
  (typeof entry.unique_id === 'string' && entry.unique_id.startsWith('ep_tuya_'));

function collectKnownTuyaEntryIds(
  snapshot: Snapshot,
  explicitIds?: ReadonlyArray<string>,
): Set<string> {
  const known = new Set<string>(explicitIds ?? []);
  for (const entity of snapshot.entities) {
    if (entity.disabled_by) continue;
    const isTuya =
      entity.platform === 'tuya' ||
      (typeof entity.unique_id === 'string' && entity.unique_id.startsWith('ep_tuya_'));
    if (isTuya && typeof entity.config_entry_id === 'string' && entity.config_entry_id) {
      known.add(entity.config_entry_id);
    }
  }
  for (const device of snapshot.devices) {
    if (!device.id.startsWith('tuya:')) continue;
    for (const id of deviceConfigEntryIds(device)) known.add(id);
  }
  return known;
}

function deviceHasNativeHaCamera(
  device: Device,
  devEntities: ReadonlyArray<EntityRegistryEntry>,
  entityById: ReadonlyMap<string, EntityRegistryEntry>,
  stateById: ReadonlyMap<string, HassEntity>,
  entityOwners: ReadonlyMap<string, string>,
): boolean {
  if (isHubStubCamera(device, devEntities)) return false;

  const isNativeCameraState = (entityId: string): boolean => {
    const reg = entityById.get(entityId);
    if (!reg || reg.platform === 'tuya') return false;
    if (typeof reg.unique_id === 'string' && reg.unique_id.startsWith('ep_tuya_')) return false;
    return stateById.get(entityId)?.attributes?.haus_native_camera === 1;
  };

  for (const ent of devEntities) {
    if (ent.entity_id.startsWith('camera.') && isNativeCameraState(ent.entity_id)) return true;
    const ownerCameraId = entityOwners.get(ent.entity_id);
    if (ownerCameraId && isNativeCameraState(ownerCameraId)) return true;
  }
  return false;
}

function matchBridgeCamera(
  device: Device,
  devEntities: ReadonlyArray<EntityRegistryEntry>,
  bridgeCams: ReadonlyArray<{ bridgeId: string; cam: TuyaBridgeCamera }>,
): { bridgeId: string; cam: TuyaBridgeCamera } | undefined {
  const devEntityIds = new Set(devEntities.map((entry) => entry.entity_id));
  for (const item of bridgeCams) {
    if (item.cam.existingCameraId && devEntityIds.has(item.cam.existingCameraId)) return item;
  }

  const rawTuyaId = device.id.startsWith('tuya:') ? device.id.slice('tuya:'.length) : '';
  const identifiers = new Set<string>();
  if (Array.isArray(device.identifiers)) {
    for (const pair of device.identifiers) {
      if (Array.isArray(pair) && typeof pair[1] === 'string') identifiers.add(pair[1]);
    }
  }
  for (const item of bridgeCams) {
    if ((rawTuyaId && item.cam.physicalId === rawTuyaId) || identifiers.has(item.cam.physicalId)) {
      return item;
    }
  }

  const names = new Set(
    [device.name_by_user, device.name].map(normalizeCameraName).filter(Boolean),
  );
  if (names.size > 0) {
    const matchedByName = bridgeCams.filter((item) =>
      names.has(normalizeCameraName(item.cam.name)),
    );
    if (matchedByName.length === 1) return matchedByName[0];
  }
  return undefined;
}

function collectNativeCameraNames(
  snapshot: Snapshot,
  entitiesByDevice: ReadonlyMap<string, EntityRegistryEntry[]>,
  entityById: ReadonlyMap<string, EntityRegistryEntry>,
  stateById: ReadonlyMap<string, HassEntity>,
  entityOwners: ReadonlyMap<string, string>,
): Set<string> {
  const names = new Set<string>();
  for (const device of snapshot.devices) {
    const devEntities = entitiesByDevice.get(device.id) ?? [];
    if (!deviceHasNativeHaCamera(device, devEntities, entityById, stateById, entityOwners)) {
      continue;
    }
    for (const raw of [device.name_by_user, device.name]) {
      const normalized = normalizeCameraName(raw);
      if (normalized) names.add(normalized);
    }
    for (const ent of devEntities) {
      if (!ent.entity_id.startsWith('camera.')) continue;
      const friendly = normalizeCameraName(stateById.get(ent.entity_id)?.attributes?.friendly_name);
      if (friendly) names.add(friendly);
    }
  }
  return names;
}

/** Fast synchronous check indicating whether a snapshot contains any Tuya camera candidate devices. */
export function hasTuyaCameraCandidates(
  snapshot: Snapshot,
  explicitTuyaEntryIds?: ReadonlyArray<string>,
  disabledEntryIds?: ReadonlyArray<string>,
): boolean {
  const disabledEntries = new Set(disabledEntryIds ?? []);
  const knownTuyaEntries = collectKnownTuyaEntryIds(snapshot, explicitTuyaEntryIds);
  const tuyaDeviceIds = new Set(
    snapshot.devices
      .filter((dev) => {
        const cfgIds = deviceConfigEntryIds(dev).filter((id) => knownTuyaEntries.has(id));
        if (cfgIds.length > 0 && cfgIds.every((id) => disabledEntries.has(id))) return false;
        return dev.id.startsWith('tuya:') || cfgIds.length > 0;
      })
      .map((dev) => dev.id),
  );

  for (const ent of snapshot.entities) {
    if (ent.disabled_by || !isCameraDpEntity(ent)) continue;
    if (typeof ent.config_entry_id === 'string' && disabledEntries.has(ent.config_entry_id)) {
      continue;
    }
    if (ent.device_id && tuyaDeviceIds.has(ent.device_id)) return true;
    if (!ent.device_id && isTuyaEntityMarker(ent, knownTuyaEntries)) return true;
  }
  return false;
}

/**
 * Identifies Tuya camera devices whose native Tuya Camera Bridge onboarding is still incomplete
 * (e.g. skipped after QR sign-in, bridge unpaired/unauthenticated, or individual cameras unimported).
 */
export function findPendingTuyaCameras({
  snapshot,
  tuyaEntryIds,
  disabledEntryIds,
  pairedProviders = [],
  pairedBridgeCameras = {},
}: PendingTuyaCamerasInput): TuyaPendingCamera[] {
  const disabledEntries = new Set(disabledEntryIds ?? []);
  const knownTuyaEntries = collectKnownTuyaEntryIds(snapshot, tuyaEntryIds);
  const entityById = new Map(snapshot.entities.map((entry) => [entry.entity_id, entry]));
  const stateById = new Map(snapshot.states.map((state) => [state.entity_id, state]));
  const entitiesByDevice = new Map<string, EntityRegistryEntry[]>();

  for (const ent of snapshot.entities) {
    if (ent.disabled_by || !ent.device_id) continue;
    const list = entitiesByDevice.get(ent.device_id) ?? [];
    list.push(ent);
    entitiesByDevice.set(ent.device_id, list);
  }

  const relationships = cameraRelationships(snapshot);
  const nativeCameraNames = collectNativeCameraNames(
    snapshot,
    entitiesByDevice,
    entityById,
    stateById,
    relationships.entityOwners,
  );
  const tuyaBridges = pairedProviders.filter((item) => item.provider === 'tuya');
  const loadedBridgeCams: Array<{ bridgeId: string; cam: TuyaBridgeCamera }> = [];
  let anyBridgePreviewLoaded = false;
  for (const bridge of tuyaBridges) {
    const id = providerBridgeId(bridge);
    if (!id) continue;
    if (Object.hasOwn(pairedBridgeCameras, id)) anyBridgePreviewLoaded = true;
    for (const cam of pairedBridgeCameras[id] ?? []) {
      loadedBridgeCams.push({ bridgeId: id, cam });
    }
  }
  const bridgeReportsCamerasWithoutPreview =
    !anyBridgePreviewLoaded &&
    tuyaBridges.some((bridge) => typeof bridge.cameras === 'number' && bridge.cameras > 0);

  const pending: TuyaPendingCamera[] = [];
  for (const device of snapshot.devices) {
    const devEntities = entitiesByDevice.get(device.id) ?? [];
    const belongsToTuya =
      device.id.startsWith('tuya:') ||
      deviceConfigEntryIds(device).some((id) => knownTuyaEntries.has(id)) ||
      devEntities.some((ent) => isTuyaEntityMarker(ent, knownTuyaEntries));
    if (!belongsToTuya) continue;
    if (!devEntities.some((ent) => isCameraDpEntity(ent))) continue;

    const entryId =
      deviceConfigEntryIds(device).find((id) => knownTuyaEntries.has(id)) ??
      devEntities
        .map((ent) => ent.config_entry_id)
        .find((id): id is string => typeof id === 'string' && knownTuyaEntries.has(id));
    if (entryId && disabledEntries.has(entryId)) continue;
    const matchedDisabled = deviceConfigEntryIds(device).filter((id) => knownTuyaEntries.has(id));
    if (matchedDisabled.length > 0 && matchedDisabled.every((id) => disabledEntries.has(id))) {
      continue;
    }

    const nativeReady = deviceHasNativeHaCamera(
      device,
      devEntities,
      entityById,
      stateById,
      relationships.entityOwners,
    );
    const hasMatchingNativeCamera =
      nativeReady ||
      [device.name_by_user, device.name]
        .map(normalizeCameraName)
        .some((name) => Boolean(name && nativeCameraNames.has(name)));
    const deviceName = device.name_by_user || device.name || device.id;

    if (tuyaBridges.length === 0) {
      if (nativeReady) continue;
      pending.push({ deviceId: device.id, deviceName, entryId, reason: 'bridge_missing' });
      continue;
    }

    if (loadedBridgeCams.length === 0) {
      if (hasMatchingNativeCamera) continue;
      pending.push({
        deviceId: device.id,
        deviceName,
        entryId,
        reason: bridgeReportsCamerasWithoutPreview ? 'camera_unimported' : 'bridge_login_required',
        bridgeId: providerBridgeId(tuyaBridges[0]),
      });
      continue;
    }

    const matched = matchBridgeCamera(device, devEntities, loadedBridgeCams);
    if (matched) {
      if (matched.cam.imported) continue;
      pending.push({
        deviceId: device.id,
        deviceName,
        entryId,
        reason: 'camera_unimported',
        bridgeId: matched.bridgeId,
        physicalId: matched.cam.physicalId,
      });
      continue;
    }

    if (nativeReady || loadedBridgeCams.every((item) => item.cam.imported)) continue;
    pending.push({
      deviceId: device.id,
      deviceName,
      entryId,
      reason: 'camera_unimported',
      bridgeId: loadedBridgeCams.find((item) => !item.cam.imported)?.bridgeId,
    });
  }

  return pending;
}

export function tuyaPendingCopy(reason: TuyaCameraPendingReason): {
  badge: string;
  action: string;
  detail: string;
} {
  if (reason === 'bridge_login_required') {
    return {
      badge: 'Setup incomplete',
      action: 'Finish setup',
      detail: 'Tuya Camera Bridge needs QR sign-in before live video and recordings work.',
    };
  }
  if (reason === 'camera_unimported') {
    return {
      badge: 'Setup incomplete',
      action: 'Finish setup',
      detail: 'Select and import this camera from Tuya Camera Bridge to enable live video.',
    };
  }
  return {
    badge: 'Setup incomplete',
    action: 'Finish setup',
    detail: 'Install or connect Tuya Camera Bridge to enable live video, audio, and recordings.',
  };
}

export function groupPendingByDevice(
  items: ReadonlyArray<TuyaPendingCamera>,
): Map<string, TuyaPendingCamera> {
  return new Map(items.map((item) => [item.deviceId, item]));
}

export function groupPendingByEntry(
  items: ReadonlyArray<TuyaPendingCamera>,
): Map<string, TuyaPendingCamera[]> {
  const map = new Map<string, TuyaPendingCamera[]>();
  for (const item of items) {
    const key = item.entryId ?? 'tuya';
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

export { notifyPendingTuyaCamerasChanged, usePendingTuyaCameras } from './use-pending-tuya-cameras';
