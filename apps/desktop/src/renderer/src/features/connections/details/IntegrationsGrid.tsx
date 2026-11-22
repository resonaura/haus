/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useMemo } from 'react';
import { Button } from '@heroui/react';
import { ArrowUpCircle, Cable, ChevronRight, Plus } from 'lucide-react';
import { BrandIcon, type BrandIconProps } from '../../../components/brand/BrandIcon';
import { type FlowProgress, type IntegrationEntry } from '../../../ha/management';
import type { Device, Snapshot } from '../../../model';
import type { FlowTarget } from '../IntegrationFlow';
import { integrationFamily, integrationSummary } from './families';
import {
  buildIntegrationStatsIndex,
  computeIntegrationStatsFromIndex,
  type IntegrationDomainMeta,
  type RichRepairIssue,
  type UnifiedUpdateItem,
  type UnifiedUpdatesResponse,
} from '../system/types';

export interface IntegrationGroup {
  readonly domain: string;
  readonly name: string;
  readonly entries: IntegrationEntry[];
}

const ERROR_ENTRY_STATES = new Set([
  'setup_error',
  'migration_error',
  'setup_retry',
  'failed_unload',
]);

interface IntegrationCardModel {
  readonly domain: string;
  readonly displayName: string;
  readonly summary: string;
  readonly firstEntryTitle: string;
  readonly secondEntryTitle: string;
  readonly extraEntries: number;
  readonly entityCount: number;
  readonly hasAttention: boolean;
  readonly attentionLabel: string;
  readonly allDisabled: boolean;
  readonly domainUpdate?: UnifiedUpdateItem;
  readonly iconKind: BrandIconProps['kind'];
  readonly iconName: string;
  readonly iconCategory: string;
}

const IntegrationCard = memo(function IntegrationCard({
  card,
  admin,
  updatingThis,
  anyUpdating,
  onSelect,
  onInstallUpdate,
}: {
  card: IntegrationCardModel;
  admin: boolean;
  updatingThis: boolean;
  anyUpdating: boolean;
  onSelect: (domain: string) => void;
  onInstallUpdate?: (item: UnifiedUpdateItem) => Promise<void>;
}) {
  const iconHint = useMemo(
    () => ({
      ...(card.iconName ? { name: card.iconName } : {}),
      ...(card.iconCategory ? { category: card.iconCategory } : {}),
    }),
    [card.iconName, card.iconCategory],
  );

  const hasUpdate = Boolean(card.domainUpdate);

  return (
    <article className="integration-card" data-attention={card.hasAttention || undefined}>
      <div className="integration-card-head">
        <span className="integration-logo">
          <BrandIcon kind={card.iconKind} id={card.domain} hint={iconHint} />
        </span>
        <div className="integration-heading">
          <h3>{card.displayName}</h3>
          <p>{card.summary}</p>
        </div>
        {card.hasAttention && <span className="attention-pill">{card.attentionLabel}</span>}
        {!card.hasAttention && hasUpdate && <span className="update-pill">Update</span>}
        {!card.hasAttention && !hasUpdate && card.allDisabled && (
          <span className="status-badge">Disabled</span>
        )}
      </div>

      <div className="integration-entry-summary">
        {card.firstEntryTitle && <span>{card.firstEntryTitle}</span>}
        {card.secondEntryTitle && <span>{card.secondEntryTitle}</span>}
        {card.extraEntries > 0 && <small>+{card.extraEntries} more</small>}
        {card.entityCount > 0 && (
          <small>
            {card.entityCount} {card.entityCount === 1 ? 'entity' : 'entities'}
          </small>
        )}
      </div>

      <div className="integration-manage">
        {card.domainUpdate && admin && onInstallUpdate && (
          <Button
            size="sm"
            className="flow-next-pill"
            isPending={updatingThis}
            isDisabled={anyUpdating || card.domainUpdate.compatibility === 'incompatible'}
            onPress={() => void onInstallUpdate(card.domainUpdate!)}
          >
            <ArrowUpCircle size={14} />
            {updatingThis ? 'Updating…' : `Update (${card.domainUpdate.latestVersion})`}
          </Button>
        )}
        <Button variant="secondary" onPress={() => onSelect(card.domain)}>
          Manage
          <ChevronRight size={16} />
        </Button>
      </div>
    </article>
  );
});

