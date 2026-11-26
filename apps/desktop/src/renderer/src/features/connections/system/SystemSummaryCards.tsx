/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useMemo } from 'react';
import type { RepairIssueRecord, UnifiedUpdatesSummary } from '@haus/core/transport';
import { SystemSummaryCardsView } from '@haus/ui/components';
import type { RichRepairIssue, UnifiedUpdatesResponse } from './types';

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
  const issueByKey = useMemo(
    () => new Map(issues.map((item) => [`${item.domain}:${item.issue_id}`, item])),
    [issues],
  );

  return (
    <SystemSummaryCardsView
      issues={issues as readonly RepairIssueRecord[]}
      updates={updates as UnifiedUpdatesSummary | null}
      formatDomain={formatDomain}
      onOpenRepairs={onOpenRepairs}
      onFixRepair={(issue) => {
        const match = issueByKey.get(`${issue.domain}:${issue.issue_id}`);
        if (match?.is_fixable) onFixRepair(match);
        else onOpenRepairs();
      }}
      onOpenUpdates={onOpenUpdates}
    />
  );
});
