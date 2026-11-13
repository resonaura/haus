/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
import { Cable, ChevronRight, Plus } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { humanize, type FlowProgress, type IntegrationEntry } from '../../../ha/management';
import type { Snapshot } from '../../../model';
import { entryNeedsAttention } from '../integration-health';
import type { FlowTarget } from '../IntegrationFlow';
import {
  computeIntegrationStats,
  type IntegrationDomainMeta,
  type RichRepairIssue,
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
  loading,
  error,
  search,
  onSelect,
  onFlow,
}: {
  groups: readonly IntegrationGroup[];
  snapshot: Snapshot;
  metaByDomain: ReadonlyMap<string, IntegrationDomainMeta>;
  progress: readonly FlowProgress[];
  issues: readonly RichRepairIssue[];
  updates: UnifiedUpdatesResponse | null;
  loading: boolean;
  error: string;
  search: string;
  onSelect: (domain: string) => void;
  onFlow: (target: FlowTarget) => void;
}) {
  const admin = snapshot.user.is_admin;

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
        const meta = metaByDomain.get(group.domain);
        const stats = computeIntegrationStats(group.domain, group.entries, snapshot, meta);
        const hasAttention =
          group.entries.some(
            (entry) =>
              entryNeedsAttention(entry, [...progress]) ||
              (!entry.disabled_by &&
                issues.some(
                  (i) =>
                    !i.ignored && (i.domain === entry.domain || i.issue_domain === entry.domain),
                )),
          ) || (meta?.brokenCount ?? 0) > 0;
        const hasUpdate = (updates?.items ?? []).some(
          (u) => u.updateAvailable && u.domain === group.domain,
        );
        const allDisabled =
          group.entries.length > 0 && group.entries.every((e) => Boolean(e.disabled_by));

        return (
          <article
            key={group.domain}
            className="integration-card"
            data-attention={hasAttention || undefined}
          >
            <div className="integration-card-head">
              <span className="integration-logo">
                <BrandIcon kind="integration" id={group.domain} />
              </span>
              <div className="integration-heading">
                <h3>{group.name || humanize(group.domain)}</h3>
                <p>
                  {group.entries.length} {group.entries.length === 1 ? 'account' : 'accounts'} ·{' '}
                  {stats.deviceCount} {stats.deviceCount === 1 ? 'device' : 'devices'}
                </p>
              </div>
              {hasAttention && <span className="attention-pill">Attention</span>}
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
