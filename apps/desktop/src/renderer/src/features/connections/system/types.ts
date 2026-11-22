/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  humanize,
  nativeApi,
  supervisor,
  type AddonInfo,
  type IntegrationEntry,
} from '../../../ha/management';
import type { Device, Snapshot } from '../../../model';
import type { RepairIssue } from '../../../model/notifications';
import { familyName, groupAddonFamilies, integrationFamily } from '../details/families';

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
  readonly hacsRepositoryId?: string;
  readonly compatibility?: 'verified' | 'unknown' | 'incompatible';
  readonly compatibilityReason?: string;
  readonly pendingRestart?: boolean;
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

function isTuyaCloudCameraStub(device: Device, snapshot: Snapshot): boolean {
  if (!device.id.startsWith('tuya:')) return false;
  const devEntities = snapshot.entities.filter((ent) => ent.device_id === device.id);
  if (devEntities.length === 0) return device.category === 'cameras';
  return devEntities.every(
    (ent) =>
      ent.entity_id.startsWith('camera.') &&
      (typeof ent.unique_id === 'string' ? ent.unique_id.startsWith('ep_tuya_') : true),
  );
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
    if (entry.domain === 'tuya' && isTuyaCloudCameraStub(device, snapshot)) return false;
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

export interface IndexedEntityRef {
  readonly entityId: string;
  readonly deviceId?: string;
}

export interface IntegrationStatsIndex {
  readonly devicesByEntryId: ReadonlyMap<string, readonly string[]>;
  readonly entitiesByEntryId: ReadonlyMap<string, readonly IndexedEntityRef[]>;
  readonly entitiesByDeviceId: ReadonlyMap<string, readonly string[]>;
  readonly entitiesByPlatformFamily: ReadonlyMap<string, readonly IndexedEntityRef[]>;
}

function pushMapItem<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Pre-indexes registry devices and entities in a single O(D + E) pass so integration cards
 * compute counts in O(entries) instead of scanning the entire registry per card.
 */
export function buildIntegrationStatsIndex(
  devices: readonly Device[],
  entities: Snapshot['entities'],
): IntegrationStatsIndex {
  const devicesByEntryId = new Map<string, string[]>();
  const entitiesByEntryId = new Map<string, IndexedEntityRef[]>();
  const entitiesByDeviceId = new Map<string, string[]>();
  const entitiesByPlatformFamily = new Map<string, IndexedEntityRef[]>();

  for (const device of devices) {
    const cfg = Array.isArray(device.config_entries) ? (device.config_entries as unknown[]) : [];
    for (const id of cfg) {
      if (typeof id === 'string') pushMapItem(devicesByEntryId, id, device.id);
    }
  }

  for (const ent of entities) {
    const ref: IndexedEntityRef = {
      entityId: ent.entity_id,
      ...(ent.device_id ? { deviceId: ent.device_id } : {}),
    };
    if (typeof ent.config_entry_id === 'string' && ent.config_entry_id) {
      pushMapItem(entitiesByEntryId, ent.config_entry_id, ref);
    }
    if (ent.device_id) {
      pushMapItem(entitiesByDeviceId, ent.device_id, ent.entity_id);
    }
    if (ent.platform) {
      pushMapItem(entitiesByPlatformFamily, integrationFamily(ent.platform), ref);
    }
  }

  return {
    devicesByEntryId,
    entitiesByEntryId,
    entitiesByDeviceId,
    entitiesByPlatformFamily,
  };
}

export function computeIntegrationStatsFromIndex(
  domain: string,
  entries: readonly IntegrationEntry[],
  index: IntegrationStatsIndex,
  meta?: IntegrationDomainMeta,
): { deviceCount: number; entityCount: number } {
  const deviceIds = new Set<string>();
  const entityIds = new Set<string>();

  for (const entry of entries) {
    const devs = index.devicesByEntryId.get(entry.entry_id);
    if (devs) {
      for (const devId of devs) deviceIds.add(devId);
    }
    const ents = index.entitiesByEntryId.get(entry.entry_id);
    if (ents) {
      for (const ent of ents) {
        entityIds.add(ent.entityId);
        if (ent.deviceId) deviceIds.add(ent.deviceId);
      }
    }
  }

  const platformEnts = index.entitiesByPlatformFamily.get(integrationFamily(domain));
  if (platformEnts) {
    for (const ent of platformEnts) {
      entityIds.add(ent.entityId);
      if (ent.deviceId) deviceIds.add(ent.deviceId);
    }
  }

  for (const devId of deviceIds) {
    const devEnts = index.entitiesByDeviceId.get(devId);
    if (devEnts) {
      for (const entityId of devEnts) entityIds.add(entityId);
    }
  }

  return {
    deviceCount: Math.max(deviceIds.size, meta?.deviceCount ?? 0),
    entityCount: Math.max(entityIds.size, meta?.entityCount ?? 0),
  };
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
      (ent.platform && integrationFamily(ent.platform) === integrationFamily(domain))
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

function entryMatchesFilter(
  entry: IntegrationEntry,
  filter: string,
  hasIssue: (entry: IntegrationEntry) => boolean,
): boolean {
  if (filter === 'discovered') return false;
  if (filter === 'all') return true;
  if (filter === 'issues') return hasIssue(entry);
  if (filter === 'disabled') return Boolean(entry.disabled_by);
  return entry.state === 'loaded';
}

export function filterIntegrationEntries(
  entries: readonly IntegrationEntry[],
  domain: string,
  filter: string,
  hasIssue: (entry: IntegrationEntry) => boolean,
): IntegrationEntry[] {
  if (filter === 'discovered') return [];
  return entries.filter(
    (entry) => entry.domain === domain && entryMatchesFilter(entry, filter, hasIssue),
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

export function buildIntegrationGroups(
  entries: readonly IntegrationEntry[],
  filter: string,
  query: string,
  hasIssue: (entry: IntegrationEntry) => boolean,
  formatName: (domain: string) => string,
): Array<{ domain: string; name: string; entries: IntegrationEntry[] }> {
  if (filter === 'discovered') return [];
  const term = query.trim().toLowerCase();
  const byFamily = new Map<string, IntegrationEntry[]>();
  for (const entry of entries) {
    const family = integrationFamily(entry.domain);
    let list = byFamily.get(family);
    if (!list) {
      list = [];
      byFamily.set(family, list);
    }
    list.push(entry);
  }

  const groups: Array<{ domain: string; name: string; entries: IntegrationEntry[] }> = [];
  for (const [domain, familyEntries] of byFamily) {
    if (!familyEntries.some((entry) => entryMatchesFilter(entry, filter, hasIssue))) continue;
    const name = familyName(domain, formatName(domain));
    if (term) {
      const searchable =
        `${name} ${domain} ${familyEntries.map((e) => `${e.domain} ${e.title}`).join(' ')}`.toLowerCase();
      if (!searchable.includes(term)) continue;
    }
    groups.push({
      domain,
      name,
      entries:
        domain === 'tuya' || domain === 'govee'
          ? familyEntries
          : familyEntries.filter(
              (entry) => entry.domain === domain && entryMatchesFilter(entry, filter, hasIssue),
            ),
    });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}

export function filterAddonItems(
  items: readonly AddonInfo[],
  viewStore: boolean,
  filter: string,
  query: string,
): AddonInfo[] {
  const term = query.trim().toLowerCase();
  return groupAddonFamilies(items)
    .filter(
      (group) =>
        `${group.name} ${group.items.map((addon) => `${addon.slug} ${addon.name} ${addon.description}`).join(' ')}`
          .toLowerCase()
          .includes(term) &&
        group.items.some(
          (addon) =>
            viewStore ||
            filter === 'all' ||
            (filter === 'updates' ? addon.update_available : addon.state === filter),
        ),
    )
    .flatMap((group) => group.items);
}

export function buildRepairFlowTarget(repair: RichRepairIssue, title?: string) {
  return {
    domain: repair.domain,
    ...(title ? { title } : {}),
    repair: {
      domain: repair.domain,
      issue_id: repair.issue_id,
      translation_key: repair.translation_key,
    },
  };
}

export function createAddonActionPlan(
  addon: AddonInfo,
  action: string,
  addons: readonly AddonInfo[],
):
  | { immediate: true; operation: () => Promise<unknown>; success: string }
  | {
      immediate: false;
      confirmation: {
        title: string;
        label: string;
        danger: boolean;
        description: string;
        action: () => Promise<unknown>;
      };
    } {
  const installed = addons.some((a) => a.slug === addon.slug);
  const operation = () =>
    action === 'update'
      ? nativeApi().request({ type: 'hassio/update/addon', addon: addon.slug, backup: true })
      : supervisor(
          `/addons/${addon.slug}/${action}`,
          'post',
          action === 'uninstall' ? { remove_config: false } : undefined,
        );
  if (action === 'start') {
    return { immediate: true, operation, success: `${addon.name} started.` };
  }
  return {
    immediate: false,
    confirmation: {
      title: `${humanize(action)} ${addon.name}?`,
      label: humanize(action),
      danger: action === 'uninstall',
      description: buildAddonActionDescription(
        action,
        installed,
        addon.version,
        addon.version_latest,
      ),
      action: operation,
    },
  };
}
