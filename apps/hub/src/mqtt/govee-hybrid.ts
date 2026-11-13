/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HausDevice } from '@haus/core/device';
import {
  HOMEBRIDGE_GOVEE_PACKAGE,
  isHomebridgeGoveeOutletModel,
  normalizeGoveeModel,
} from '@haus/kitsune';
import type { StandaloneHomeService } from '../home/home.service.js';

export const HYBRID_GOVEE_APP_ID = 'govee';
export const HOMEBRIDGE_GOVEE_APP_ID = 'homebridge-govee';
export const GOVEE2MQTT_APP_ID = 'govee2mqtt';

export interface MqttDiscoveryDeviceShape {
  readonly identifiers?: readonly (string | number)[] | string;
  readonly model?: string;
  readonly manufacturer?: string;
  readonly name?: string;
}

export interface MqttDiscoveryOriginShape {
  readonly name?: string;
  readonly url?: string;
}

interface GoveeOutletHandover {
  readonly oldDeviceId: string;
  readonly oldEndpointIds: readonly string[];
  readonly roomId?: string;
  readonly areaId?: string;
  readonly cleanMac?: string;
  readonly model?: string;
  readonly name: string;
}

const handoverByHome = new WeakMap<StandaloneHomeService, GoveeOutletHandover[]>();

export function isHomebridgeGoveeAppId(appId?: string): boolean {
  return (
    appId === HYBRID_GOVEE_APP_ID ||
    appId === HOMEBRIDGE_GOVEE_APP_ID ||
    appId === HOMEBRIDGE_GOVEE_PACKAGE
  );
}

export function isDockerGovee2MqttManifest(manifest?: {
  readonly id?: string;
  readonly image?: string;
}): boolean {
  if (!manifest) return false;
  if (typeof manifest.image === 'string' && /govee2mqtt/i.test(manifest.image)) return true;
  return manifest.id === GOVEE2MQTT_APP_ID;
}

export function isDockerGovee2MqttApp(entry?: {
  readonly manifest?: { readonly id?: string; readonly image?: string };
  readonly containerId?: string;
}): boolean {
  if (!entry) return false;
  if (entry.containerId) return true;
  return isDockerGovee2MqttManifest(entry.manifest);
}

export function isHomebridgeGoveeInstanceId(instanceId?: string): boolean {
  if (!instanceId?.startsWith('homebridge:')) return false;
  return isHomebridgeGoveeAppId(instanceId.slice('homebridge:'.length));
}

export function normalizeGoveeCleanMac(raw?: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let value = raw.trim();
  if (!value) return undefined;
  value = value.replace(/^mqtt_/i, '').replace(/^gv2mqtt[-_]?/i, '');
  const hexOnly = value.replace(/[:\-\s]/g, '').toUpperCase();
  if (/^[0-9A-F]{12,16}$/.test(hexOnly)) return hexOnly;
  return undefined;
}

export function extractGoveeCleanMacFromDevice(
  device: Pick<HausDevice, 'id' | 'serialNumber' | 'source' | 'sourceRefs'>,
): string | undefined {
  const candidates: Array<string | undefined> = [
    device.serialNumber,
    device.source?.externalId,
    device.id,
    ...(device.sourceRefs?.map((ref) => ref.externalId) ?? []),
  ];
  for (const candidate of candidates) {
    const clean = normalizeGoveeCleanMac(candidate);
    if (clean) return clean;
  }
  return undefined;
}

export function isGovee2MqttDevice(
  device: Pick<HausDevice, 'id' | 'source' | 'connectivity' | 'manufacturer' | 'sourceRefs'>,
): boolean {
  const isMqtt =
    device.source?.instanceId === 'haus-mqtt' || device.connectivity?.protocol === 'mqtt';
  if (!isMqtt) return false;
  if (/gv2mqtt|govee2mqtt/i.test(device.id)) return true;
  if (/gv2mqtt|govee2mqtt/i.test(device.source?.externalId ?? '')) return true;
  if (device.manufacturer?.trim().toLowerCase() === 'govee') return true;
  return Boolean(device.sourceRefs?.some((ref) => /gv2mqtt|govee2mqtt/i.test(ref.externalId)));
}

