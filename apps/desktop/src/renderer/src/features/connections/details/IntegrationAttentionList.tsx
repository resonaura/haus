/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
import { humanize, type FlowProgress, type IntegrationEntry } from '../../../ha/management';
import { attentionFlow, entryNeedsAttention } from '../integration-health';
import type { FlowTarget } from '../IntegrationFlow';
import type { RichRepairIssue } from '../system/types';

export function IntegrationAttentionList({
  name,
  entries,
  progress,
  issues,
  admin,
  onFlow,
}: {
  name: string;
  entries: readonly IntegrationEntry[];
  progress: readonly FlowProgress[];
  issues: readonly RichRepairIssue[];
  admin: boolean;
  onFlow: (target: FlowTarget) => void;
}) {
  const flaggedEntries = entries.filter((entry) => entryNeedsAttention(entry, [...progress]));
  const extraRepairs = issues.filter(
    (issue) =>
      !issue.ignored &&
      (!issue.entryId || !flaggedEntries.some((e) => e.entry_id === issue.entryId)),
  );

  if (flaggedEntries.length === 0 && extraRepairs.length === 0) return null;

  return (
    <section className="integration-attention-section" aria-label="Needs attention">
      <h3 className="integration-section-label">Needs attention</h3>
      <div className="integration-attention-box">
        {flaggedEntries.map((entry) => {
          const flow = attentionFlow(entry, [...progress]);
          const matchingIssue = issues.find(
            (i) => !i.ignored && (i.entryId === entry.entry_id || i.domain === entry.domain),
          );
          const subtitle =
            flow?.context?.source === 'reauth'
              ? 'Authentication required'
              : entry.reason || 'Attention required';
          const isReauth = flow?.context?.source === 'reauth';

          return (
            <div key={entry.entry_id} className="integration-attention-row">
              <div className="integration-attention-copy">
                <strong>{entry.title || name}</strong>
                <span>{subtitle}</span>
              </div>
              {admin && (
                <Button
                  size="sm"
                  className="attention-reconfigure-pill"
                  onPress={() => {
                    if (flow) {
                      onFlow({ flowId: flow.flow_id, domain: entry.domain });
                    } else if (matchingIssue?.is_fixable) {
                      onFlow({
                        repair: {
                          domain: matchingIssue.domain,
                          issue_id: matchingIssue.issue_id,
                          translation_key: matchingIssue.translation_key,
                        },
                      });
                    } else {
                      onFlow({
                        domain: entry.domain,
                        entryId: entry.entry_id,
                        reconfigure: true,
                        reauth: isReauth,
                      });
                    }
                  }}
                >
                  {isReauth ? 'Reauthenticate' : 'Reconfigure'}
                </Button>
              )}
            </div>
          );
        })}

        {extraRepairs.map((issue) => (
          <div key={`${issue.domain}:${issue.issue_id}`} className="integration-attention-row">
            <div className="integration-attention-copy">
              <strong>{issue.title || humanize(issue.translation_key ?? issue.issue_id)}</strong>
              <span>{issue.description || 'Attention required'}</span>
            </div>
            {admin && issue.is_fixable !== false && (
              <Button
                size="sm"
                className="attention-reconfigure-pill"
                onPress={() =>
                  onFlow({
                    repair: {
                      domain: issue.domain,
                      issue_id: issue.issue_id,
                      translation_key: issue.translation_key,
                    },
                  })
                }
              >
                Reconfigure
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
