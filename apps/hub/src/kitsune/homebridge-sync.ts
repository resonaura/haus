/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { join, resolve } from 'node:path';
import type { AppCatalogEntry, AppManifest } from '@haus/apps';
import { reconcileDeviceUserAssignments, type HausDevice } from '@haus/core/device';
import {
  HOMEBRIDGE_GOVEE_PACKAGE,
  PluginInstaller,
  loadHomebridgeGoveeOutletCatalog,
  resolveHomebridgeGoveePluginDirectory,
  setActiveGoveeOutletCatalog,
  type CompatibilityRuntimeKind,
  type GoveeOutletCatalog,
  type KitsuneCommandPayload,
} from '@haus/kitsune';
import type { StandaloneHomeService } from '../home/home.service.js';
import {
  isHomebridgeGoveeAppId,
  isHomebridgeGoveeInstanceId,
  isHomebridgeGoveeOutletsOnlyActive,
  reconcileHomebridgeGoveeDevice,
  shouldAdmitHomebridgeGoveeDevice,
} from '../mqtt/govee-hybrid.js';

export async function resolveHomebridgePluginRuntime(params: {
  readonly appId: string;
  readonly manifest?: Pick<AppManifest, 'version' | 'env'>;
  readonly catalogEntry?: Pick<AppCatalogEntry, 'packageName'>;
  readonly config: Record<string, unknown>;
  readonly dataDirectory: string;
  readonly forceInstall?: boolean;
  readonly onLog?: (line: string) => void;
}): Promise<{ pluginDirectory: string; catalog?: GoveeOutletCatalog }> {
  const {
    appId,
    manifest,
    catalogEntry,
    config,
    dataDirectory,
    forceInstall = false,
    onLog,
  } = params;
  const explicitPath =
    typeof config.pluginPath === 'string' && config.pluginPath.trim().length > 0
      ? resolve(config.pluginPath.trim())
      : undefined;

  if (isHomebridgeGoveeAppId(appId)) {
    let resolvedDir: string | undefined;
    if (!forceInstall) {
      resolvedDir = explicitPath
        ? explicitPath
        : await resolveHomebridgeGoveePluginDirectory({
            pluginDirectory: explicitPath,
            dataDirectory,
            searchRoots: [join(dataDirectory, 'kitsune', 'plugins'), join(dataDirectory, 'apps')],
          });
    }

    if (!resolvedDir) {
      const installer = new PluginInstaller(dataDirectory);
      const installed = await installer.install(HOMEBRIDGE_GOVEE_PACKAGE, 'latest');
      resolvedDir = installed.directory;
    }

    const catalog = await loadHomebridgeGoveeOutletCatalog({
      pluginDirectory: resolvedDir,
      dataDirectory,
    });
    setActiveGoveeOutletCatalog(catalog);
    onLog?.(
      `Loaded Govee outlet catalog (${catalog.source}, ${catalog.allModels.size} outlet models${catalog.pluginVersion ? `, v${catalog.pluginVersion}` : ''})`,
    );
    return { pluginDirectory: resolvedDir, catalog };
  }

  if (explicitPath) {
    return { pluginDirectory: explicitPath };
  }

  const rawEnvPkg =
    manifest?.env && typeof manifest.env === 'object' && 'HAUS_NPM_PACKAGE' in manifest.env
      ? manifest.env.HAUS_NPM_PACKAGE
      : undefined;
  const envPkg =
    typeof rawEnvPkg === 'string' && rawEnvPkg.trim().length > 0 ? rawEnvPkg.trim() : undefined;
  const packageName =
    (typeof config.packageName === 'string' && config.packageName.trim().length > 0
      ? config.packageName.trim()
      : undefined) ??
    envPkg ??
    catalogEntry?.packageName ??
    appId;
  const installer = new PluginInstaller(dataDirectory);
  const targetVersion = !forceInstall && manifest?.version ? manifest.version : 'latest';
  try {
    const installed = await installer.install(packageName, targetVersion);
    return { pluginDirectory: installed.directory };
  } catch {
    const installed = await installer.install(packageName, 'latest');
    return { pluginDirectory: installed.directory };
  }
}

export function normalizeKitsuneDeviceForHome(device: HausDevice): HausDevice {
  const prefix = `${device.id}:`;
  return {
    ...device,
    endpoints: device.endpoints.map((ep) => ({
      ...ep,
      id: ep.id.startsWith(prefix) ? ep.id : `${prefix}${ep.id}`,
    })),
  };
}

export function syncKitsuneDevicesToHome(params: {
  readonly homeService?: StandaloneHomeService;
  readonly syncedDeviceIds: Set<string>;
  readonly pendingAliases: Set<Promise<void>>;
  readonly devices: readonly HausDevice[];
}): void {
  const { homeService, syncedDeviceIds, pendingAliases, devices } = params;
  if (!homeService) return;

  const nextSynced = new Set<string>();
  for (const dev of devices) {
    let normalized = normalizeKitsuneDeviceForHome(dev);

    if (isHomebridgeGoveeInstanceId(dev.source.instanceId)) {
      const pluginId = dev.source.instanceId.slice('homebridge:'.length);
      const outletsOnly = isHomebridgeGoveeOutletsOnlyActive(homeService, pluginId);
      if (!shouldAdmitHomebridgeGoveeDevice(normalized, outletsOnly)) {
        continue;
      }
    }

    const existing =
      homeService.devices?.getDevice(normalized.id) ?? homeService.getDevice(normalized.id);
    normalized = reconcileDeviceUserAssignments(existing, normalized);

    if (isHomebridgeGoveeInstanceId(dev.source.instanceId)) {
      const reconciled = reconcileHomebridgeGoveeDevice(homeService, normalized);
      normalized = reconciled.device;
      for (const promise of reconciled.aliasPromises) {
        pendingAliases.add(promise);
        const cleanup = () => {
          pendingAliases.delete(promise);
        };
        void promise.then(cleanup, cleanup);
      }
    }

    nextSynced.add(normalized.id);
    homeService.registerDevice(normalized);
  }

  for (const previousId of syncedDeviceIds) {
    if (!nextSynced.has(previousId)) {
      homeService.removeDevice(previousId);
    }
  }

  syncedDeviceIds.clear();
  for (const id of nextSynced) {
    syncedDeviceIds.add(id);
  }
}

