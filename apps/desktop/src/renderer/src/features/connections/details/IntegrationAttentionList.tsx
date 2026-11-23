/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausButton, Heading, Text } from '@haus/ui';
import { humanize, type FlowProgress, type IntegrationEntry } from '../../../ha/management';
import { attentionFlow, entryNeedsAttention } from '../integration-health';
import type { FlowTarget } from '../IntegrationFlow';
import type { RichRepairIssue } from '../system/types';
import { tuyaPendingCopy, type TuyaPendingCamera } from '../flow/tuya-camera-pending';

export function IntegrationAttentionList({
  name,
  entries,
  progress,
  issues,
  admin,
  pendingTuyaCameras = [],
  onFlow,
  onFinishTuyaSetup,
}: {
  name: string;
  entries: readonly IntegrationEntry[];
  progress: readonly FlowProgress[];
  issues: readonly RichRepairIssue[];
  admin: boolean;
  pendingTuyaCameras?: ReadonlyArray<TuyaPendingCamera>;
  onFlow: (target: FlowTarget) => void;
  onFinishTuyaSetup?: (pending: TuyaPendingCamera) => void;
}) {
  const flaggedEntries = entries.filter((entry) => entryNeedsAttention(entry, [...progress]));
  const extraRepairs = issues.filter(
    (issue) =>
      !issue.ignored &&
      (!issue.entryId || !flaggedEntries.some((e) => e.entry_id === issue.entryId)),
  );

  if (flaggedEntries.length === 0 && extraRepairs.length === 0 && pendingTuyaCameras.length === 0) {
    return null;
  }

  return (
    <Box semantic="section" className="integration-attention-section" ariaLabel="Needs attention">
      <Heading level={3} className="integration-section-label">
        Needs attention
      </Heading>
      <Box className="integration-attention-box">
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
            <Box key={entry.entry_id} className="integration-attention-row">
              <Box className="integration-attention-copy">
                <Text semantic="strong">{entry.title || name}</Text>
                <Text>{subtitle}</Text>
              </Box>
              {admin && (
                <HausButton
                  size="sm"
                  className="attention-reconfigure-pill"
                  onPress={() => {
                    if (flow) {
                      onFlow({ flowId: flow.flow_id, domain: entry.domain, title: name });
                    } else if (matchingIssue?.is_fixable) {
                      onFlow({
                        domain: matchingIssue.domain,
                        title: name,
                        repair: {
                          domain: matchingIssue.domain,
                          issue_id: matchingIssue.issue_id,
                          translation_key: matchingIssue.translation_key,
                        },
                      });
                    } else {
                      onFlow({
                        domain: entry.domain,
                        title: name,
                        entryId: entry.entry_id,
                        reconfigure: true,
                        reauth: isReauth,
                      });
                    }
                  }}
                >
                  {isReauth ? 'Reauthenticate' : 'Reconfigure'}
                </HausButton>
              )}
            </Box>
          );
        })}

        {pendingTuyaCameras.length > 0 &&
          (() => {
            const first = pendingTuyaCameras[0];
            const copy = tuyaPendingCopy(first.reason);
            const names = pendingTuyaCameras
              .slice(0, 2)
              .map((item) => item.deviceName)
              .join(', ');
            const extra =
              pendingTuyaCameras.length > 2 ? ` +${pendingTuyaCameras.length - 2} more` : '';
            const title =
              first.reason === 'bridge_session_expired'
                ? pendingTuyaCameras.length === 1
                  ? `${first.deviceName} · Session expired`
                  : `Tuya camera session expired (${names}${extra})`
                : pendingTuyaCameras.length === 1
                  ? `You have 1 camera in Tuya (${first.deviceName}) · ${copy.badge}`
                  : `You have ${pendingTuyaCameras.length} cameras in Tuya (${names}${extra})`;

            return (
              <Box className="integration-attention-row">
                <Box className="integration-attention-copy">
                  <Text semantic="strong">{title}</Text>
                  <Text>{copy.detail}</Text>
                </Box>
                {admin && onFinishTuyaSetup && (
                  <HausButton
                    size="sm"
                    className="attention-reconfigure-pill"
                    onPress={() => onFinishTuyaSetup(first)}
                  >
                    {copy.action}
                  </HausButton>
                )}
              </Box>
            );
          })()}

        {extraRepairs.map((issue) => (
          <Box key={`${issue.domain}:${issue.issue_id}`} className="integration-attention-row">
            <Box className="integration-attention-copy">
              <Text semantic="strong">
                {issue.title || humanize(issue.translation_key ?? issue.issue_id)}
              </Text>
              <Text>{issue.description || 'Attention required'}</Text>
            </Box>
            {admin && issue.is_fixable !== false && (
              <HausButton
                size="sm"
                className="attention-reconfigure-pill"
                onPress={() =>
                  onFlow({
                    domain: issue.domain,
                    title: name,
                    repair: {
                      domain: issue.domain,
                      issue_id: issue.issue_id,
                      translation_key: issue.translation_key,
                    },
                  })
                }
              >
                Reconfigure
              </HausButton>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
