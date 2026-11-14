/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowLeft, CheckCircle2, ExternalLink, Wrench } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { humanize, nativeApi } from '../../../ha/management';
import { formatRelativeAge, type RichRepairIssue } from './types';

export function RepairsPanel({
  issues,
  busy,
  onBack,
  onFix,
  onToggleIgnore,
}: {
  issues: readonly RichRepairIssue[];
  busy: boolean;
  onBack: () => void;
  onFix: (issue: RichRepairIssue) => void;
  onToggleIgnore: (issue: RichRepairIssue, ignore: boolean) => Promise<void>;
}) {
  const [showIgnored, setShowIgnored] = useState(false);
  const visible = issues.filter((item) => (showIgnored ? true : !item.ignored));
  const ignoredCount = issues.filter((item) => item.ignored).length;

  return (
    <section className="connection-detail-page" aria-label="Repairs">
      <div className="system-panel-topbar">
        <Button variant="ghost" className="connection-back" onPress={onBack}>
          <ArrowLeft size={17} />
          Back
        </Button>
        {ignoredCount > 0 && (
          <Button size="sm" variant="secondary" onPress={() => setShowIgnored((prev) => !prev)}>
            {showIgnored ? 'Hide ignored' : `Show ignored (${ignoredCount})`}
          </Button>
        )}
      </div>

      <header className="management-page-head">
        <div>
          <h2>Repairs</h2>
          <p>Resolve integration authentication, setup faults, and runtime warnings.</p>
        </div>
      </header>

      {visible.length === 0 ? (
        <div className="management-empty">
          <CheckCircle2 size={32} />
          <h3>No active repairs</h3>
          <p>Your integrations, bridges, and services are running without repair issues.</p>
        </div>
      ) : (
        <div className="system-list">
          {visible.map((issue) => {
            const title = issue.title || humanize(issue.translation_key ?? issue.issue_id);
            const age = formatRelativeAge(issue.created);
            const sev = issue.severity ?? 'warning';
            return (
              <article
                key={`${issue.domain}:${issue.issue_id}`}
                className={`system-item-card ${issue.ignored ? 'is-muted' : ''}`}
              >
                <span className="integration-logo">
                  <BrandIcon
                    kind="integration"
                    id={issue.domain}
                    hint={issue.sourceLabel ? { name: issue.sourceLabel } : undefined}
                  />
                </span>
                <div className="system-item-copy">
                  <div className="system-item-title-row">
                    <h3>{title}</h3>
                    <span className={`repair-badge repair-badge-${sev}`}>{humanize(sev)}</span>
                    {issue.ignored && <span className="repair-badge">Ignored</span>}
                  </div>
                  {issue.description && <p>{issue.description}</p>}
                  <small>
                    {issue.sourceLabel || humanize(issue.domain)}
                    {age ? ` · Reported ${age}` : ''}
                  </small>
                </div>
                <div className="system-item-actions">
                  {issue.learn_more_url && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() =>
                        void nativeApi()
                          .openExternal(issue.learn_more_url!)
                          .catch(() => {})
                      }
                    >
                      Docs
                      <ExternalLink size={13} />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => void onToggleIgnore(issue, !issue.ignored)}
                  >
                    {issue.ignored ? 'Restore' : 'Ignore'}
                  </Button>
                  {issue.is_fixable !== false && !issue.ignored && (
                    <Button
                      size="sm"
                      className="flow-next-pill"
                      isDisabled={busy}
                      onPress={() => onFix(issue)}
                    >
                      <Wrench size={14} />
                      Fix
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
