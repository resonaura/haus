/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { IntegrationEntry } from '../../../ha/management';
import type { Device, Snapshot } from '../../../model';
import type { RepairIssue } from '../../../model/notifications';

export type UpdateCategory =
  'core' | 'integration' | 'plugin' | 'addon' | 'homebridge' | 'scrypted' | 'hacs';

export interface UnifiedUpdateItem {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly category: UpdateCategory;
  readonly installedVersion: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
  readonly canInstall: boolean;
  readonly inProgress?: boolean;
  readonly skippedVersion?: string;
  readonly releaseUrl?: string;
  readonly releaseSummary?: string;
  readonly checkedAt: string;
}

export interface UnifiedUpdatesResponse {
  readonly checkedAt: string;
  readonly total: number;
  readonly availableCount: number;
  readonly items: readonly UnifiedUpdateItem[];
}

export type IntegrationRuntimeType =
  'built_in' | 'custom_integration' | 'homebridge' | 'scrypted' | 'docker_app' | 'addon';

export interface IntegrationDomainMeta {
  readonly domain: string;
  readonly name: string;
  readonly version?: string;
  readonly runtimeType: IntegrationRuntimeType;
  readonly iotClass?: string;
  readonly supportsOptions: boolean;
  readonly supportsReconfigure: boolean;
  readonly supportsMultiple: boolean;
  readonly documentationUrl?: string;
  readonly deviceCount: number;
  readonly entityCount: number;
  readonly entryCount: number;
  readonly brokenCount: number;
}

export type RichRepairIssue = RepairIssue & {
  readonly title?: string;
  readonly description?: string;
  readonly is_persistent?: boolean;
  readonly entryId?: string;
  readonly sourceLabel?: string;
  readonly learn_more_url?: string;
};

export function formatRuntimeLabel(runtime?: IntegrationRuntimeType): string {
  switch (runtime) {
    case 'custom_integration':
      return 'Custom integration';
    case 'homebridge':
      return 'Homebridge plugin';
    case 'scrypted':
      return 'Scrypted plugin';
    case 'docker_app':
      return 'Docker app';
    case 'addon':
      return 'Add-on';
    case 'built_in':
      return 'Built-in integration';
    default:
      return 'Integration';
  }
}

export function formatIotClass(iotClass?: string): string | undefined {
  if (!iotClass) return undefined;
  const normalized = iotClass.toLowerCase();
  if (normalized.startsWith('cloud_')) return 'Requires Internet';
  if (normalized === 'local_push') return 'Local push';
  if (normalized === 'local_polling') return 'Local polling';
  if (normalized === 'assumed_state') return 'Assumed state';
  if (normalized === 'calculated') return 'Calculated';
  return iotClass.replaceAll('_', ' ');
}

export function formatRelativeAge(iso?: string): string | undefined {
  if (!iso) return undefined;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return undefined;
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const weeks = Math.floor(diffDays / 7);
  return `${weeks}w ago`;
}

export function formatCategoryBadge(category: UpdateCategory): string {
  switch (category) {
    case 'core':
      return 'Core';
    case 'hacs':
      return 'HACS';
    case 'homebridge':
      return 'Homebridge';
    case 'scrypted':
      return 'Scrypted';
    case 'plugin':
      return 'Plugin';
    case 'addon':
      return 'Add-on';
    default:
      return 'Integration';
  }
}

export function entryDevicesForEntry(
  entry: IntegrationEntry,
  snapshot: Snapshot,
): readonly Device[] {
  const entryId = entry.entry_id;
  const entityDeviceIds = new Set(
    snapshot.entities
      .filter((ent) => ent.config_entry_id === entryId && ent.device_id)
      .map((ent) => String(ent.device_id)),
  );
  return snapshot.devices.filter((device) => {
    const cfgEntries = Array.isArray(device.config_entries)
      ? (device.config_entries as unknown[])
      : [];
    if (cfgEntries.includes(entryId)) return true;
    if (entityDeviceIds.has(device.id)) return true;
    return false;
  });
}

export function deviceEntityCount(deviceId: string, snapshot: Snapshot): number {
  return snapshot.entities.filter((ent) => ent.device_id === deviceId).length;
}

export function computeIntegrationStats(
  domain: string,
  entries: readonly IntegrationEntry[],
  snapshot: Snapshot,
  meta?: IntegrationDomainMeta,
): { deviceCount: number; entityCount: number } {
  const entryIds = new Set(entries.map((e) => e.entry_id));
  const deviceIds = new Set<string>();
  const entityIds = new Set<string>();

  for (const device of snapshot.devices) {
    const cfg = Array.isArray(device.config_entries) ? (device.config_entries as unknown[]) : [];
    if (cfg.some((id) => typeof id === 'string' && entryIds.has(id))) {
      deviceIds.add(device.id);
    }
  }
  for (const ent of snapshot.entities) {
    const cfgId = typeof ent.config_entry_id === 'string' ? ent.config_entry_id : undefined;
    if (
      (cfgId && entryIds.has(cfgId)) ||
      (ent.device_id && deviceIds.has(ent.device_id)) ||
      ent.platform === domain
    ) {
      if (ent.device_id) deviceIds.add(ent.device_id);
      entityIds.add(ent.entity_id);
    }
  }

  return {
    deviceCount: Math.max(deviceIds.size, meta?.deviceCount ?? 0),
    entityCount: Math.max(entityIds.size, meta?.entityCount ?? 0),
  };
}

export const INTEGRATION_NAME_OVERRIDES: Record<string, string> = {
  hue: 'Philips Hue',
  ipp: 'Printers · IPP',
  eero: 'eero',
  mqtt: 'MQTT',
  esphome: 'ESPHome',
  hassio: 'Supervisor',
};

export function filterIntegrationEntries(
  entries: readonly IntegrationEntry[],
  domain: string,
  filter: string,
  hasIssue: (entry: IntegrationEntry) => boolean,
): IntegrationEntry[] {
  return entries.filter(
    (entry) =>
      entry.domain === domain &&
      (filter === 'all' ||
        (filter === 'issues'
          ? hasIssue(entry)
          : filter === 'disabled'
            ? Boolean(entry.disabled_by)
            : entry.state === 'loaded')),
  );
}

export function buildAddonActionDescription(
  action: string,
  installed: boolean,
  version?: string,
  latest?: string,
): string {
  if (action === 'update') {
    return `Update ${version ?? ''} to ${latest ?? 'the latest version'}. A backup will be created first.`;
  }
  if (action === 'uninstall') {
    return 'The add-on will be removed. Its configuration will be kept so it can be installed again.';
  }
  if (action === 'install') {
    return 'This will install the add-on on your Home Assistant server. Review its details and required access before continuing.';
  }
  return installed
    ? 'Devices and services that depend on this add-on may be temporarily unavailable.'
    : 'Apply this operation on your Home Assistant server.';
}
