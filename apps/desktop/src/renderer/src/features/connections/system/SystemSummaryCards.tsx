/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ArrowUpCircle, ChevronRight } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { humanize } from '../../../ha/management';
import {
  formatCategoryBadge,
  formatRelativeAge,
  type RichRepairIssue,
  type UnifiedUpdateItem,
  type UnifiedUpdatesResponse,
} from './types';

export function SystemSummaryCards({
  issues,
  updates,
  onOpenRepairs,
  onFixRepair,
  onOpenUpdates,
}: {
  issues: readonly RichRepairIssue[];
  updates: UnifiedUpdatesResponse | null;
  onOpenRepairs: () => void;
  onFixRepair: (issue: RichRepairIssue) => void;
  onOpenUpdates: () => void;
}) {
  const activeRepairs = issues.filter((item) => !item.ignored);
  const availableUpdates: readonly UnifiedUpdateItem[] = (updates?.items ?? []).filter(
    (item) => item.updateAvailable,
  );
  const totalUpdates = updates?.total ?? 0;

  if (activeRepairs.length === 0 && availableUpdates.length === 0 && totalUpdates === 0) {
    return null;
  }

  return (
    <section className="system-summary-stack" aria-label="Repairs and updates">
      {activeRepairs.length > 0 && (
        <div className="system-summary-card">
          <button type="button" className="system-summary-header" onClick={onOpenRepairs}>
            <span>
              {activeRepairs.length} {activeRepairs.length === 1 ? 'repair' : 'repairs'}
            </span>
            <ChevronRight size={16} />
          </button>
          <div className="system-summary-rows">
            {activeRepairs.slice(0, 2).map((issue) => {
              const title = issue.title || humanize(issue.translation_key ?? issue.issue_id);
              const age = formatRelativeAge(issue.created);
              const source = issue.sourceLabel || humanize(issue.domain);
              const sev = humanize(issue.severity ?? 'warning');
              return (
                <button
                  key={`${issue.domain}:${issue.issue_id}`}
                  type="button"
                  className="system-summary-row"
                  onClick={() => (issue.is_fixable ? onFixRepair(issue) : onOpenRepairs())}
                >
                  <span className="integration-logo system-summary-icon">
                    <BrandIcon kind="integration" id={issue.domain} />
                  </span>
                  <span className="system-summary-copy">
                    <strong>{title}</strong>
                    <small>
                      <span
                        className={
                          issue.severity === 'error' || issue.severity === 'critical'
                            ? 'repair-sev-error'
                            : 'repair-sev-warn'
                        }
                      >
                        {sev}
                      </span>
                      {age ? ` · ${age}` : ''}
                      {source ? ` by ${source}` : ''}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(availableUpdates.length > 0 || totalUpdates > 0) && (
        <div className="system-summary-card">
          <button type="button" className="system-summary-header" onClick={onOpenUpdates}>
            <span>
              {availableUpdates.length > 0
                ? `${availableUpdates.length} ${availableUpdates.length === 1 ? 'update' : 'updates'}`
                : 'Updates · All up to date'}
            </span>
            <ChevronRight size={16} />
          </button>
          {availableUpdates.length > 0 && (
            <div className="system-summary-rows">
              {availableUpdates.slice(0, 2).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="system-summary-row"
                  onClick={onOpenUpdates}
                >
                  <span className="integration-logo system-summary-icon">
                    {item.category === 'core' ? (
                      <ArrowUpCircle size={20} />
                    ) : (
                      <BrandIcon kind="integration" id={item.domain} />
                    )}
                  </span>
                  <span className="system-summary-copy">
                    <strong>{item.title}</strong>
                    <small>
                      {formatCategoryBadge(item.category)} · {item.installedVersion} →{' '}
                      {item.latestVersion}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
