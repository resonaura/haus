/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { FlowProgress, IntegrationEntry } from '../../ha/management';
export const attentionFlow = (entry: IntegrationEntry, progress: FlowProgress[]) =>
  progress.find(
    (flow) =>
      flow.handler === entry.domain &&
      flow.context?.entry_id === entry.entry_id &&
      ['reauth', 'reconfigure'].includes(flow.context.source ?? ''),
  );
export const entryNeedsAttention = (entry: IntegrationEntry, progress: FlowProgress[] = []) =>
  !entry.disabled_by &&
  (['setup_error', 'migration_error', 'setup_retry', 'failed_unload'].includes(entry.state) ||
    Boolean(attentionFlow(entry, progress)));

export function entryHasPendingTuyaSetup(
  entry: Pick<IntegrationEntry, 'entry_id' | 'domain' | 'disabled_by'>,
  pendingByEntry: ReadonlyMap<string, ReadonlyArray<unknown>>,
): boolean {
  if (entry.disabled_by || entry.domain !== 'tuya') return false;
  return pendingByEntry.has(entry.entry_id) || pendingByEntry.has('tuya');
}

export function entryHasIssueOrAttention(
  entry: IntegrationEntry,
  progress: FlowProgress[],
  issues: ReadonlyArray<{ ignored?: boolean; domain: string; issue_domain?: string }>,
  pendingByEntry?: ReadonlyMap<string, ReadonlyArray<unknown>>,
): boolean {
  if (entryNeedsAttention(entry, progress)) return true;
  if (
    !entry.disabled_by &&
    issues.some(
      (item) =>
        !item.ignored && (item.domain === entry.domain || item.issue_domain === entry.domain),
    )
  ) {
    return true;
  }
  return Boolean(pendingByEntry && entryHasPendingTuyaSetup(entry, pendingByEntry));
}