export function isGovee2MqttDiscoveryPayload(params: {
  readonly rawDeviceId?: string;
  readonly uniqueId?: string;
  readonly device?: MqttDiscoveryDeviceShape;
  readonly origin?: MqttDiscoveryOriginShape;
}): boolean {
  if (/^gv2mqtt-/i.test(params.rawDeviceId ?? '')) return true;
  if (/^gv2mqtt-/i.test(params.uniqueId ?? '')) return true;
  if (typeof params.device?.identifiers === 'string' && /gv2mqtt-/i.test(params.device.identifiers))
    return true;
  if (
    Array.isArray(params.device?.identifiers) &&
    params.device.identifiers.some((id) => /gv2mqtt-/i.test(String(id)))
  )
    return true;
  if (/govee2mqtt/i.test(params.origin?.name ?? '')) return true;
  if (/govee2mqtt/i.test(params.origin?.url ?? '')) return true;
  return params.device?.manufacturer?.trim().toLowerCase() === 'govee';
}

export function isMqttGoveeOutletSuppressionActive(homeService?: StandaloneHomeService): boolean {
  if (!homeService) return false;
  const goveeApp = homeService.appManager?.getInstalledApp?.(HYBRID_GOVEE_APP_ID);
  if (
    goveeApp &&
    !isDockerGovee2MqttApp(goveeApp) &&
    goveeApp.state !== 'stopped' &&
    goveeApp.config?.hybridSplit !== false
  ) {
    return true;
  }
  const hbApp = homeService.appManager?.getInstalledApp?.(HOMEBRIDGE_GOVEE_APP_ID);
  if (hbApp && hbApp.state !== 'stopped' && hbApp.config?.hybridSplit !== false) {
    return true;
  }
  return homeService
    .listDevices()
    .some((device) => isHomebridgeGoveeInstanceId(device.source.instanceId));
}

export function isHomebridgeGoveeOutletsOnlyActive(
  homeService: StandaloneHomeService | undefined,
  pluginId?: string,
): boolean {
  if (!homeService) return false;
  const goveeApp = homeService.appManager?.getInstalledApp?.(HYBRID_GOVEE_APP_ID);
  const hbApp = homeService.appManager?.getInstalledApp?.(HOMEBRIDGE_GOVEE_APP_ID);
  const govee2MqttApp = homeService.appManager?.getInstalledApp?.(GOVEE2MQTT_APP_ID);

  if (pluginId === HYBRID_GOVEE_APP_ID && !isDockerGovee2MqttApp(goveeApp)) {
    return goveeApp?.config?.hybridSplit !== false;
  }
  if (!isHomebridgeGoveeAppId(pluginId)) return false;
  if (
    pluginId === HOMEBRIDGE_GOVEE_APP_ID &&
    (hbApp?.config?.outletsOnly === false || hbApp?.config?.hybridSplit === false)
  ) {
    return false;
  }
  if (hbApp?.config?.outletsOnly === true || hbApp?.config?.hybridSplit === true) return true;
  if (goveeApp && isDockerGovee2MqttApp(goveeApp) && goveeApp.state !== 'stopped') return true;
  if (goveeApp && !isDockerGovee2MqttApp(goveeApp) && goveeApp.config?.hybridSplit !== false) {
    return true;
  }
  if (govee2MqttApp && govee2MqttApp.state !== 'stopped') return true;
  return homeService.listDevices().some((device) => isGovee2MqttDevice(device));
}

export function stashAndRemoveSupersededMqttOutlet(
  homeService: StandaloneHomeService,
  device: HausDevice,
): void {
  if (!isGovee2MqttDevice(device)) return;
  const list = handoverByHome.get(homeService) ?? [];
  const filtered = list.filter((entry) => entry.oldDeviceId !== device.id);
  filtered.push({
    oldDeviceId: device.id,
    oldEndpointIds: device.endpoints.map((ep) => ep.id),
    roomId: device.roomId,
    areaId: device.areaId,
    cleanMac: extractGoveeCleanMacFromDevice(device),
    model: normalizeGoveeModel(device.model),
    name: device.name,
  });
  handoverByHome.set(homeService, filtered);
  homeService.removeDevice(device.id);
}