export function resolveKitsuneCommandTarget(
  devices: readonly HausDevice[],
  endpointId: string,
): {
  readonly targetDevice: HausDevice | undefined;
  readonly isKitsuneDevice: boolean;
  readonly runtime: CompatibilityRuntimeKind;
  readonly pluginId: string;
} {
  let targetDevice = devices.find((d) => {
    const prefix = `${d.id}:`;
    return d.endpoints.some((ep) => {
      const canonicalEpId = ep.id.startsWith(prefix) ? ep.id : `${prefix}${ep.id}`;
      return canonicalEpId === endpointId || ep.id === endpointId;
    });
  });
  if (!targetDevice) {
    targetDevice = devices.find((d) => endpointId.startsWith(`${d.id}:`) || endpointId === d.id);
  }

  const isKitsuneDevice =
    Boolean(targetDevice?.source.instanceId.startsWith('homebridge:')) ||
    Boolean(targetDevice?.source.instanceId.startsWith('hacs:')) ||
    Boolean(targetDevice?.source.instanceId.startsWith('scrypted:')) ||
    targetDevice?.source.instanceId === 'kitsune' ||
    Boolean(targetDevice?.id.startsWith('kitsune:')) ||
    Boolean(targetDevice?.id.startsWith('homebridge:')) ||
    Boolean(targetDevice?.id.startsWith('hacs:')) ||
    endpointId.startsWith('homebridge:') ||
    endpointId.startsWith('kitsune:') ||
    endpointId.startsWith('hacs:');

  let runtime: CompatibilityRuntimeKind = 'homebridge';
  let pluginId = 'homebridge-govee';

  if (targetDevice?.source.instanceId.startsWith('homebridge:')) {
    runtime = 'homebridge';
    pluginId = targetDevice.source.instanceId.slice('homebridge:'.length);
  } else if (targetDevice?.source.instanceId.startsWith('hacs:')) {
    runtime = 'hacs';
    pluginId = targetDevice.source.instanceId.slice('hacs:'.length);
  } else if (
    targetDevice?.source.instanceId === 'kitsune' ||
    targetDevice?.source.instanceId.startsWith('scrypted:')
  ) {
    runtime = 'scrypted';
    pluginId = targetDevice.source.instanceId.startsWith('scrypted:')
      ? targetDevice.source.instanceId.slice('scrypted:'.length)
      : (targetDevice.id.split(':')[1] ?? 'unknown');
  } else if (endpointId.startsWith('homebridge:')) {
    runtime = 'homebridge';
    const parts = endpointId.split(':');
    pluginId = parts[1] ?? 'homebridge-govee';
  }

  return { targetDevice, isKitsuneDevice, runtime, pluginId };
}

export function buildKitsuneCommandPayload(params: {
  readonly targetDevice: HausDevice | undefined;
  readonly endpointId: string;
  readonly capability: string;
  readonly command: string;
  readonly parameters?: Record<string, unknown>;
}): KitsuneCommandPayload {
  const { targetDevice, endpointId, capability, command, parameters } = params;
  let value: unknown = parameters?.value;
  let targetCapability = capability;
  if (command === 'turn_on') {
    targetCapability = 'on_off';
    value = true;
  } else if (command === 'turn_off') {
    targetCapability = 'on_off';
    value = false;
  } else if (command === 'toggle') {
    targetCapability = 'on_off';
    const currentReadings = targetDevice?.endpoints.find((ep) =>
      endpointId.includes(ep.id),
    )?.readings;
    const currentOn = currentReadings?.on_off?.value === true;
    value = !currentOn;
  } else if (capability === 'brightness' || command === 'set_brightness') {
    targetCapability = 'brightness';
    value = parameters?.value ?? parameters?.brightness;
  } else if (capability === 'color_temp' || command === 'set_color_temp') {
    targetCapability = 'color_temp';
    value = parameters?.value ?? parameters?.color_temp_kelvin ?? parameters?.color_temp;
  } else if (capability === 'color_hsv' || capability === 'color') {
    targetCapability = 'color_hsv';
    value = parameters?.value ?? parameters?.color ?? parameters;
  }

  const rawEndpointId =
    targetDevice && endpointId.startsWith(`${targetDevice.id}:`)
      ? endpointId.slice(targetDevice.id.length + 1)
      : endpointId;

  return {
    deviceId: targetDevice ? targetDevice.id : endpointId.split(':').slice(0, 3).join(':'),
    endpointId: rawEndpointId,
    capability: targetCapability,
    value,
    parameters,
  };
}
