/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useMemo } from 'react';
import { Box, Pressable, Text } from '@haus/ui';
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

export const SystemSummaryCards = memo(function SystemSummaryCards({
  issues,
  updates,
  formatDomain = (domain) => domain,
  onOpenRepairs,
  onFixRepair,
  onOpenUpdates,
}: {
  issues: readonly RichRepairIssue[];
  updates: UnifiedUpdatesResponse | null;
  formatDomain?: (domain: string) => string;
  onOpenRepairs: () => void;
  onFixRepair: (issue: RichRepairIssue) => void;
  onOpenUpdates: () => void;
}) {
  const activeRepairs = useMemo(() => issues.filter((item) => !item.ignored), [issues]);
  const availableUpdates = useMemo<readonly UnifiedUpdateItem[]>(
    () => (updates?.items ?? []).filter((item) => item.updateAvailable),
    [updates],
  );
  const totalUpdates = updates?.total ?? 0;

  if (activeRepairs.length === 0 && availableUpdates.length === 0 && totalUpdates === 0) {
    return null;
  }

  return (
    <Box semantic="section" className="system-summary-stack" ariaLabel="Repairs and updates">
      {activeRepairs.length > 0 && (
        <Box className="system-summary-card">
          <Pressable className="system-summary-header" onPress={onOpenRepairs}>
            <Text>
              {activeRepairs.length} {activeRepairs.length === 1 ? 'repair' : 'repairs'}
            </Text>
            <ChevronRight size={16} />
          </Pressable>
          <Box className="system-summary-rows">
            {activeRepairs.slice(0, 2).map((issue) => {
              const title = issue.title || humanize(issue.translation_key ?? issue.issue_id);
              const age = formatRelativeAge(issue.created);
              const source = issue.sourceLabel || formatDomain(issue.domain);
              const sev = humanize(issue.severity ?? 'warning');
              return (
                <Pressable
                  key={`${issue.domain}:${issue.issue_id}`}
                  className="system-summary-row"
                  onPress={() => (issue.is_fixable ? onFixRepair(issue) : onOpenRepairs())}
                >
                  <Text className="integration-logo system-summary-icon">
                    <BrandIcon
                      kind="integration"
                      id={issue.domain}
                      size={36}
                      hint={issue.sourceLabel ? { name: issue.sourceLabel } : undefined}
                    />
                  </Text>
                  <Text className="system-summary-copy">
                    <Text semantic="strong">{title}</Text>
                    <Text semantic="small">
                      <Text
                        className={
                          issue.severity === 'error' || issue.severity === 'critical'
                            ? 'repair-sev-error'
                            : 'repair-sev-warn'
                        }
                      >
                        {sev}
                      </Text>
                      {age ? ` · ${age}` : ''}
                      {source ? ` by ${source}` : ''}
                    </Text>
                  </Text>
                  <ChevronRight size={16} />
                </Pressable>
              );
            })}
          </Box>
        </Box>
      )}

      {(availableUpdates.length > 0 || totalUpdates > 0) && (
        <Box className="system-summary-card">
          <Pressable className="system-summary-header" onPress={onOpenUpdates}>
            <Text>
              {availableUpdates.length > 0
                ? `${availableUpdates.length} ${availableUpdates.length === 1 ? 'update' : 'updates'}`
                : 'Updates · All up to date'}
            </Text>
            <ChevronRight size={16} />
          </Pressable>
          {availableUpdates.length > 0 && (
            <Box className="system-summary-rows">
              {availableUpdates.slice(0, 2).map((item) => (
                <Pressable key={item.id} className="system-summary-row" onPress={onOpenUpdates}>
                  <Text className="integration-logo system-summary-icon">
                    {item.category === 'core' ? (
                      <ArrowUpCircle size={20} />
                    ) : (
                      <BrandIcon
                        kind={item.category === 'firmware' ? 'integration' : item.category}
                        id={item.domain}
                        size={36}
                        hint={{ name: item.title, category: item.category }}
                      />
                    )}
                  </Text>
                  <Text className="system-summary-copy">
                    <Text semantic="strong">{item.title}</Text>
                    <Text semantic="small">
                      {formatCategoryBadge(item.category)} · {item.installedVersion} →{' '}
                      {item.latestVersion}
                    </Text>
                  </Text>
                  <ChevronRight size={16} />
                </Pressable>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
});
