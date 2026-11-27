/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo } from 'react';
import type { RepairIssueRecord } from '@haus/core/transport';
import { RepairsPanelView } from '@haus/ui/components';
import { nativeApi } from '../../../ha/management';
import type { RichRepairIssue } from './types';

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
  const byKey = useMemo(
    () => new Map(issues.map((item) => [`${item.domain}:${item.issue_id}`, item])),
    [issues],
  );

  return (
    <RepairsPanelView
      issues={issues as readonly RepairIssueRecord[]}
      busy={busy}
      canManage
      formatDomain={formatDomain}
      onBack={onBack}
      onFix={(record) => {
        const match = byKey.get(`${record.domain}:${record.issue_id}`);
        if (match) onFix(match);
      }}
      onOpenExternal={(url) =>
        void nativeApi()
          .openExternal(url)
          .catch(() => {})
      }
      onToggleIgnore={(record, ignore) => {
        const match = byKey.get(`${record.domain}:${record.issue_id}`);
        if (match) void onToggleIgnore(match, ignore);
      }}
    />
  );
}