export const IntegrationsGrid = memo(function IntegrationsGrid({
  groups,
  devices,
  entities,
  admin,
  metaByDomain,
  progress,
  issues,
  updates,
  installingUpdateId,
  loading,
  error,
  search,
  hasPendingTuya = false,
  onSelect,
  onFlow,
  onInstallUpdate,
}: {
  groups: readonly IntegrationGroup[];
  devices: readonly Device[];
  entities: Snapshot['entities'];
  admin: boolean;
  metaByDomain: ReadonlyMap<string, IntegrationDomainMeta>;
  progress: readonly FlowProgress[];
  issues: readonly RichRepairIssue[];
  updates: UnifiedUpdatesResponse | null;
  installingUpdateId?: string | null;
  loading: boolean;
  error: string;
  search: string;
  hasPendingTuya?: boolean;
  onSelect: (domain: string) => void;
  onFlow: (target: FlowTarget) => void;
  onInstallUpdate?: (item: UnifiedUpdateItem) => Promise<void>;
}) {
  const statsIndex = useMemo(
    () => buildIntegrationStatsIndex(devices, entities),
    [devices, entities],
  );

  const metaByFamily = useMemo(() => {
    const map = new Map<string, IntegrationDomainMeta[]>();
    for (const item of metaByDomain.values()) {
      const family = integrationFamily(item.domain);
      const list = map.get(family);
      if (list) list.push(item);
      else map.set(family, [item]);
    }
    return map;
  }, [metaByDomain]);

  const updateByFamily = useMemo(() => {
    const map = new Map<string, UnifiedUpdateItem>();
    for (const item of updates?.items ?? []) {
      if (!item.updateAvailable) continue;
      const family = integrationFamily(item.domain);
      if (!map.has(family)) map.set(family, item);
    }
    return map;
  }, [updates]);

  const attentionIndex = useMemo(() => {
    const reauthKeys = new Set<string>();
    for (const flow of progress) {
      const source = flow.context?.source ?? '';
      if ((source === 'reauth' || source === 'reconfigure') && flow.context?.entry_id) {
        reauthKeys.add(`${flow.handler}:${flow.context.entry_id}`);
      }
    }
    const issueDomains = new Set<string>();
    for (const item of issues) {
      if (item.ignored) continue;
      issueDomains.add(item.domain);
      if (item.issue_domain) issueDomains.add(item.issue_domain);
    }
    return { reauthKeys, issueDomains };
  }, [progress, issues]);

  const cards = useMemo<IntegrationCardModel[]>(() => {
    return groups.map((group) => {
      const componentMeta = metaByFamily.get(group.domain) ?? [];
      const meta = metaByDomain.get(group.domain) ?? componentMeta[0];
      const stats = computeIntegrationStatsFromIndex(group.domain, group.entries, statsIndex, meta);

      const hasStandardAttention =
        group.entries.some((entry) => {
          if (entry.disabled_by) return false;
          if (ERROR_ENTRY_STATES.has(entry.state)) return true;
          if (attentionIndex.reauthKeys.has(`${entry.domain}:${entry.entry_id}`)) return true;
          return attentionIndex.issueDomains.has(entry.domain);
        }) || componentMeta.some((item) => item.brokenCount > 0);

      const allDisabled =
        group.entries.length > 0 && group.entries.every((e) => Boolean(e.disabled_by));
      const tuyaPendingHere = !allDisabled && group.domain === 'tuya' && hasPendingTuya;
      const hasAttention = hasStandardAttention || tuyaPendingHere;
      const domainUpdate = updateByFamily.get(group.domain);

      const iconKind: BrandIconProps['kind'] =
        meta?.runtimeType === 'homebridge'
          ? 'homebridge'
          : meta?.runtimeType === 'scrypted'
            ? 'scrypted'
            : meta?.runtimeType === 'addon'
              ? 'addon'
              : meta?.runtimeType === 'docker_app'
                ? 'app'
                : 'integration';

      return {
        domain: group.domain,
        displayName: group.name || group.domain,
        summary: integrationSummary(group.entries, stats.deviceCount),
        firstEntryTitle: group.entries[0]?.title ?? '',
        secondEntryTitle: group.entries[1]?.title ?? '',
        extraEntries: Math.max(0, group.entries.length - 2),
        entityCount: stats.entityCount,
        hasAttention,
        attentionLabel: hasStandardAttention || !tuyaPendingHere ? 'Attention' : 'Setup incomplete',
        allDisabled,
        ...(domainUpdate ? { domainUpdate } : {}),
        iconKind,
        iconName: group.name || meta?.name || '',
        iconCategory: meta?.runtimeType ?? '',
      };
    });
  }, [
    groups,
    metaByFamily,
    metaByDomain,
    statsIndex,
    attentionIndex,
    hasPendingTuya,
    updateByFamily,
  ]);

  if (loading && groups.length === 0) return null;

  if (groups.length === 0) {
    return (
      <div className="management-empty">
        <Cable size={34} />
        <h3>
          {error
            ? 'Could not load integrations'
            : search
              ? 'No matching integrations'
              : 'No integrations configured'}
        </h3>
        <p>
          {search
            ? 'Clear the filter to see all connected integrations.'
            : 'Add an integration, bridge plugin, or smart home service to connect devices.'}
        </p>
        {!search && admin && (
          <Button onPress={() => onFlow({})}>
            <Plus size={15} />
            Add integration
          </Button>
        )}
      </div>
    );
  }

  const anyUpdating = Boolean(installingUpdateId);

  return (
    <div className="integration-grid">
      {cards.map((card) => (
        <IntegrationCard
          key={card.domain}
          card={card}
          admin={admin}
          updatingThis={Boolean(card.domainUpdate && installingUpdateId === card.domainUpdate.id)}
          anyUpdating={anyUpdating}
          onSelect={onSelect}
          onInstallUpdate={onInstallUpdate}
        />
      ))}
    </div>
  );
});
