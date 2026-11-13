/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface TuyaCameraRegistryEntity {
  entity_id: string;
  platform?: string;
  config_entry_id?: string | null;
  device_id?: string | null;
  unique_id?: string | null;
  name?: string | null;
  original_name?: string | null;
  disabled_by?: string | null;
}

export interface TuyaCameraRegistryDevice {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  config_entries?: string[];
}

export interface TuyaBridgeProvider {
  id?: string;
  bridgeId?: string;
  name?: string;
  provider: string;
  url: string;
  managed?: boolean;
}

export interface TuyaBridgeCamera {
  physicalId: string;
  name: string;
  available: boolean;
  existingCameraId?: string;
  imported: boolean;
}

export interface TuyaAddonCandidate {
  slug: string;
  name: string;
  state?: string;
  installed?: boolean;
  available?: boolean;
  ingress?: boolean;
  webui?: string | null;
}

export interface DetectedTuyaCamera {
  id: string;
  name: string;
  source: 'ha_entity' | 'bridge';
  imported: boolean;
}

export interface TuyaCameraDetectionResult {
  shouldPrompt: boolean;
  hasEntryEntities: boolean;
  cameras: DetectedTuyaCamera[];
  pairedBridge?: TuyaBridgeProvider;
  discoveredBridge?: TuyaBridgeProvider;
  bridgeCameras: TuyaBridgeCamera[];
  unimportedBridgeCameras: TuyaBridgeCamera[];
  bridgeNeedsLogin: boolean;
}

const CAMERA_DP_SUFFIXES = [
  'basic_indicator',
  'basic_nightvision',
  'basic_flip',
  'basic_osd',
  'record_switch',
  'motion_switch',
  'siren_switch',
  'ptz_control',
  'wireless_awake',
] as const;

function isCameraDpEntity(entity: TuyaCameraRegistryEntity): boolean {
  const uid = entity.unique_id ?? '';
  const eid = entity.entity_id;
  if (eid.startsWith('camera.')) return true;
  return CAMERA_DP_SUFFIXES.some((suffix) => uid.endsWith(suffix) || eid.endsWith(`_${suffix}`));
}

/**
 * Inspects Home Assistant / Hub registries plus discovered camera bridges to decide
 * whether a newly configured Tuya account has cameras requiring native bridge onboarding.
 */
export function detectTuyaCameraCandidates(input: {
  entryId?: string;
  entities: readonly TuyaCameraRegistryEntity[];
  devices: readonly TuyaCameraRegistryDevice[];
  pairedProviders: readonly TuyaBridgeProvider[];
  discoveredProviders: readonly TuyaBridgeProvider[];
  pairedBridgeCameras?: Readonly<Record<string, readonly TuyaBridgeCamera[]>>;
}): TuyaCameraDetectionResult {
  const { entryId, entities, devices, pairedProviders, discoveredProviders, pairedBridgeCameras } =
    input;

  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const entryDevices = entryId
    ? devices.filter((device) => device.config_entries?.includes(entryId))
    : [];
  const hasEntryEntities = Boolean(
    entryId &&
    (entities.some((entity) => entity.config_entry_id === entryId) || entryDevices.length > 0),
  );

  const pairedBridge = pairedProviders.find((item) => item.provider === 'tuya');
  const pairedId = pairedBridge?.id ?? pairedBridge?.bridgeId;
  const discoveredBridge = discoveredProviders.find(
    (item) => item.provider === 'tuya' && (!pairedId || (item.bridgeId ?? item.id) !== pairedId),
  );

  const bridgeCameras = pairedId ? [...(pairedBridgeCameras?.[pairedId] ?? [])] : [];
  const unimportedBridgeCameras = bridgeCameras.filter((cam) => !cam.imported);
  const bridgeNeedsLogin = Boolean(pairedBridge) && bridgeCameras.length === 0;

  const seenHaKeys = new Set<string>();
  const haCameras: DetectedTuyaCamera[] = [];

  for (const entity of entities) {
    if (entity.disabled_by) continue;
    const belongsToEntry = entryId && entity.config_entry_id === entryId;
    const isTuyaEntity = entity.platform === 'tuya' || belongsToEntry;
    if (!isTuyaEntity || !isCameraDpEntity(entity)) continue;

    const dedupeKey = entity.device_id ?? entity.entity_id;
    if (seenHaKeys.has(dedupeKey)) continue;
    seenHaKeys.add(dedupeKey);

    const device = entity.device_id ? deviceById.get(entity.device_id) : undefined;
    const label =
      device?.name_by_user?.trim() ||
      device?.name?.trim() ||
      entity.name?.trim() ||
      entity.original_name?.trim() ||
      entity.entity_id;

    haCameras.push({
      id: dedupeKey,
      name: label,
      source: 'ha_entity',
      imported: false,
    });
  }

  const cameras: DetectedTuyaCamera[] = [
    ...unimportedBridgeCameras.map((cam) => ({
      id: cam.physicalId,
      name: cam.name,
      source: 'bridge' as const,
      imported: false,
    })),
    ...haCameras,
  ];

  const allBridgeCamerasImported =
    Boolean(pairedBridge) && bridgeCameras.length > 0 && unimportedBridgeCameras.length === 0;

  const shouldPrompt =
    unimportedBridgeCameras.length > 0 ||
    discoveredBridge !== undefined ||
    bridgeNeedsLogin ||
    (haCameras.length > 0 && !allBridgeCamerasImported);

  return {
    shouldPrompt,
    hasEntryEntities,
    cameras,
    pairedBridge,
    discoveredBridge,
    bridgeCameras,
    unimportedBridgeCameras,
    bridgeNeedsLogin,
  };
}

/** Matches an installed or store Tuya RTSP bridge add-on in Home Assistant Supervisor. */
export function findTuyaBridgeAddon(
  installedAddons: readonly TuyaAddonCandidate[],
  storeAddons: readonly TuyaAddonCandidate[] = [],
): TuyaAddonCandidate | undefined {
  const matcher = (addon: TuyaAddonCandidate) => /(?:^|_)tuya-rtsp-bridge$/.test(addon.slug);
  const installed = installedAddons.find(matcher);
  if (installed) return { ...installed, installed: installed.installed ?? true };
  const storeMatch = storeAddons.find(matcher);
  if (storeMatch) return { ...storeMatch, installed: Boolean(storeMatch.installed) };
  return undefined;
}
