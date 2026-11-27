/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  entryNeedsAttention,
  findAttentionFlow,
  integrationFamilyKey,
  isIntegrationEntryIssue,
  type DiscoveredFlowItem,
  type IntegrationDomainMetaRecord,
  type IntegrationEntryRecord,
  type IntegrationGroupSummary,
  type RepairIssueRecord,
  type UnifiedUpdateRecord,
  type UnifiedUpdatesSummary,
} from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import {
  filterPortableDiscoveredFlows,
  formatDiscoverySourceLabel,
  isDiscoveredFlowSource,
  type BrandIconKind,
  type IntegrationEntryDetailItem,
  type PortableDiscoveredFlow,
  type PortableIntegrationCardItem,
} from '@haus/ui/components';
import { isRecord } from '../../../main/hub/types.js';

export function parseAllFlowProgress(raw: unknown): DiscoveredFlowItem[] {
  if (!Array.isArray(raw)) return [];
  const out: DiscoveredFlowItem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const flowId = typeof item.flow_id === 'string' ? item.flow_id : '';
    const handler = typeof item.handler === 'string' ? item.handler : '';
    if (!flowId || !handler) continue;
    const ctx = isRecord(item.context) ? item.context : undefined;
    const source = typeof ctx?.source === 'string' ? ctx.source : undefined;
    const entryId = typeof ctx?.entry_id === 'string' ? ctx.entry_id : undefined;
    const placeholders = isRecord(ctx?.title_placeholders) ? ctx.title_placeholders : undefined;
    const title = typeof placeholders?.name === 'string' ? placeholders.name : '';
    out.push({
      flow_id: flowId,
      handler,
      title,
      ...(source ? { source } : {}),
      ...(entryId ? { entry_id: entryId } : {}),
    });
  }
  return out;
}

export function parseDiscoveredFlows(raw: unknown): DiscoveredFlowItem[] {
  return parseAllFlowProgress(raw).filter((item) => isDiscoveredFlowSource(item.source));
}

export function runtimeIconKind(
  runtimeType?: IntegrationDomainMetaRecord['runtimeType'],
): BrandIconKind {
  if (runtimeType === 'homebridge') return 'homebridge';
  if (runtimeType === 'scrypted') return 'scrypted';
  if (runtimeType === 'custom_integration') return 'hacs';
  if (runtimeType === 'addon' || runtimeType === 'docker_app') return 'app';
  return 'integration';
}

export function buildGpuiDiscoveredItems(
  flows: readonly DiscoveredFlowItem[],
  query: string,
  resolveTitle: (domain: string) => string,
): PortableDiscoveredFlow[] {
  const mapped = flows
    .filter((item) => isDiscoveredFlowSource(item.source))
    .map((item) => {
      const integrationTitle = resolveTitle(item.handler);
      return {
        flowId: item.flow_id,
        handler: item.handler,
        integrationTitle,
        deviceLabel: item.title || integrationTitle,
        source: item.source,
        sourceLabel: formatDiscoverySourceLabel(item.source),
      };
    });
  return filterPortableDiscoveredFlows(mapped, query);
}

export function buildGpuiIntegrationCards(
  visibleGroups: readonly IntegrationGroupSummary[],
  metaByDomain: ReadonlyMap<string, IntegrationDomainMetaRecord>,
  issues: readonly RepairIssueRecord[],
  updates: UnifiedUpdatesSummary | null,
  progress: readonly DiscoveredFlowItem[] = [],
): PortableIntegrationCardItem[] {
  return visibleGroups.map((group) => {
    const meta = metaByDomain.get(group.domain);
    const hasAttention = group.entries.some((entry) =>
      isIntegrationEntryIssue(entry, issues, progress),
    );
    const domainUpdate = updates?.items.find(
      (item) => item.updateAvailable && integrationFamilyKey(item.domain) === group.domain,
    );
    const first = group.entries[0]?.title ?? '';
    const second = group.entries[1]?.title ?? '';
    const deviceCount = meta?.deviceCount ?? 0;
    const accountText = `${group.entries.length} ${group.entries.length === 1 ? 'account' : 'accounts'}`;
    return {
      domain: group.domain,
      displayName: group.name,
      summary:
        deviceCount > 0
          ? `${accountText} · ${deviceCount} ${deviceCount === 1 ? 'device' : 'devices'}`
          : accountText,
      firstEntryTitle: first,
      secondEntryTitle: second,
      extraEntries: Math.max(0, group.entries.length - 2),
      entityCount: meta?.entityCount ?? 0,
      hasAttention,
      attentionLabel: 'Attention',
      hasUpdate: Boolean(domainUpdate),
      allDisabled: group.entries.every((entry) => Boolean(entry.disabled_by)),
      iconKind: runtimeIconKind(meta?.runtimeType),
      iconName: group.name,
      iconCategory: meta?.runtimeType,
      updateItem: domainUpdate,
    };
  });
}

export function buildGpuiEntryDetails(
  entries: readonly IntegrationEntryRecord[],
  progress: readonly DiscoveredFlowItem[],
  snapshot: Snapshot,
): IntegrationEntryDetailItem[] {
  const areaById = new Map(snapshot.areas.map((a) => [a.area_id, a.name]));
  const entityCountByDevice = new Map<string, number>();
  const primaryEntityByDevice = new Map<string, string>();
  for (const entity of snapshot.entities) {
    if (!entity.device_id || entity.disabled_by) continue;
    entityCountByDevice.set(entity.device_id, (entityCountByDevice.get(entity.device_id) ?? 0) + 1);
    if (!primaryEntityByDevice.has(entity.device_id)) {
      primaryEntityByDevice.set(entity.device_id, entity.entity_id);
    }
  }

  return entries.map((entry) => {
    const flow = findAttentionFlow(entry, progress);
    const needsAttention = entryNeedsAttention(entry, progress);
    const devices = snapshot.devices
      .filter(
        (dev) => Array.isArray(dev.config_entries) && dev.config_entries.includes(entry.entry_id),
      )
      .map((dev) => ({
        id: dev.id,
        name: dev.name_by_user || dev.name || dev.id,
        ...(dev.model ? { model: dev.model } : {}),
        ...(dev.manufacturer ? { manufacturer: dev.manufacturer } : {}),
        ...(dev.area_id && areaById.has(dev.area_id)
          ? { areaName: areaById.get(dev.area_id) }
          : {}),
        entityCount: entityCountByDevice.get(dev.id) ?? 0,
        ...(primaryEntityByDevice.has(dev.id)
          ? { primaryEntityId: primaryEntityByDevice.get(dev.id) }
          : {}),
      }));

    return {
      entryId: entry.entry_id,
      title: entry.title,
      domain: entry.domain,
      state: entry.state,
      disabledBy: entry.disabled_by,
      reason: entry.reason,
      canUnload: entry.supports_unload !== false,
      supportsOptions: entry.supports_options !== false,
      supportsReconfigure: entry.supports_reconfigure,
      needsAttention,
      ...(flow?.source === 'reauth' || flow?.source === 'reconfigure'
        ? { attentionSource: flow.source, attentionFlowId: flow.flow_id }
        : {}),
      devices,
    };
  });
}

export function applyDemoUpdateInstall(
  prev: UnifiedUpdatesSummary | null,
  item: UnifiedUpdateRecord,
): UnifiedUpdatesSummary | null {
  if (!prev) return null;
  return {
    ...prev,
    availableCount: Math.max(0, prev.availableCount - 1),
    items: prev.items.map((u) =>
      u.id === item.id ? { ...u, updateAvailable: false, installedVersion: u.latestVersion } : u,
    ),
  };
}
