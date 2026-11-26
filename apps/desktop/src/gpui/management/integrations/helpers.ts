/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  integrationFamilyKey,
  isIntegrationEntryIssue,
  type DiscoveredFlowItem,
  type IntegrationDomainMetaRecord,
  type IntegrationGroupSummary,
  type RepairIssueRecord,
  type UnifiedUpdateRecord,
  type UnifiedUpdatesSummary,
} from '@haus/core/transport';
import {
  filterPortableDiscoveredFlows,
  formatDiscoverySourceLabel,
  isDiscoveredFlowSource,
  type BrandIconKind,
  type PortableDiscoveredFlow,
  type PortableIntegrationCardItem,
} from '@haus/ui/components';
import { isRecord } from '../../../main/hub/types.js';

export function parseDiscoveredFlows(raw: unknown): DiscoveredFlowItem[] {
  if (!Array.isArray(raw)) return [];
  const out: DiscoveredFlowItem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const flowId = typeof item.flow_id === 'string' ? item.flow_id : '';
    const handler = typeof item.handler === 'string' ? item.handler : '';
    if (!flowId || !handler) continue;
    const ctx = isRecord(item.context) ? item.context : undefined;
    const source = typeof ctx?.source === 'string' ? ctx.source : undefined;
    if (!isDiscoveredFlowSource(source)) continue;
    const placeholders = isRecord(ctx?.title_placeholders) ? ctx.title_placeholders : undefined;
    const title = typeof placeholders?.name === 'string' ? placeholders.name : '';
    out.push({ flow_id: flowId, handler, title, source });
  }
  return out;
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
  const mapped = flows.map((item) => {
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
): PortableIntegrationCardItem[] {
  return visibleGroups.map((group) => {
    const meta = metaByDomain.get(group.domain);
    const hasAttention = group.entries.some((entry) => isIntegrationEntryIssue(entry, issues));
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