export function pruneSupersededMqttGoveeOutlets(homeService: StandaloneHomeService): number {
  let removed = 0;
  for (const device of homeService.listDevices()) {
    if (!isGovee2MqttDevice(device)) continue;
    if (!isHomebridgeGoveeOutletModel(device.model)) continue;
    stashAndRemoveSupersededMqttOutlet(homeService, device);
    removed += 1;
  }
  return removed;
}

export function shouldSuppressMqttDiscoveryAsGoveeOutlet(params: {
  readonly homeService?: StandaloneHomeService;
  readonly rawDeviceId: string;
  readonly uniqueId?: string;
  readonly device?: MqttDiscoveryDeviceShape;
  readonly origin?: MqttDiscoveryOriginShape;
  readonly model?: string;
  readonly suppressedDeviceIds?: ReadonlySet<string>;
}): boolean {
  if (!isMqttGoveeOutletSuppressionActive(params.homeService)) return false;
  if (!isGovee2MqttDiscoveryPayload(params)) return false;
  if (params.suppressedDeviceIds?.has(params.rawDeviceId)) return true;
  return isHomebridgeGoveeOutletModel(params.model);
}

export function suppressMqttDiscoveryGoveeOutlet(params: {
  readonly homeService?: StandaloneHomeService;
  readonly rawDeviceId: string;
  readonly uniqueId?: string;
  readonly device?: MqttDiscoveryDeviceShape;
  readonly origin?: MqttDiscoveryOriginShape;
  readonly model?: string;
  readonly suppressedDeviceIds: Set<string>;
  readonly existingDevice?: HausDevice;
  readonly onSuppressedTopic: () => void;
  readonly logger: { log(message: string): void };
}): boolean {
  if (!shouldSuppressMqttDiscoveryAsGoveeOutlet(params)) return false;
  const firstSuppression = !params.suppressedDeviceIds.has(params.rawDeviceId);
  params.suppressedDeviceIds.add(params.rawDeviceId);
  params.onSuppressedTopic();
  if (params.existingDevice && isGovee2MqttDevice(params.existingDevice) && params.homeService) {
    stashAndRemoveSupersededMqttOutlet(params.homeService, params.existingDevice);
  }
  if (firstSuppression) {
    params.logger.log(
      `Suppressed govee2mqtt outlet discovery "${params.rawDeviceId}" (${params.model ?? 'catalog-outlet'}) in favor of Homebridge Govee`,
    );
  }
  return true;
}

export function createMqttGoveeOutletSuppressor(
  homeService: StandaloneHomeService | undefined,
  logger: { log(message: string): void },
  onSuppressedTopic: (topic: string) => void,
) {
  const suppressedDeviceIds = new Set<string>();
  return (params: {
    readonly rawDevId: string;
    readonly model?: string;
    readonly payload: {
      readonly device?: MqttDiscoveryDeviceShape;
      readonly origin?: MqttDiscoveryOriginShape;
    };
    readonly topic: string;
    readonly existing?: HausDevice;
    readonly uniqueId?: string;
  }): boolean =>
    suppressMqttDiscoveryGoveeOutlet({
      homeService,
      rawDeviceId: params.rawDevId,
      uniqueId: params.uniqueId,
      device: params.payload.device,
      origin: params.payload.origin,
      model: params.model,
      suppressedDeviceIds,
      existingDevice: params.existing,
      onSuppressedTopic: () => onSuppressedTopic(params.topic),
      logger,
    });
}

export function shouldAdmitHomebridgeGoveeDevice(
  device: HausDevice,
  outletsOnly: boolean,
): boolean {
  if (!outletsOnly) return true;
  // Mid-construction Homebridge accessories before services load have 0 endpoints.
  if (device.endpoints.length === 0) return false;
  if (device.model) return isHomebridgeGoveeOutletModel(device.model);
  return device.category === 'power';
}

