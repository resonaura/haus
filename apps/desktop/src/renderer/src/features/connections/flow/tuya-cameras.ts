/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface TuyaCameraRegistryEntity {
  entity_id: string;
  platform?: string | null;
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
  available?: boolean;
  cameras?: number;
}

/** Resolves the canonical bridge identifier across paired (`id`) and discovered (`bridgeId`) shapes. */
export function providerBridgeId(
  provider?: Pick<TuyaBridgeProvider, 'id' | 'bridgeId'>,
): string | undefined {
  return provider?.id || provider?.bridgeId || undefined;
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

export function isCameraDpEntity(entity: TuyaCameraRegistryEntity): boolean {
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
  const pairedId = providerBridgeId(pairedBridge);
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

export const TUYA_BRIDGE_APP_ID = 'tuya-rtsp-bridge';

export const TUYA_REGION_OPTIONS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: 'us', label: 'America West (us)' },
  { id: 'ue', label: 'America East (ue)' },
  { id: 'eu', label: 'Western Europe (eu)' },
  { id: 'we', label: 'Eastern Europe (we)' },
  { id: 'in', label: 'India (in)' },
  { id: 'cn', label: 'China (cn)' },
];

export interface TuyaStandaloneBridgeState {
  readonly appId: string;
  readonly installed: boolean;
  readonly running: boolean;
  readonly version?: string;
  readonly image?: string;
  readonly manifest?: Record<string, unknown>;
}

export interface TuyaAppInstallProgress {
  readonly stage: string;
  readonly progress?: number;
  readonly detail?: string;
  readonly errorCode?: string;
}

interface HubInstalledAppLike {
  readonly id?: string;
  readonly name?: string;
  readonly version?: string;
  readonly state?: string;
  readonly source?: { readonly externalId?: string };
}

interface HubCatalogResponseLike {
  readonly entry?: {
    readonly manifest?: Record<string, unknown>;
  };
}

/** Resolve standalone Haus Hub install/running state + trusted catalog manifest for Tuya bridge. */
export function resolveStandaloneTuyaBridge(
  appsRes: { readonly apps?: readonly HubInstalledAppLike[] } | null | undefined,
  catalogRes: HubCatalogResponseLike | null | undefined,
): TuyaStandaloneBridgeState | undefined {
  const manifest = catalogRes?.entry?.manifest;
  const installed = appsRes?.apps?.find(
    (item) => item.source?.externalId === TUYA_BRIDGE_APP_ID || item.id === TUYA_BRIDGE_APP_ID,
  );
  if (!installed && !manifest) return undefined;

  const manifestVersion = typeof manifest?.version === 'string' ? manifest.version : undefined;
  const manifestImage = typeof manifest?.image === 'string' ? manifest.image : undefined;
  return {
    appId: TUYA_BRIDGE_APP_ID,
    installed: Boolean(installed),
    running: installed?.state === 'running',
    version: installed?.version ?? manifestVersion,
    image: manifestImage,
    manifest,
  };
}

/** Convert Hub app install-progress stages into concise user-facing status text. */
export function formatBridgeInstallProgress(progress: TuyaAppInstallProgress | null): string {
  if (!progress) return 'Preparing Tuya Camera Bridge…';
  switch (progress.stage) {
    case 'validating':
      return 'Validating bridge manifest & permissions…';
    case 'checking-local':
      return 'Checking cached container image…';
    case 'pulling':
      return typeof progress.progress === 'number'
        ? `Pulling latest Tuya Camera Bridge image (${Math.round(progress.progress)}%)…`
        : 'Pulling latest Tuya Camera Bridge image…';
    case 'building':
      return 'Preparing bridge runtime image…';
    case 'creating':
      return 'Creating Tuya Camera Bridge container…';
    case 'starting':
      return 'Starting Tuya Camera Bridge container…';
    case 'complete':
      return 'Bridge started — waiting for pairing service…';
    case 'failed':
      return progress.errorCode
        ? `Bridge install failed (${progress.errorCode}).`
        : 'Bridge install failed.';
    default:
      return 'Installing Tuya Camera Bridge…';
  }
}

/** Picks the first actionable step when opening or resuming Tuya camera follow-up setup. */
export function resolveTuyaFollowupStage(
  detection: TuyaCameraDetectionResult,
  resumed: boolean,
): 'prompt' | 'select-cameras' | 'second-login' {
  if (resumed && providerBridgeId(detection.pairedBridge)) {
    if (detection.unimportedBridgeCameras.length > 0) return 'select-cameras';
    if (detection.bridgeNeedsLogin) return 'second-login';
  }
  return 'prompt';
}
