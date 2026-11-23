/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HausDevice } from '@haus/core';
import type { UnifiedUpdateItem } from '../updates.js';

export interface DeviceFirmwareHomeView {
  readonly devices: { listDevices(): readonly HausDevice[] };
  getEndpointState(endpointId: string): Record<string, unknown> | undefined;
}

const UPDATE_FEATURE_INSTALL = 1;

function strProp(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boolProp(value: unknown): boolean {
  return value === true || value === 'on' || value === 'true';
}

/**
 * Collects Home Assistant `update.*` device firmware entities (e.g. eero routers, Hue bridges,
 * Zigbee/Matter OTA devices) into Haus's unified Updates stream.
 */
export function collectDeviceFirmwareUpdates(params: {
  readonly homeService: DeviceFirmwareHomeView | undefined;
  readonly installing: ReadonlySet<string>;
  readonly checkedAt: string;
}): UnifiedUpdateItem[] {
  const { homeService, installing, checkedAt } = params;
  if (!homeService) return [];

  const items: UnifiedUpdateItem[] = [];
  for (const device of homeService.devices.listDevices()) {
    const domain = device.sourceRefs?.[0]?.instanceId ?? device.manufacturer?.toLowerCase() ?? 'device';
    for (const endpoint of device.endpoints) {
      const isUpdate =
        endpoint.id.startsWith('update.') ||
        endpoint.capabilities.some((cap) => cap.id === 'update' || cap.kind === 'update');
      if (!isUpdate) continue;

      const state = homeService.getEndpointState(endpoint.id) ?? {};
      const installedVersion =
        strProp(state.installed_version) ??
        strProp(endpoint.readings.installed_version?.value) ??
        device.firmwareVersion ??
        'unknown';
      const latestVersion =
        strProp(state.latest_version) ??
        strProp(endpoint.readings.latest_version?.value) ??
        installedVersion;
      const skippedVersion =
        strProp(state.skipped_version) ?? strProp(endpoint.readings.skipped_version?.value);
      const rawUpdate = state.update ?? state.on_off ?? endpoint.readings.update?.value;
      const updateAvailable =
        boolProp(rawUpdate) && (!skippedVersion || skippedVersion !== latestVersion);
      const inProgressRaw = state.in_progress ?? endpoint.readings.in_progress?.value;
      const inProgress =
        installing.has(`device-update:${endpoint.id}`) ||
        inProgressRaw === true ||
        (typeof inProgressRaw === 'number' && inProgressRaw > 0);
      const featuresRaw = state.supported_features ?? endpoint.readings.supported_features?.value;
      const features = typeof featuresRaw === 'number' ? featuresRaw : UPDATE_FEATURE_INSTALL;
      const canInstall =
        device.availability !== 'offline' &&
        (features & UPDATE_FEATURE_INSTALL) === UPDATE_FEATURE_INSTALL;
      const softwareTitle =
        strProp(state.title) ?? strProp(endpoint.readings.title?.value) ?? endpoint.name;
      const displayTitle =
        softwareTitle && softwareTitle.toLowerCase().includes(device.name.toLowerCase())
          ? softwareTitle
          : `${device.name} · ${softwareTitle || 'Firmware'}`;

      items.push({
        id: `device-update:${endpoint.id}`,
        domain,
        title: displayTitle,
        category: 'firmware',
        installedVersion,
        latestVersion,
        updateAvailable,
        canInstall,
        inProgress,
        ...(skippedVersion ? { skippedVersion } : {}),
        releaseUrl: strProp(state.release_url) ?? strProp(endpoint.readings.release_url?.value),
        releaseSummary:
          strProp(state.release_summary) ?? strProp(endpoint.readings.release_summary?.value),
        checkedAt,
      });
    }
  }
  return items;
}