export function reconcileHomebridgeGoveeDevice(
  homeService: StandaloneHomeService,
  normalizedDevice: HausDevice,
): { readonly device: HausDevice; readonly aliasPromises: readonly Promise<void>[] } {
  const aliasPromises: Promise<void>[] = [];
  let updated = normalizedDevice;

  if (!isHomebridgeGoveeOutletModel(updated.model) && updated.category !== 'power') {
    return { device: updated, aliasPromises };
  }

  const targetMac = extractGoveeCleanMacFromDevice(updated);
  const targetModel = normalizeGoveeModel(updated.model);
  const normalizedTargetName = updated.name.trim().toLowerCase();

  const matchesCandidate = (candidate: {
    readonly cleanMac?: string;
    readonly model?: string;
    readonly name: string;
  }): boolean => {
    if (targetMac && candidate.cleanMac) {
      return targetMac === candidate.cleanMac;
    }
    return (
      Boolean(targetModel && candidate.model && targetModel === candidate.model) &&
      candidate.name.trim().toLowerCase() === normalizedTargetName
    );
  };

  // Reconcile against any live superseded MQTT Govee outlet still in home.
  for (const existing of homeService.listDevices()) {
    if (!isGovee2MqttDevice(existing)) continue;
    if (!isHomebridgeGoveeOutletModel(existing.model)) continue;
    const candidate = {
      cleanMac: extractGoveeCleanMacFromDevice(existing),
      model: normalizeGoveeModel(existing.model),
      name: existing.name,
    };
    if (!matchesCandidate(candidate)) continue;
    stashAndRemoveSupersededMqttOutlet(homeService, existing);
  }

  const stashed = handoverByHome.get(homeService) ?? [];
  const remaining: GoveeOutletHandover[] = [];
  const registeredDeviceAliases = new Set<string>();
  for (const handover of stashed) {
    if (!matchesCandidate(handover)) {
      remaining.push(handover);
      continue;
    }
    if (
      (updated.roomId === 'default' || updated.roomId === 'unassigned') &&
      handover.roomId &&
      handover.roomId !== 'default' &&
      handover.roomId !== 'unassigned'
    ) {
      updated = {
        ...updated,
        roomId: handover.roomId,
        areaId: handover.areaId ?? handover.roomId,
      };
    }

    if (typeof homeService.registerAlias === 'function') {
      registeredDeviceAliases.add(handover.oldDeviceId);
      aliasPromises.push(
        homeService.registerAlias(handover.oldDeviceId, updated.id).catch(() => undefined),
      );
      if (handover.oldEndpointIds.length === 1 && updated.endpoints.length >= 1) {
        aliasPromises.push(
          homeService
            .registerAlias(handover.oldEndpointIds[0]!, updated.endpoints[0]!.id)
            .catch(() => undefined),
        );
      } else if (
        handover.oldEndpointIds.length > 1 &&
        handover.oldEndpointIds.length === updated.endpoints.length
      ) {
        for (let i = 0; i < handover.oldEndpointIds.length; i += 1) {
          aliasPromises.push(
            homeService
              .registerAlias(handover.oldEndpointIds[i]!, updated.endpoints[i]!.id)
              .catch(() => undefined),
          );
        }
      }
    }
  }
  handoverByHome.set(homeService, remaining);

  if (
    typeof homeService.registerAlias === 'function' &&
    targetMac &&
    /^[0-9A-F]{16}$/.test(targetMac) &&
    isMqttGoveeOutletSuppressionActive(homeService)
  ) {
    const legacyAlias = `mqtt_gv2mqtt-${targetMac}`;
    if (
      !registeredDeviceAliases.has(legacyAlias) &&
      homeService.getDevice?.(legacyAlias)?.id !== updated.id
    ) {
      aliasPromises.push(homeService.registerAlias(legacyAlias, updated.id).catch(() => undefined));
    }
  }

  return { device: updated, aliasPromises };
}
