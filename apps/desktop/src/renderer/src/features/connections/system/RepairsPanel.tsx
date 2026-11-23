/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, HausButton, Heading, Text } from '@haus/ui';
import { ArrowLeft, CheckCircle2, ExternalLink, Wrench } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { humanize, nativeApi } from '../../../ha/management';
import { formatRelativeAge, type RichRepairIssue } from './types';

export function RepairsPanel({
  issues,
  formatDomain = (domain) => domain,
  busy,
  onBack,
  onFix,
  onToggleIgnore,
}: {
  issues: readonly RichRepairIssue[];
  formatDomain?: (domain: string) => string;
  busy: boolean;
  onBack: () => void;
  onFix: (issue: RichRepairIssue) => void;
  onToggleIgnore: (issue: RichRepairIssue, ignore: boolean) => Promise<void>;
}) {
  const [showIgnored, setShowIgnored] = useState(false);
  const visible = issues.filter((item) => (showIgnored ? true : !item.ignored));
  const ignoredCount = issues.filter((item) => item.ignored).length;

  return (
    <Box semantic="section" className="connection-detail-page" ariaLabel="Repairs">
      <Box className="system-panel-topbar">
        <HausButton variant="ghost" className="connection-back" onPress={onBack}>
          <ArrowLeft size={17} />
          Back
        </HausButton>
        {ignoredCount > 0 && (
          <HausButton size="sm" variant="secondary" onPress={() => setShowIgnored((prev) => !prev)}>
            {showIgnored ? 'Hide ignored' : `Show ignored (${ignoredCount})`}
          </HausButton>
        )}
      </Box>

      <Box semantic="header" className="management-page-head">
        <Box>
          <Heading level={2}>Repairs</Heading>
          <Text semantic="p">
            Resolve integration authentication, setup faults, and runtime warnings.
          </Text>
        </Box>
      </Box>

      {visible.length === 0 ? (
        <Box className="management-empty">
          <CheckCircle2 size={32} />
          <Heading level={3}>No active repairs</Heading>
          <Text semantic="p">
            Your integrations, bridges, and services are running without repair issues.
          </Text>
        </Box>
      ) : (
        <Box className="system-list">
          {visible.map((issue) => {
            const title = issue.title || humanize(issue.translation_key ?? issue.issue_id);
            const age = formatRelativeAge(issue.created);
            const sev = issue.severity ?? 'warning';
            return (
              <Box
                semantic="article"
                key={`${issue.domain}:${issue.issue_id}`}
                className={`system-item-card ${issue.ignored ? 'is-muted' : ''}`}
              >
                <Text className="integration-logo">
                  <BrandIcon
                    kind="integration"
                    id={issue.domain}
                    hint={issue.sourceLabel ? { name: issue.sourceLabel } : undefined}
                  />
                </Text>
                <Box className="system-item-copy">
                  <Box className="system-item-title-row">
                    <Heading level={3}>{title}</Heading>
                    <Text className={`repair-badge repair-badge-${sev}`}>{humanize(sev)}</Text>
                    {issue.ignored && <Text className="repair-badge">Ignored</Text>}
                  </Box>
                  {issue.description && <Text semantic="p">{issue.description}</Text>}
                  <Text semantic="small">
                    {issue.sourceLabel || formatDomain(issue.domain)}
                    {age ? ` · Reported ${age}` : ''}
                  </Text>
                </Box>
                <Box className="system-item-actions">
                  {issue.learn_more_url && (
                    <HausButton
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
                    </HausButton>
                  )}
                  <HausButton
                    size="sm"
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => void onToggleIgnore(issue, !issue.ignored)}
                  >
                    {issue.ignored ? 'Restore' : 'Ignore'}
                  </HausButton>
                  {issue.is_fixable !== false && !issue.ignored && (
                    <HausButton
                      size="sm"
                      className="flow-next-pill"
                      isDisabled={busy}
                      onPress={() => onFix(issue)}
                    >
                      <Wrench size={14} />
                      Fix
                    </HausButton>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
