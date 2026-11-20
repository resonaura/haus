/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo } from 'react';
import { Button } from '@heroui/react';
import { ArrowUpCircle, Cable, ChevronRight, Plus } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { humanize, type FlowProgress, type IntegrationEntry } from '../../../ha/management';
import type { Snapshot } from '../../../model';
import { entryHasIssueOrAttention } from '../integration-health';
import type { FlowTarget } from '../IntegrationFlow';
import { usePendingTuyaCameras, type TuyaPendingCamera } from '../flow/tuya-camera-pending';
import { integrationFamily, integrationSummary } from './families';
import {
  computeIntegrationStats,
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

export function IntegrationsGrid({
  groups,
  snapshot,
  metaByDomain,
  progress,
  issues,
  updates,
  installingUpdateId,
  loading,
  error,
  search,
  pendingTuya: providedPendingTuya,
  onSelect,
  onFlow,
  onInstallUpdate,
}: {
  groups: readonly IntegrationGroup[];
  snapshot: Snapshot;
  metaByDomain: ReadonlyMap<string, IntegrationDomainMeta>;
  progress: readonly FlowProgress[];
  issues: readonly RichRepairIssue[];
  updates: UnifiedUpdatesResponse | null;
  installingUpdateId?: string | null;
  loading: boolean;
  error: string;
  search: string;
  pendingTuya?: ReadonlyArray<TuyaPendingCamera>;
  onSelect: (domain: string) => void;
  onFlow: (target: FlowTarget) => void;
  onInstallUpdate?: (item: UnifiedUpdateItem) => Promise<void>;
}) {
  const admin = snapshot.user.is_admin;
  const tuyaEntries = useMemo(
    () => groups.filter((g) => g.domain === 'tuya').flatMap((g) => g.entries),
    [groups],
  );
  const { pending: hookedPendingTuya } = usePendingTuyaCameras(snapshot, {
    enabled: !providedPendingTuya && tuyaEntries.some((entry) => !entry.disabled_by),
    entries: tuyaEntries,
  });
  const pendingTuya = providedPendingTuya ?? hookedPendingTuya;

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

  return (
    <div className="integration-grid">
      {groups.map((group) => {
        const componentMeta = [...metaByDomain.values()].filter(
          (item) => integrationFamily(item.domain) === group.domain,
        );
        const meta = metaByDomain.get(group.domain) ?? componentMeta[0];
        const stats = computeIntegrationStats(group.domain, group.entries, snapshot, meta);
        const hasStandardAttention =
          group.entries.some((entry) => entryHasIssueOrAttention(entry, [...progress], issues)) ||
          componentMeta.some((item) => item.brokenCount > 0);
        const allDisabled =
          group.entries.length > 0 && group.entries.every((e) => Boolean(e.disabled_by));
        const tuyaPendingHere = !allDisabled && group.domain === 'tuya' && pendingTuya.length > 0;
        const hasAttention = hasStandardAttention || tuyaPendingHere;
        const domainUpdate = (updates?.items ?? []).find(
          (u) => u.updateAvailable && integrationFamily(u.domain) === group.domain,
        );
        const hasUpdate = Boolean(domainUpdate);
        const updatingThis = Boolean(domainUpdate && installingUpdateId === domainUpdate.id);

        const iconKind =
          meta?.runtimeType === 'homebridge'
            ? 'homebridge'
            : meta?.runtimeType === 'scrypted'
              ? 'scrypted'
              : meta?.runtimeType === 'addon'
                ? 'addon'
                : meta?.runtimeType === 'docker_app'
                  ? 'app'
                  : 'integration';

        return (
          <article
            key={group.domain}
            className="integration-card"
            data-attention={hasAttention || undefined}
          >
            <div className="integration-card-head">
              <span className="integration-logo">
                <BrandIcon
                  kind={iconKind}
                  id={group.domain}
                  hint={{
                    ...(group.name || meta?.name ? { name: group.name || meta?.name } : {}),
                    ...(meta?.runtimeType ? { category: meta.runtimeType } : {}),
                  }}
                />
              </span>
              <div className="integration-heading">
                <h3>{group.name || humanize(group.domain)}</h3>
                <p>{integrationSummary(group.entries, stats.deviceCount)}</p>
              </div>
              {hasAttention && (
                <span className="attention-pill">
                  {hasStandardAttention || !tuyaPendingHere ? 'Attention' : 'Setup incomplete'}
                </span>
              )}
              {!hasAttention && hasUpdate && <span className="update-pill">Update</span>}
              {!hasAttention && !hasUpdate && allDisabled && (
                <span className="status-badge">Disabled</span>
              )}
            </div>

            <div className="integration-entry-summary">
              {group.entries.slice(0, 2).map((entry) => (
                <span key={entry.entry_id}>{entry.title}</span>
              ))}
              {group.entries.length > 2 && <small>+{group.entries.length - 2} more</small>}
              {stats.entityCount > 0 && (
                <small>
                  {stats.entityCount} {stats.entityCount === 1 ? 'entity' : 'entities'}
                </small>
              )}
            </div>

            <div className="integration-manage">
              {domainUpdate && admin && onInstallUpdate && (
                <Button
                  size="sm"
                  className="flow-next-pill"
                  isPending={updatingThis}
                  isDisabled={Boolean(installingUpdateId) || domainUpdate.compatibility === 'incompatible'}
                  onPress={() => void onInstallUpdate(domainUpdate)}
                >
                  <ArrowUpCircle size={14} />
                  {updatingThis ? 'Updating…' : `Update (${domainUpdate.latestVersion})`}
                </Button>
              )}
              <Button variant="secondary" onPress={() => onSelect(group.domain)}>
                Manage
                <ChevronRight size={16} />
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
